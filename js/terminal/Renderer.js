import { CHAR_WIDTH, CHAR_HEIGHT } from '../util/constants.js';

export class Renderer {
    constructor(container, screen, opts = {}) {
        this.container = container;
        this.screen = screen;
        this._baseCharWidth = opts.charWidth || CHAR_WIDTH;
        this._baseCharHeight = opts.charHeight || CHAR_HEIGHT;
        this.charWidth = this._baseCharWidth;
        this.charHeight = this._baseCharHeight;
        this._scale = 1;
        this._loopRunning = false;

        this.rowEls = [];
        this.cellEls = [];
        this.cursorEl = null;
        this._lastCursor = null;

        // Reused objects to avoid per-frame allocations
        this._swapFg = 0;
        this._swapBg = 0;
        this._classParts = [];
        this._classCache = new Map();
        this._blendRow = null;
        // Two reused cursor state objects — ping-pong to avoid allocation
        this._cursorA = { x: 0, y: 0, ch: '', fg: 0, bg: 0, w: 0, h: 0 };
        this._cursorB = { x: 0, y: 0, ch: '', fg: 0, bg: 0, w: 0, h: 0 };
        this._cursorCurrent = null;  // points to _cursorA or _cursorB (null = hidden)

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
        // Set.forEach avoids the hidden iterator object that for...of allocates.
        screen.dirtyRows.forEach((rowIdx) => {
            if (rowIdx >= 0 && rowIdx < screen.rows) this._renderRow(rowIdx);
        });
        screen.dirtyRows.clear();
    }

    // Inline helper: swaps fg/bg if cell.inverse, writes to reused objects
    _swapInverse(fg, bg, cell) {
        if (cell.inverse) {
            this._swapFg = bg;
            this._swapBg = fg;
        } else {
            this._swapFg = fg;
            this._swapBg = bg;
        }
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
                if (span.textContent === '' && span.className === '' && span.style.cssText === '') continue;
                span.textContent = '';
                span.className = '';
                span.style.cssText = '';
                continue;
            }

            const text = cell.ch || ' ';

            this._swapInverse(cell.fg, cell.bg, cell);
            let fg = this._swapFg;
            let bg = this._swapBg;
            if (cell.bold && typeof fg === 'number' && fg < 8) fg += 8;

            const cls = this._spanClass(fg, bg, cell.italic, cell.underline, cell.crossedOut, cell.blink, cell.dim);

            let cssText;
            if (cell.clip) {
                const ox = (cell.clipOffX || 0) * this.charWidth;
                const oy = (cell.clipOffY || 0) * this.charHeight;
                span.innerHTML = '<span style="position:absolute;left:' + ox + 'px;top:' + oy + 'px">' + text + '</span>';
                cssText = 'position:relative;display:inline-block;width:' + this.charWidth + 'px;height:' + this.charHeight + 'px;font-size:' + (this.charHeight * 2) + 'px;line-height:' + (this.charHeight * 2) + 'px;overflow:hidden;vertical-align:top;';
            } else if (cell._clipRight) {
                cssText = 'display:inline-block;width:' + this.charWidth + 'px;height:' + this.charHeight + 'px;overflow:hidden;vertical-align:top;';
            } else if (cell._clipLeft) {
                cssText = 'display:inline-block;width:' + this.charWidth + 'px;height:' + this.charHeight + 'px;overflow:hidden;text-indent:-' + this.charWidth + 'px;vertical-align:top;';
            } else {
                cssText = '';
            }

