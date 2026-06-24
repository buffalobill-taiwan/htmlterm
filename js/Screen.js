/**
 * Screen — terminal buffer data model.
 *
 * Owns the cell buffer, cursor state, scroll regions, SGR attributes,
 * scrollback, alternate buffer, and dirty-row tracking.
 * No DOM, no escape parsing — pure data.
 */

import { defaultAttr, applySGR, makeCell, isWide } from './sgr.js';

export class Screen {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.scrollbackSize = 2000;

        this.buffer = [];
        this.scrollback = [];
        this.viewOffset = 0;
        this.dirtyRows = new Set();

        this.curX = 0;
        this.curY = 0;
        this.savedX = -1;
        this.savedY = -1;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;

        this.attr = defaultAttr();

        this.modes = {
            applicationCursorKeys: false,
            bracketedPaste: false,
        };

        this.mouseMode = 0;

        this._cursorHidden = false;

        this.overlays = [];

        this._normalLines = null;
        this._normalCurX = 0;
        this._normalCurY = 0;
        this._normalViewOffset = 0;
        this._saveScroll = null;

        this._initBuffer();
    }

    // ── Public helpers ──

    getRow(r) { return this.buffer[r]; }
    setRow(r, row) { this.buffer[r] = row; }
    get cursorHidden() { return this._cursorHidden; }
    set cursorHidden(v) { this._cursorHidden = v; }

    markAllDirty() {
        for (let i = 0; i < this.rows; i++) this.dirtyRows.add(i);
    }

    markRowDirty(rowIdx) {
        if (rowIdx >= 0 && rowIdx < this.rows) this.dirtyRows.add(rowIdx);
    }

    addOverlay(ov) { this.overlays.push(ov); }
    removeOverlay(ov) {
        const i = this.overlays.indexOf(ov);
        if (i >= 0) this.overlays.splice(i, 1);
    }

    getCellAt(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        for (const ov of this.overlays) {
            if (row >= ov.y && row < ov.y + ov.h && col >= ov.x && col < ov.x + ov.w) {
                const c = ov.getCell(row - ov.y, col - ov.x);
                if (c) return c;
            }
        }
        const r = this.buffer[row];
        return r ? r[col] : null;
    }

    isWide(ch) {
        return isWide(ch);
    }

    cursorUp(n) {
        this.markRowDirty(this.curY);
        this.curY = Math.max(0, this.curY - n);
        this.markRowDirty(this.curY);
    }

    cursorDown(n) {
        this.markRowDirty(this.curY);
        this.curY = Math.min(this.rows - 1, this.curY + n);
        this.markRowDirty(this.curY);
    }

    cursorForward(n) {
        this.curX = Math.min(this.cols - 1, this.curX + n);
    }

    cursorBack(n) {
        this.curX = Math.max(0, this.curX - n);
    }

    cursorPos(row, col) {
        this.markRowDirty(this.curY);
        this.curY = Math.max(0, Math.min(this.rows - 1, row - 1));
        this.curX = Math.max(0, Math.min(this.cols - 1, col - 1));
        this.markRowDirty(this.curY);
    }

    rowPos(row) {
        this.markRowDirty(this.curY);
        this.curY = Math.max(0, Math.min(this.rows - 1, row - 1));
        this.markRowDirty(this.curY);
    }

    carriageReturn() {
        this.curX = 0;
    }

    backspace() {
        if (this.curX > 0) this.curX--;
    }

    tab() {
        const next = (this.curX + 8) & ~7;
        this.curX = Math.min(this.cols - 1, next);
    }

    lineFeed() {
        if (this.curY < this.scrollTop) this.curY = this.scrollTop;
        this.markRowDirty(this.curY);
        if (this.curY >= this.scrollBottom) {
            this._scrollUp(1);
            this.curY = this.scrollBottom;
        } else {
            this.curY++;
        }
    }

    reverseIndex() {
        this.markRowDirty(this.curY);
        if (this.curY === this.scrollTop) {
            this._scrollDown(1);
        } else {
            this.curY--;
        }
        this.markRowDirty(this.curY);
    }

    writeChar(ch) {
        const cell = this._makeCell(ch);
        if (cell.width === 2 && this.curX >= this.cols - 1) {
            this.curX = 0;
            this.lineFeed();
        }
        if (this.curX >= this.cols) {
            this.curX = 0;
            this.lineFeed();
        }

        const row = this.buffer[this.curY];
        if (!row) return;

        row[this.curX] = cell;
        if (cell.width === 2 && this.curX + 1 < this.cols) {
            row[this.curX + 1] = {
                ch: '', fg: this.attr.fg, bg: this.attr.bg,
                bold: this.attr.bold, dim: this.attr.dim,
                italic: this.attr.italic, underline: this.attr.underline,
                blink: this.attr.blink, inverse: this.attr.inverse,
                conceal: this.attr.conceal, crossedOut: this.attr.crossedOut,
                width: 0,
            };
        }
        this.markRowDirty(this.curY);
        this.curX += cell.width;
    }

    clearBuffer() {
        this._initBuffer();
    }

    resize(newCols, newRows) {
        const oldCols = this.cols;
        const oldRows = this.rows;
        this.cols = newCols;
        this.rows = newRows;
        this.scrollBottom = newRows - 1;

        while (this.buffer.length < newRows) {
            this.buffer.push(this._emptyRow());
        }
        while (this.buffer.length > newRows) {
            this.buffer.pop();
        }
        for (let r = 0; r < newRows; r++) {
            const row = this.buffer[r];
            if (!row) continue;
            if (newCols > oldCols) {
                for (let c = oldCols; c < newCols; c++) row.push(this._makeCell(' '));
            } else if (newCols < oldCols) {
                row.length = newCols;
            }
        }
        this.curX = Math.min(this.curX, newCols - 1);
        this.curY = Math.min(this.curY, newRows - 1);
        this.markAllDirty();
    }

    scrollbackUp(n) {
        this.viewOffset = Math.min(this.viewOffset + n, this._maxViewOffset());
        this.markAllDirty();
    }

    scrollbackDown(n) {
        this.viewOffset = Math.max(0, this.viewOffset - n);
        this.markAllDirty();
    }

    altBuffer() {
        this._normalLines = this.buffer;
        this._normalCurX = this.curX;
        this._normalCurY = this.curY;
        this._normalViewOffset = this.viewOffset;
        this._saveScroll = { top: this.scrollTop, bottom: this.scrollBottom };

        this.buffer = [];
        for (let i = 0; i < this.rows; i++) this.buffer.push(this._emptyRow());
        this.curX = 0;
        this.curY = 0;
        this.viewOffset = 0;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
        this.markAllDirty();
    }

    normalBuffer() {
        if (!this._normalLines) return;
        this.buffer = this._normalLines;
        this.curX = this._normalCurX || 0;
        this.curY = this._normalCurY || 0;
        this.viewOffset = this._normalViewOffset || 0;
        if (this._saveScroll) {
            this.scrollTop = this._saveScroll.top;
            this.scrollBottom = this._saveScroll.bottom;
        }
        this._normalLines = null;
        this.markAllDirty();
    }

    setSGR(params) {
        if (params.length === 0) params = [0];
        let i = 0;
        while (i < params.length) {
            const p = params[i];
            if (p === 38) {
                i = this._parseExtendedColor(params, i, 'fg');
            } else if (p === 48) {
                i = this._parseExtendedColor(params, i, 'bg');
            } else {
                applySGR(this.attr, [p]);
            }
            i++;
        }
    }

    // ── Internal: buffer init / cells ──

    _initBuffer() {
        this.buffer = [];
        for (let i = 0; i < this.rows; i++) {
            this.buffer.push(this._emptyRow());
        }
        this.scrollback = [];
        this.viewOffset = 0;
        this.curX = 0;
        this.curY = 0;
        this.attr = defaultAttr();
        this.markAllDirty();
    }

    _makeCell(ch) {
        return makeCell(ch, this.attr, this.isWide(ch) ? 2 : 1);
    }

    _emptyRow() {
        const row = new Array(this.cols);
        for (let i = 0; i < this.cols; i++) {
            row[i] = this._makeCell(' ');
        }
        return row;
    }

    _scrollUp(n) {
        for (let i = 0; i < n; i++) {
            if (this.scrollTop === 0) {
                this.scrollback.push(Array.from(this.buffer[0]));
                if (this.scrollback.length > this.scrollbackSize) {
                    this.scrollback.shift();
                }
            }
            for (let r = this.scrollTop; r < this.scrollBottom; r++) {
                this.buffer[r] = this.buffer[r + 1];
            }
            this.buffer[this.scrollBottom] = this._emptyRow();
        }
        if (this.viewOffset > 0) this.viewOffset = Math.min(this.viewOffset, this._maxViewOffset());
        this.markAllDirty();
    }

    _scrollDown(n) {
        for (let i = 0; i < n; i++) {
            for (let r = this.scrollBottom; r > this.scrollTop; r--) {
                this.buffer[r] = this.buffer[r - 1];
            }
            this.buffer[this.scrollTop] = this._emptyRow();
        }
        this.markAllDirty();
    }

    eraseDisplay(mode) {
        if (mode === 0) {
            this.eraseLine(0);
            for (let r = this.curY + 1; r < this.rows; r++) {
                this.buffer[r] = this._emptyRow();
                this.markRowDirty(r);
            }
        } else if (mode === 1) {
            for (let r = 0; r < this.curY; r++) {
                this.buffer[r] = this._emptyRow();
                this.markRowDirty(r);
            }
            this.eraseLine(1);
        } else if (mode === 2) {
            for (let r = 0; r < this.rows; r++) {
                this.buffer[r] = this._emptyRow();
                this.markRowDirty(r);
            }
        } else if (mode === 3) {
            this.scrollback = [];
            for (let r = 0; r < this.rows; r++) {
                this.buffer[r] = this._emptyRow();
                this.markRowDirty(r);
            }
        }
    }

    eraseLine(mode) {
        const row = this.buffer[this.curY];
        if (!row) return;
        if (mode === 0) {
            for (let c = this.curX; c < this.cols; c++) row[c] = this._makeCell(' ');
        } else if (mode === 1) {
            for (let c = 0; c <= this.curX; c++) row[c] = this._makeCell(' ');
        } else if (mode === 2) {
            for (let c = 0; c < this.cols; c++) row[c] = this._makeCell(' ');
        }
        this.markRowDirty(this.curY);
    }

    insertLines(n) {
        const top = Math.max(this.curY, this.scrollTop);
        n = Math.min(n, this.scrollBottom - top + 1);
        for (let i = 0; i < n; i++) {
            for (let r = this.scrollBottom; r > top; r--) {
                this.buffer[r] = this.buffer[r - 1];
            }
            this.buffer[top] = this._emptyRow();
        }
        this.markAllDirty();
    }

    deleteLines(n) {
        const top = Math.max(this.curY, this.scrollTop);
        n = Math.min(n, this.scrollBottom - top + 1);
        for (let i = 0; i < n; i++) {
            for (let r = top; r < this.scrollBottom; r++) {
                this.buffer[r] = this.buffer[r + 1];
            }
            this.buffer[this.scrollBottom] = this._emptyRow();
        }
        this.markAllDirty();
    }

    insertChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        n = Math.min(n, this.cols - this.curX);
        for (let c = this.cols - 1; c >= this.curX + n; c--) {
            row[c] = row[c - n];
        }
        for (let c = this.curX; c < this.curX + n; c++) {
            row[c] = this._makeCell(' ');
        }
        this.markRowDirty(this.curY);
    }

    deleteChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        n = Math.min(n, this.cols - this.curX);
        for (let c = this.curX; c < this.cols - n; c++) {
            row[c] = row[c + n];
        }
        for (let c = this.cols - n; c < this.cols; c++) {
            row[c] = this._makeCell(' ');
        }
        this.markRowDirty(this.curY);
    }

    eraseChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        n = Math.min(n, this.cols - this.curX);
        for (let c = this.curX; c < this.curX + n; c++) {
            row[c] = this._makeCell(' ');
        }
        this.markRowDirty(this.curY);
    }

    _parseExtendedColor(params, i, type) {
        if (i + 1 >= params.length) return i;
        const mode = params[i + 1];
        if (mode === 5 && i + 2 < params.length) {
            const idx = params[i + 2];
            if (type === 'fg') this.attr.fg = idx;
            else this.attr.bg = idx;
            return i + 2;
        }
        if (mode === 2 && i + 4 < params.length) {
            const r = params[i + 2], g = params[i + 3], b = params[i + 4];
            const hex = '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
            if (type === 'fg') this.attr.fg = hex;
            else this.attr.bg = hex;
            return i + 4;
        }
        return i;
    }

    _maxViewOffset() {
        return Math.min(this.scrollback.length, this.scrollbackSize);
    }
}
