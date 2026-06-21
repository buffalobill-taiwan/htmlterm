/**
 * Renderer — DOM rendering layer for the terminal.
 *
 * Owns the container, row elements, cursor element, and render loop.
 * Reads Screen data to produce DOM output.
 */

import { XTERM_COLORS } from './Screen.js';

export class Renderer {
    constructor(container, screen, opts = {}) {
        this.container = container;
        this.screen = screen;
        this._baseCharWidth = opts.charWidth || 8;
        this._baseCharHeight = opts.charHeight || 16;
        this.charWidth = this._baseCharWidth;
        this.charHeight = this._baseCharHeight;
        this._scale = 1;
        this._loopRunning = false;

        this.rowEls = [];
        this.cellEls = [];
        this.cursorEl = null;

        this._initDOM();
        this._initScrollIndicator();
    }

    _initScrollIndicator() {
        this._scrollIndicatorEl = document.createElement('div');
        this._scrollIndicatorEl.className = 'scroll-indicator';
        this._scrollIndicatorEl.textContent = ' (MORE)';
        this.container.appendChild(this._scrollIndicatorEl);
    }

    _initDOM() {
        const cols = this.screen.cols;
        const rows = this.screen.rows;


        this.cursorEl = document.createElement('div');
        this.cursorEl.id = 'cursor';
        this.container.appendChild(this.cursorEl);

        this.rowEls = [];
        this.cellEls = [];
        for (let r = 0; r < rows; r++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'row';
            this.container.appendChild(rowEl);
            this.rowEls.push(rowEl);

            const cellRow = [];
            for (let c = 0; c < cols; c++) {
                const span = document.createElement('span');
                span.textContent = ' ';
                rowEl.appendChild(span);
                cellRow.push(span);
            }
            this.cellEls.push(cellRow);
        }

        this._setScale(1);
    }