            if (span.textContent === text && span.className === cls && span.style.cssText === cssText) continue;
            span.textContent = text;
            span.className = cls;
            span.style.cssText = cssText;
        }
    }

    _blendOverlays(displayRow, baseRow) {
        const ovs = this.screen.overlays;
        if (!ovs || !ovs.length) return baseRow;

        let modified = false;
        for (let oi = 0; oi < ovs.length; oi++) {
            const ov = ovs[oi];
            if (displayRow >= ov.y && displayRow < ov.y + ov.h) {
                const relRow = displayRow - ov.y;
                const x0 = ov.x;
                const w = ov.w || (this.screen.cols - x0);
                for (let c = x0; c < x0 + w && c < baseRow.length; c++) {
                    const ovCell = ov.getCell(relRow, c - x0);
                    if (!ovCell) continue;
                    if (ovCell.width === 0) continue;
                    if (!modified) {
                        let blendRow = this._blendRow;
                        if (!blendRow || blendRow.length !== baseRow.length) {
                            blendRow = baseRow.slice();
                            this._blendRow = blendRow;
                        } else {
                            for (let i = 0; i < baseRow.length; i++) blendRow[i] = baseRow[i];
                        }
                        baseRow = blendRow;
                        modified = true;
                    }
                    if (ovCell.width === 2) {
                        baseRow[c] = { ...ovCell, width: 1, _clipRight: true };
                        if (c + 1 < baseRow.length) {
                            baseRow[c + 1] = { ...ovCell, width: 1, _clipLeft: true };
                        }
                        continue;
                    }
                    const prev = baseRow[c];
                    if (prev && prev.width >= 2) {
                        baseRow[c] = {
                            ch: ovCell.ch, fg: ovCell.fg, bg: ovCell.bg,
                            bold: ovCell.bold, dim: ovCell.dim, italic: ovCell.italic,
                            underline: ovCell.underline, blink: ovCell.blink,
                            inverse: ovCell.inverse, conceal: ovCell.conceal,
                            crossedOut: ovCell.crossedOut, width: 1, _clipRight: true,
                        };
                        if (c + 1 < baseRow.length) {
                            baseRow[c + 1] = {
                                ch: prev.ch, fg: prev.fg, bg: prev.bg,
                                bold: prev.bold, dim: prev.dim, italic: prev.italic,
                                underline: prev.underline, blink: prev.blink,
                                inverse: prev.inverse, conceal: prev.conceal,
                                crossedOut: prev.crossedOut, width: 1, _clipLeft: true,
                            };
                        }
                    } else {
                        baseRow[c] = ovCell;
                    }
                }
            }
        }
        return baseRow;
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
        const flags = (italic ? 1 : 0) | (underline ? 2 : 0) | (crossedOut ? 4 : 0) |
                      (blink ? 8 : 0) | (dim ? 16 : 0);
        let key;
        if (typeof fg === 'number' && fg <= 255 && typeof bg === 'number' && bg <= 255) {
            key = ((fg << 8) | bg) << 5 | flags;
        } else {
            key = fg + '\0' + bg + '\0' + flags;
        }
        let s = this._classCache.get(key);
        if (s === undefined) {
            s = this._buildClassStr(fg, bg, italic, underline, crossedOut, blink, dim);
            this._classCache.set(key, s);
        }
        return s;
    }

    _buildClassStr(fg, bg, italic, underline, crossedOut, blink, dim) {
        const parts = this._classParts;
        parts.length = 0;
        if (typeof fg === 'number' && fg <= 255) parts.push('q' + fg);
        else parts.push('qhi');
        if (typeof bg === 'number' && bg <= 255) parts.push('b' + bg);
        else parts.push('bhi');
        if (italic) parts.push('i');
        if (underline) parts.push('u');
        if (crossedOut) parts.push('s');
        if (blink) parts.push('blink');
        if (dim) parts.push('dim');
        const s = parts.join(' ');
        parts.length = 0;
        return s;
    }

    _renderCursor() {
        const screen = this.screen;
        const hidden = screen.cursorHidden || screen.viewOffset !== 0
            || screen.curX < 0 || screen.curX >= screen.cols;

        const cell = hidden ? null : screen.getCellAt(screen.curX, screen.curY);
        let rawFg = 0, rawBg = 0;
        if (cell) {
            this._swapInverse(cell.fg, cell.bg, cell);
            rawFg = this._swapFg;
            rawBg = this._swapBg;
        }

        // Pick the slot that is NOT currently used as _cursorCurrent for writing
        const nc = (this._cursorCurrent === this._cursorA) ? this._cursorB : this._cursorA;

        let next = null;
        if (!hidden) {
            nc.x = screen.curX;
            nc.y = screen.curY;
            nc.ch = cell.ch;
            nc.fg = rawFg;
            nc.bg = rawBg;
            nc.w = this.charWidth;
            nc.h = this.charHeight;
            next = nc;
        }

        const prev = this._cursorCurrent;

        if (!next && !prev) return; // still hidden
        if (next && prev &&
            next.x === prev.x && next.y === prev.y &&
            next.ch === prev.ch && next.fg === prev.fg && next.bg === prev.bg &&
            next.w === prev.w && next.h === prev.h) return; // unchanged

        this._cursorCurrent = next;

        if (!next) {
            this.cursorEl.className = 'hidden';
            return;
        }

        this.cursorEl.className = 'b' + next.fg + ' q' + next.bg;
        this.cursorEl.textContent = next.ch;
        this.cursorEl.style.cssText =
            `left:${next.x * next.w}px;top:${next.y * next.h}px;` +
            `width:${next.w}px;height:${next.h}px;` +
            `font-size:${next.h}px;line-height:${next.h}px;`;
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
        this._cursorCurrent = null;
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
