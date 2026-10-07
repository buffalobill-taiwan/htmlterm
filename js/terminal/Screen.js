import { defaultAttr, applySGR, makeCell } from '../util/sgr.js';
import { isWide } from '../util/display-width.js';
import { DEFAULT_FG, DEFAULT_BG, SCROLLBACK_MAX, SCROLLBACK_TRIM_SLACK, TAB_WIDTH } from '../util/constants.js';

export class Screen {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.scrollbackSize = SCROLLBACK_MAX;

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
            insertMode: false,
        };

        this.mouseMode = 0;       // event mode: 0, 1000, 1002 or 1003
        this.mouseEncoding = 0;   // 0 = X10, 1006 = SGR

        this._cursorHidden = false;

        this.overlays = [];

        this._initBuffer();
    }

    getRowAt(r) { return this.buffer[r]; }
    setRowAt(r, row) { this.buffer[r] = row; }
    get cursorHidden() { return this._cursorHidden; }
    set cursorHidden(v) { this._cursorHidden = v; }

    markAllDirty() {
        for (let i = 0; i < this.rows; i++) this.dirtyRows.add(i);
    }

    markRowDirty(rowIdx) {
        if (rowIdx >= 0 && rowIdx < this.rows) this.dirtyRows.add(rowIdx);
    }

    addOverlay(ov, group = 'command') {
        const rank = group === 'dialog' ? 1 : group === 'widget' ? 2 : 0;
        let i = this.overlays.length;
        while (i > 0 && this.overlays[i - 1]._overlayRank > rank) i--;
        this.overlays.splice(i, 0, ov);
        ov._overlayRank = rank;
        this._markOverlayDirty(ov);
    }
    removeOverlay(ov) {
        const i = this.overlays.indexOf(ov);
        if (i >= 0) {
            this.overlays.splice(i, 1);
            this._markOverlayDirty(ov);
        }
    }
    // Callers no longer need to remember markRowDirty() around overlay changes.
    _markOverlayDirty(ov) {
        const top = Math.max(0, ov.y);
        const bottom = Math.min(this.rows - 1, ov.y + ov.h - 1);
        for (let r = top; r <= bottom; r++) this.markRowDirty(r);
    }

    getCellAt(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
        const ovs = this.overlays;
        for (let i = ovs.length - 1; i >= 0; i--) {
            const ov = ovs[i];
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

    // Cursor motion only moves the separate #cursor element; it never changes
    // cell content, so these deliberately skip dirty marking.
    cursorUp(n) {
        this.curY = Math.max(0, this.curY - n);
    }

    cursorDown(n) {
        this.curY = Math.min(this.rows - 1, this.curY + n);
    }

    cursorForward(n) {
        const target = this.curX + n;
        if (target >= this.cols) {
            this.curY = Math.min(this.rows - 1, this.curY + Math.floor(target / this.cols));
            this.curX = target % this.cols;
        } else {
            this.curX = target;
        }
    }

    cursorBack(n) {
        const target = this.curX - n;
        if (target < 0) {
            const rowsUp = Math.min(this.curY, Math.ceil(-target / this.cols));
            this.curY -= rowsUp;
            this.curX = ((target % this.cols) + this.cols) % this.cols;
        } else {
            this.curX = target;
        }
    }

    cursorPos(row, col) {
        this.curY = Math.max(0, Math.min(this.rows - 1, row - 1));
        this.curX = Math.max(0, Math.min(this.cols - 1, col - 1));
    }

    rowPos(row) {
        this.curY = Math.max(0, Math.min(this.rows - 1, row - 1));
    }

    carriageReturn() {
        this.curX = 0;
    }

    backspace() {
        if (this.curX > 0) this.curX--;
    }

    tab() {
        const next = (this.curX + TAB_WIDTH) & ~(TAB_WIDTH - 1);
        this.curX = Math.min(this.cols - 1, next);
    }

    lineFeedEdge() {
        if (this.curY < this.scrollTop) this.curY = this.scrollTop;
        this.markRowDirty(this.curY);

        const curHasBig = this._rowHasBigChar(this.curY);
        const nextHasBig = this.curY + 1 < this.rows && this._rowHasBigChar(this.curY + 1);
        const step = (curHasBig && nextHasBig) ? 2 : 1;

        const target = this.curY + step;
        if (target > this.scrollBottom) {
            this._scrollUp(target - this.scrollBottom);
            this.curY = this.scrollBottom;
        } else {
            this.curY = target;
        }
    }

    reverseScroll(n = 1) {
        this.markRowDirty(this.curY);
        if (this.curY === this.scrollTop) {
            this._scrollDown(n);
        } else if (this.curY > 0) {
            this.curY--;
        }
        this.markRowDirty(this.curY);
    }

    writeChar(ch) {
        if (this.attr.big) {
            return this._writeBigChar(ch);
        }
        const cell = this._makeCell(ch);
        if (cell.width === 2 && this.curX >= this.cols - 1) {
            this.curX = 0;
            this.lineFeedEdge();
        }
        if (this.curX >= this.cols) {
            this.curX = 0;
            this.lineFeedEdge();
        }

        const row = this.buffer[this.curY];
        if (!row) return;

        if (this.modes.insertMode) {
            for (let c = this.cols - 1; c >= this.curX + cell.width; c--) row[c] = row[c - cell.width];
            for (let c = this.curX; c < this.curX + cell.width; c++) row[c] = this._makeCell(' ');
        }

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
        // Overwriting half of an existing wide glyph must clear its partner cell.
        this._repairWideAt(row, this.curX);
        this.markRowDirty(this.curY);
        this.curX += cell.width;
    }

    // Re-validate the wide-glyph pair around column c: a width-2 cell needs a
    // width-0 continuation after it, and a width-0 cell needs a width-2 lead
    // before it. Anything else is a leftover half and becomes a blank.
    _repairWideAt(row, c) {
        for (let i = c - 1; i <= c + 2; i++) {
            if (i < 0 || i >= this.cols) continue;
            const cell = row[i];
            if (!cell) continue;
            if (cell.width === 0) {
                const lead = i > 0 ? row[i - 1] : null;
                if (!lead || lead.width !== 2) row[i] = this._makeCell(' ');
            } else if (cell.width === 2) {
                const next = i + 1 < this.cols ? row[i + 1] : null;
                if (!next || next.width !== 0) row[i] = this._makeCell(' ');
            }
        }
    }

    _repairRow(row) {
        for (let c = 0; c < this.cols; c++) {
            const cell = row[c];
            if (!cell) continue;
            if (cell.width === 0) {
                const lead = c > 0 ? row[c - 1] : null;
                if (!lead || lead.width !== 2) row[c] = this._makeCell(' ');
            } else if (cell.width === 2) {
                const next = c + 1 < this.cols ? row[c + 1] : null;
                if (!next || next.width !== 0) row[c] = this._makeCell(' ');
            }
        }
    }

    _writeBigChar(ch) {
        const nCols = this.isWide(ch) ? 4 : 2;

        if (this.curX + nCols > this.cols) {
            this.curX = 0;
            this.lineFeedEdge();
        }

        if (this.curY + 1 > this.scrollBottom) {
            this._scrollUp(1);
            this.curY = Math.max(this.scrollTop, this.scrollBottom - 1);
        }

        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < nCols; c++) {
                const cell = makeCell(ch, this.attr, 1);
                cell.clip = true;
                cell.clipOffX = -c;
                cell.clipOffY = -r;
                this.buffer[this.curY + r][this.curX + c] = cell;
            }
            this.markRowDirty(this.curY + r);
        }
        this.curX += nCols;
    }

    _rowHasBigChar(rowIdx) {
        const row = this.buffer[rowIdx];
        if (!row) return false;
        for (let c = 0; c < this.cols; c++) {
            if (row[c] && row[c].clip) return true;
        }
        return false;
    }

    clearBuffer() {
        this._initBuffer();
    }

    resize(newCols, newRows) {
        const oldCols = this.cols;
        this.cols = newCols;
        this.rows = newRows;
        // A scroll region defined before the resize rarely survives a new grid
        // size; falling back to the full screen is the safe interpretation.
        this.scrollTop = 0;
        this.scrollBottom = newRows - 1;

        // Fit scrollback first: rows dropped out of the primary buffer below are
        // pushed onto scrollback already fitted.
        for (let i = 0; i < this.scrollback.length; i++) {
            this._fitRow(this.scrollback[i], oldCols, newCols);
        }
        this._fitBuffer(this.buffer, oldCols, newCols, newRows, !this._primaryBuffer);
        if (this._primaryBuffer) this._fitBuffer(this._primaryBuffer, oldCols, newCols, newRows, false);

        this.curX = Math.min(this.curX, newCols - 1);
        this.curY = Math.min(this.curY, newRows - 1);
        this.viewOffset = Math.min(this.viewOffset, this.maxViewOffset());
        this.markAllDirty();
    }

    _fitRow(row, oldCols, newCols) {
        if (!row) return;
        if (newCols > oldCols) {
            for (let c = oldCols; c < newCols; c++) row.push(this._makeCell(' '));
        } else if (newCols < oldCols) {
            const cut = row[newCols - 1];
            // Never truncate in the middle of a wide glyph.
            if (cut && cut.width === 2) row[newCols - 1] = this._makeCell(' ');
            row.length = newCols;
        }
    }

    _fitBuffer(buf, oldCols, newCols, newRows, keepInScrollback) {
        for (const row of buf) this._fitRow(row, oldCols, newCols);
        while (buf.length > newRows) {
            const row = buf.pop();
            if (keepInScrollback && row) this._pushScrollback(row);
        }
        while (buf.length < newRows) buf.push(this._emptyRow());
    }

    scrollbackUp(n) {
        this.viewOffset = Math.min(this.viewOffset + n, this.maxViewOffset());
        this.markAllDirty();
    }

    scrollbackDown(n) {
        this.viewOffset = Math.max(0, this.viewOffset - n);
        this.markAllDirty();
    }

    useAltBuffer() {
        this._primaryBuffer = this.buffer;
        this._primaryCurX = this.curX;
        this._primaryCurY = this.curY;
        this._primaryViewOffset = this.viewOffset;
        this._primaryScroll = { top: this.scrollTop, bottom: this.scrollBottom };

        this.buffer = [];
        for (let i = 0; i < this.rows; i++) this.buffer.push(this._emptyRow());
        this.curX = 0;
        this.curY = 0;
        this.viewOffset = 0;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
        this.markAllDirty();
    }

    restorePrimaryBuffer() {
        if (!this._primaryBuffer) return;
        this.buffer = this._primaryBuffer;
        this.curX = this._primaryCurX || 0;
        this.curY = this._primaryCurY || 0;
        this.viewOffset = this._primaryViewOffset || 0;
        if (this._primaryScroll) {
            this.scrollTop = Math.max(0, Math.min(this._primaryScroll.top, this.rows - 1));
            this.scrollBottom = Math.max(this.scrollTop, Math.min(this._primaryScroll.bottom, this.rows - 1));
        }
        this._primaryBuffer = null;
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
        if (ch === ' ') return this._blankCell();
        return makeCell(ch, this.attr, this.isWide(ch) ? 2 : 1);
    }

    // Blank cells are immutable, so one cached instance per attribute state is
    // shared by every erased cell and empty row (major GC win during scrolling).
    _blankCell() {
        const a = this.attr;
        const flags = (a.bold ? 1 : 0) | (a.dim ? 2 : 0) | (a.italic ? 4 : 0) |
                      (a.underline ? 8 : 0) | (a.blink ? 16 : 0) | (a.inverse ? 32 : 0) |
                      (a.conceal ? 64 : 0) | (a.crossedOut ? 128 : 0);
        if (this._blankRef && this._blankFlags === flags &&
            this._blankFg === a.fg && this._blankBg === a.bg) {
            return this._blankRef;
        }
        if (flags === 0 && a.fg === DEFAULT_FG && a.bg === DEFAULT_BG) {
            if (!this._cachedEmptyCell) this._cachedEmptyCell = Object.freeze(makeCell(' ', defaultAttr(), 1));
            this._blankRef = this._cachedEmptyCell;
        } else {
            this._blankRef = Object.freeze(makeCell(' ', a, 1));
        }
        this._blankFlags = flags;
        this._blankFg = a.fg;
        this._blankBg = a.bg;
        return this._blankRef;
    }

    _emptyRow() {
        const row = new Array(this.cols);
        row.fill(this._blankCell());
        return row;
    }

    _clearRows(from, to) {
        for (let r = from; r <= to; r++) {
            this.buffer[r] = this._emptyRow();
            this.markRowDirty(r);
        }
    }

    _pushScrollback(row) {
        this.scrollback.push(row);
        // Trim in batches: shift() on every line is O(scrollbackSize).
        if (this.scrollback.length > this.scrollbackSize + SCROLLBACK_TRIM_SLACK) {
            this.scrollback.splice(0, this.scrollback.length - this.scrollbackSize);
        }
    }

    _scrollUp(n) {
        for (let i = 0; i < n; i++) {
            if (this.scrollTop === 0) {
                this._pushScrollback(Array.from(this.buffer[0]));
            }
            for (let r = this.scrollTop; r < this.scrollBottom; r++) {
                this.buffer[r] = this.buffer[r + 1];
            }
            this.buffer[this.scrollBottom] = this._emptyRow();
        }
        if (this.viewOffset > 0) this.viewOffset = Math.min(this.viewOffset, this.maxViewOffset());
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
            this._clearRows(this.curY + 1, this.rows - 1);
        } else if (mode === 1) {
            this._clearRows(0, this.curY - 1);
            this.eraseLine(1);
        } else if (mode === 2) {
            this._clearRows(0, this.rows - 1);
        } else if (mode === 3) {
            this.scrollback = [];
            this.viewOffset = 0;
            this._clearRows(0, this.rows - 1);
        }
    }

    eraseLine(mode) {
        const row = this.buffer[this.curY];
        if (!row) return;
        // A cursor parked past the last column means pending wrap: the erase
        // starts at the last real cell, not at a column that does not exist.
        const x = Math.min(this.curX, this.cols - 1);
        if (mode === 0) {
            for (let c = x; c < this.cols; c++) row[c] = this._makeCell(' ');
        } else if (mode === 1) {
            for (let c = 0; c <= x; c++) row[c] = this._makeCell(' ');
        } else if (mode === 2) {
            for (let c = 0; c < this.cols; c++) row[c] = this._makeCell(' ');
        }
        this._repairRow(row);
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
        this._markRegionDirty(top, this.scrollBottom);
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
        this._markRegionDirty(top, this.scrollBottom);
    }

    insertChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        const x = Math.min(this.curX, this.cols - 1);
        n = Math.min(n, this.cols - x);
        for (let c = this.cols - 1; c >= x + n; c--) {
            row[c] = row[c - n];
        }
        for (let c = x; c < x + n; c++) {
            row[c] = this._makeCell(' ');
        }
        this._repairRow(row);
        this.markRowDirty(this.curY);
    }

    deleteChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        const x = Math.min(this.curX, this.cols - 1);
        n = Math.min(n, this.cols - x);
        for (let c = x; c < this.cols - n; c++) {
            row[c] = row[c + n];
        }
        for (let c = this.cols - n; c < this.cols; c++) {
            row[c] = this._makeCell(' ');
        }
        this._repairRow(row);
        this.markRowDirty(this.curY);
    }

    eraseChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        const x = Math.min(this.curX, this.cols - 1);
        n = Math.min(n, this.cols - x);
        for (let c = x; c < x + n; c++) {
            row[c] = this._makeCell(' ');
        }
        this._repairRow(row);
        this.markRowDirty(this.curY);
    }

    _markRegionDirty(from, to) {
        for (let r = Math.max(0, from); r <= Math.min(this.rows - 1, to); r++) this.markRowDirty(r);
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

    maxViewOffset() {
        return Math.min(this.scrollback.length, this.scrollbackSize);
    }
}