    startRenderLoop() {
        this._loopRunning = true;
        const loop = () => {
            if (!this._loopRunning) return;
            this._render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stopRenderLoop() {
        this._loopRunning = false;
    }

    _render() {
        this._renderRows();
        this._renderCursor();
        this._updateScrollIndicator();
    }

    _updateScrollIndicator() {
        const el = this._scrollIndicatorEl;
        if (!el) return;
        el.classList.toggle('visible', this.screen.viewOffset > 0);
    }

    _renderRows() {
        const screen = this.screen;
        for (const rowIdx of screen.dirtyRows) {
            if (rowIdx < 0 || rowIdx >= screen.rows) continue;
            this._renderRow(rowIdx);
        }
        screen.dirtyRows.clear();
    }

    _renderRow(rowIdx) {
        const dataRow = this._getDataRow(rowIdx);
        const cellRow = this.cellEls[rowIdx];
        const cols = this.screen.cols;

        if (!dataRow) {
            for (let c = 0; c < cols; c++) {
                const span = cellRow[c];
                span.textContent = ' ';
                span.className = '';
                span.style.cssText = '';
            }
            return;
        }

        const blended = this._blendOverlays(rowIdx, dataRow);

        for (let c = 0; c < cols; c++) {
            const cell = blended[c];
            const span = cellRow[c];

            if (cell.width === 0) {
                span.textContent = '';
                span.className = '';
                span.style.cssText = '';
                continue;
            }

            span.textContent = cell.ch || ' ';

            let fg = cell.fg;
            let bg = cell.bg;
            if (cell.inverse) { const t = fg; fg = bg; bg = t; }
            if (cell.bold && typeof fg === 'number' && fg < 8) fg += 8;

            span.className = this._spanClass(fg, bg, cell.italic, cell.underline, cell.crossedOut, cell.blink, cell.dim);

            if (cell._clipRight) {
                span.style.cssText = 'display:inline-block;width:' + this.charWidth + 'px;height:' + this.charHeight + 'px;overflow:hidden;vertical-align:top;';
            } else if (cell._clipLeft) {
                span.style.cssText = 'display:inline-block;width:' + this.charWidth + 'px;height:' + this.charHeight + 'px;overflow:hidden;text-indent:-' + this.charWidth + 'px;vertical-align:top;';
            } else {
                span.style.cssText = '';
            }
        }
    }

    _blendOverlays(displayRow, baseRow) {
        const ovs = this.screen.overlays;
        if (!ovs || !ovs.length) return baseRow;

        let covered = false;
        for (const ov of ovs) {
            if (displayRow >= ov.y && displayRow < ov.y + ov.h) {
                covered = true;
                break;
            }
        }
        if (!covered) return baseRow;

        const blended = baseRow.map(c => ({ ...c }));
        for (const ov of ovs) {
            if (displayRow >= ov.y && displayRow < ov.y + ov.h) {
                const relRow = displayRow - ov.y;
                const x0 = ov.x;
                const w = ov.w || (this.screen.cols - x0);
                for (let c = x0; c < x0 + w && c < blended.length; c++) {
                    const ovCell = ov.getCell(relRow, c - x0);
                    if (!ovCell) continue;
                    const prev = blended[c];
                    blended[c] = ovCell;
                    if (c > 0 && blended[c - 1] && blended[c - 1].width === 2) {
                        blended[c - 1] = { ...blended[c - 1], width: 1, _clipRight: true };
                    }
                    if (c + 1 < blended.length && blended[c + 1] && blended[c + 1].width === 0) {
                        blended[c + 1] = {
                            ...blended[c + 1],
                            ch: prev.ch,
                            width: 1,
                            _clipLeft: true,
                        };
                    }
                }
            }
        }
        return blended;
    }

    _getDataRow(displayRow) {
        const screen = this.screen;
        if (screen.viewOffset === 0) {
            return screen.buffer[displayRow];
        }
        const idx = screen.scrollback.length - screen.viewOffset + displayRow;
        if (idx >= 0 && idx < screen.scrollback.length) {
            return screen.scrollback[idx];
        }
        if (idx >= screen.scrollback.length) {
            return screen.buffer[idx - screen.scrollback.length];
        }
        return null;
    }

    _spanClass(fg, bg, italic, underline, crossedOut, blink, dim) {
        const parts = [];
        if (typeof fg === 'number' && fg <= 255) parts.push('q' + fg);
        else parts.push('qhi');
        if (typeof bg === 'number' && bg <= 255) parts.push('b' + bg);
        else parts.push('bhi');
        if (italic) parts.push('i');
        if (underline) parts.push('u');
        if (crossedOut) parts.push('s');
        if (blink) parts.push('blink');
        if (dim) parts.push('dim');
        return parts.join(' ');
    }

    _renderCursor() {
        const screen = this.screen;
        if (screen.cursorHidden) { this.cursorEl.className = 'hidden'; return; }
        if (screen.viewOffset !== 0 || screen.curX < 0 || screen.curX >= screen.cols) {
            this.cursorEl.className = 'hidden';
            return;
        }

        let cell = null;
        const cy = screen.curY;
        const cx = screen.curX;
        for (const ov of screen.overlays) {
            if (cy >= ov.y && cy < ov.y + ov.h && cx >= ov.x && cx < ov.x + ov.w) {
                const oc = ov.getCell(cy - ov.y, cx - ov.x);
                if (oc) { cell = oc; break; }
            }
        }
        if (!cell) {
            const row = screen.buffer[cy];
            if (!row) { this.cursorEl.className = 'hidden'; return; }
            cell = row[cx];
        }
        let fg = cell.fg;
        let bg = cell.bg;
        if (cell.inverse) { const t = fg; fg = bg; bg = t; }

        this.cursorEl.className = '';
        this.cursorEl.textContent = cell.ch;
        this.cursorEl.style.left = (screen.curX * this.charWidth) + 'px';
        this.cursorEl.style.top = (screen.curY * this.charHeight) + 'px';
        this.cursorEl.style.width = this.charWidth + 'px';
        this.cursorEl.style.height = this.charHeight + 'px';
        this.cursorEl.style.fontSize = this.charHeight + 'px';
        this.cursorEl.style.lineHeight = this.charHeight + 'px';
        this.cursorEl.style.backgroundColor = (typeof fg === 'number' && fg <= 255) ? XTERM_COLORS[fg] : (typeof fg === 'string' ? fg : '#C0C0C0');
        this.cursorEl.style.color = (typeof bg === 'number' && bg <= 255) ? XTERM_COLORS[bg] : (typeof bg === 'string' ? bg : '#000000');
    }

    _setScale(scale) {
        const screen = this.screen;
        this._scale = scale;
        this.charWidth = this._baseCharWidth * scale;
        this.charHeight = this._baseCharHeight * scale;

        const w = screen.cols * this.charWidth;
        const h = screen.rows * this.charHeight;

        this.container.style.width = w + 'px';
        this.container.style.height = h + 'px';
        this.container.style.fontSize = this.charHeight + 'px';
        this.container.style.lineHeight = this.charHeight + 'px';

        for (const el of this.rowEls) {
            el.style.height = this.charHeight + 'px';
            el.style.lineHeight = this.charHeight + 'px';
        }

        const wrapper = this.container.parentElement;
        if (wrapper) {
            wrapper.style.width = w + 'px';
            wrapper.style.height = h + 'px';
        }

        screen.markAllDirty();
    }

    fitToViewport() {
        const pad = 8;
        const maxW = window.innerWidth - pad * 2;
        const maxH = window.innerHeight - pad * 2;

        if (maxW <= 0 || maxH <= 0) return;

        const baseW = this.screen.cols * this._baseCharWidth;
        const baseH = this.screen.rows * this._baseCharHeight;

        let scale = Math.min(maxW / baseW, maxH / baseH);
        if (scale < 1) scale = 1;

        this._setScale(scale);
    }

    resizeDOM(newCols, newRows) {
        while (this.rowEls.length < newRows) {
            const rowEl = document.createElement('div');
            rowEl.className = 'row';
            this.container.appendChild(rowEl);
            this.rowEls.push(rowEl);
            const cellRow = [];
            for (let c = 0; c < newCols; c++) {
                const span = document.createElement('span');
                span.textContent = ' ';
                rowEl.appendChild(span);
                cellRow.push(span);
            }
            this.cellEls.push(cellRow);
        }
        while (this.rowEls.length > newRows) {
            this.container.removeChild(this.rowEls.pop());
            this.cellEls.pop();
        }
        for (let r = 0; r < this.rowEls.length; r++) {
            const cellRow = this.cellEls[r];
            const rowEl = this.rowEls[r];
            while (cellRow.length < newCols) {
                const span = document.createElement('span');
                span.textContent = ' ';
                rowEl.appendChild(span);
                cellRow.push(span);
            }
            while (cellRow.length > newCols) {
                rowEl.removeChild(cellRow.pop());
            }
        }
        this._setScale(this._scale);
    }
}
