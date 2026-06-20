/**
 * Dialog framework for nested modal dialogs.
 *
 * StateStack manages cursor state and z-order across dialog layers.
 * Dialog base class handles frame drawing and key dispatch.
 *
 * All dialogs render into their own buffer, registered as an overlay
 * on the terminal for compositing at render time.
 */

// ── SGR parsing helpers ──

const _defaultAttr = () => ({ fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false });

function _applySGR(attr, params) {
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p === 0) Object.assign(attr, _defaultAttr());
        else if (p === 1) attr.bold = true;
        else if (p === 2) attr.dim = true;
        else if (p === 3) attr.italic = true;
        else if (p === 4) attr.underline = true;
        else if (p === 5 || p === 6) attr.blink = true;
        else if (p === 7) attr.inverse = true;
        else if (p === 8) attr.conceal = true;
        else if (p === 9) attr.crossedOut = true;
        else if (p === 21 || p === 22) { attr.bold = false; attr.dim = false; }
        else if (p === 23) attr.italic = false;
        else if (p === 24) attr.underline = false;
        else if (p === 25) attr.blink = false;
        else if (p === 27) attr.inverse = false;
        else if (p === 28) attr.conceal = false;
        else if (p === 29) attr.crossedOut = false;
        else if (p >= 30 && p <= 37) attr.fg = p - 30;
        else if (p === 39) attr.fg = 7;
        else if (p >= 40 && p <= 47) attr.bg = p - 40;
        else if (p === 49) attr.bg = 0;
        else if (p >= 90 && p <= 97) attr.fg = p - 90 + 8;
        else if (p >= 100 && p <= 107) attr.bg = p - 100 + 8;
    }
}

function _makeCell(ch, attr) {
    return {
        ch: ch || ' ',
        fg: attr.fg,
        bg: attr.bg,
        bold: attr.bold,
        dim: attr.dim,
        italic: attr.italic,
        underline: attr.underline,
        blink: attr.blink,
        inverse: attr.inverse,
        conceal: attr.conceal,
        crossedOut: attr.crossedOut,
        width: 1,
    };
}

function _writeStr(buf, y, x, str, maxX) {
    let attr = _defaultAttr();
    let cx = x;
    let i = 0;
    while (i < str.length) {
        const code = str.charCodeAt(i);
        if (code === 0x1B) {
            i++;
            if (i >= str.length) break;
            if (str[i] === '[') {
                i++;
                let pStr = '';
                while (i < str.length) {
                    const c = str.charCodeAt(i);
                    if (c >= 0x30 && c <= 0x3F) { pStr += str[i]; i++; }
                    else break;
                }
                if (i < str.length && str.charCodeAt(i) === 0x6D) {
                    const params = pStr ? pStr.split(';').map(s => parseInt(s, 10)).filter(n => !isNaN(n)) : [];
                    _applySGR(attr, params);
                }
                i++;
            }
            continue;
        }
        if (cx >= (maxX || buf[y].length)) break;
        buf[y][cx] = _makeCell(str[i], attr);
        cx++;
        i++;
    }
}

// ── StateStack — nested state management ──

export class StateStack {
    constructor(term) {
        this.term = term;
        this._stack = [];
        this._restoreHooks = [];
    }

    addRestoreHook(fn) {
        this._restoreHooks.push(fn);
    }

    removeRestoreHook(fn) {
        const i = this._restoreHooks.indexOf(fn);
        if (i >= 0) this._restoreHooks.splice(i, 1);
    }

    push(y, h) {
        this._stack.push({
            y, h,
            cursor: { x: this.term.curX, y: this.term.curY },
            cursorHidden: this.term.cursorHidden,
        });
        this.term.cursorHidden = true;
        this.term.write('\x1B[?25l');
    }

    pop() {
        const state = this._stack.pop();
        if (!state) return;
        this.term.cursorHidden = state.cursorHidden;
        this.term.write(state.cursorHidden ? '\x1B[?25l' : '\x1B[?25h');
        this.term.curX = state.cursor.x;
        this.term.curY = state.cursor.y;
        for (const fn of this._restoreHooks) fn();
    }

    get depth() {
        return this._stack.length;
    }
}

// ── Dialog base class ──

export class Dialog {
    constructor(term, opts) {
        this.term = term;
        this.stack = opts.stack || null;
        this.width = opts.width || 40;
        this.title = opts.title || '';
        this.footer = opts.footer || '';
        this.closed = false;
        this.x = 0;
        this.y = 0;
        this.h = 0;
        this._buffer = null;
        this._overlay = null;
    }

    open() {
        this._initBuffer();
        this._overlay = {
            y: this.y,
            x: this.x,
            h: this.h,
            w: this.width,
            z: 100,
            getCell: (relRow, relCol) => {
                if (this._buffer && relRow < this.h && relCol < this.width) {
                    return this._buffer[relRow][relCol];
                }
                return null;
            }
        };
        this.term.addOverlay(this._overlay);

        if (this.stack) {
            this.stack.push(this.y, this.h);
        } else {
            this.term.cursorHidden = true;
            this.term.write('\x1B[?25l');
        }

        this._drawFrame();
        this.refreshContent();
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this._markDirty();
        if (this.stack) {
            this.stack.pop();
        } else {
            this.term.cursorHidden = false;
            this.term.write('\x1B[?25h');
        }
        this.term.removeOverlay(this._overlay);
        this._overlay = null;
        this._buffer = null;
    }

    handleKey(data) {
        if (this.closed) return;
        const result = this._onKey(data);
        if (result === 'close') this.close();
    }

    refreshContent() {
        this._renderContent();
        this._markDirty();
    }

    _markDirty() {
        for (let r = 0; r < this.h; r++) {
            this.term.markRowDirty(this.y + r);
        }
    }

    _bufWidth(str) {
        if (!str) return 0;
        let w = 0;
        let inEsc = false;
        for (const ch of str) {
            const code = ch.charCodeAt(0);
            if (code === 0x1B) { inEsc = true; continue; }
            if (inEsc) {
                if (code === 0x5B) continue;
                if (code >= 0x40 && code <= 0x7E) inEsc = false;
                continue;
            }
            w += this.term.isWide(ch) ? 2 : 1;
        }
        return w;
    }

    _t(row, s) {
        _writeStr(this._buffer, row, 0, s, this.width);
    }

    _centerRow(row, content) {
        const W = this.width;
        const pad = Math.max(0, W - 2 - this._bufWidth(content));
        const leftPad = Math.floor(pad / 2);
        const rightPad = Math.ceil(pad / 2);
        _writeStr(this._buffer, row, 0, '\u2502' + ' '.repeat(leftPad) + content + ' '.repeat(rightPad) + '\u2502', W);
    }

    _leftRow(row, content) {
        const W = this.width;
        const pad = Math.max(0, W - 2 - this._bufWidth(content));
        _writeStr(this._buffer, row, 0, '\u2502' + content + ' '.repeat(pad) + '\u2502', W);
    }

    _drawFrame() {
        const W = this.width;
        const H = '\u2500';

        this._t(0, '\u250C' + H.repeat(W - 2) + '\u2510');

        if (this.title) {
            this._centerRow(1, ' \x1B[1m' + this.title + '\x1B[22m ');
            this._t(2, '\u251C' + H.repeat(W - 2) + '\u2524');
        }

        this._t(this.h - 3, '\u251C' + H.repeat(W - 2) + '\u2524');
        this._centerRow(this.h - 2, ' ' + this.footer + ' ');
        this._t(this.h - 1, '\u2514' + H.repeat(W - 2) + '\u2518');
    }

    _renderContent() {}

    _onKey(data) {
        if (data.length === 1 && (data.charCodeAt(0) === 0x1B || data.charCodeAt(0) === 0x03)) {
            return 'close';
        }
    }

    _initBuffer() {
        this._buffer = [];
        for (let r = 0; r < this.h; r++) {
            const row = new Array(this.width);
            for (let c = 0; c < this.width; c++) {
                row[c] = null;
            }
            this._buffer.push(row);
        }
    }
}

// ── MenuDialog ──

export class MenuDialog extends Dialog {
    constructor(term, items, opts) {
        const width = opts.width || 44;
        const visibleCount = opts.visibleCount || 5;
        const h = visibleCount + 6;
        const x = Math.floor((term.cols - width) / 2);
        const y = Math.floor((term.rows - h) / 2);

        super(term, { ...opts, width });

        this.x = x;
        this.y = Math.max(0, y - 1);
        this.h = h;
        this.items = items;
        this.visibleCount = visibleCount;
        this.selected = 0;
        this.scrollOffset = 0;
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _renderContent() {
        for (let i = 0; i < this.visibleCount; i++) {
            const idx = this.scrollOffset + i;
            const r = 3 + i;
            if (idx < this.items.length) {
                this._drawItem(idx, r);
            } else {
                _writeStr(this._buffer, r, 0, '\u2502' + ' '.repeat(this.width - 3));
            }
        }
        this._drawScrollBar();
    }

    _drawItem(index, bufRow) {
        const item = this.items[index];
        const sel = index === this.selected;
        const contentWidth = this.width - 3;
        const namePadded = item.name.padEnd(10);
        const content = '  ' + namePadded + '  ' + item.desc;
        const bufW = this._bufWidth(content);
        const pad = contentWidth - bufW;

        let s = '\u2502';
        if (sel) s += '\x1B[7m\x1B[1m';
        s += content + ' '.repeat(Math.max(0, pad));
        if (sel) s += '\x1B[0m';
        _writeStr(this._buffer, bufRow, 0, s, this.width);
    }

    _drawScrollBar() {
        const total = this.items.length;
        const visible = this.visibleCount;
        const offset = this.scrollOffset;
        const startRow = 3;
        const col = this.width - 2;

        if (total <= visible) {
            for (let i = 0; i < visible; i++) {
                _writeStr(this._buffer, startRow + i, col, ' \u2502', this.width);
            }
            return;
        }

        const maxOffset = total - visible;
        const thumbRow = maxOffset > 0 ? Math.round((offset / maxOffset) * (visible - 1)) : 0;

        for (let i = 0; i < visible; i++) {
            const idx = offset + i;
            if (idx >= total) {
                _writeStr(this._buffer, startRow + i, col, ' \u2502', this.width);
                continue;
            }
            const ch = (i === thumbRow) ? '\u2588' : '\u2591';
            _writeStr(this._buffer, startRow + i, col, ch + '\u2502', this.width);
        }
    }

    _onKey(data) {
        if (data.length > 1) {
            if (data === '\x1B[A') {
                if (this.selected > 0) {
                    this.selected--;
                    if (this.selected < this.scrollOffset) {
                        this.scrollOffset = this.selected;
                        this.refreshContent();
                    } else {
                        this._drawItem(this.selected, 3 + this.selected - this.scrollOffset);
                        this._drawItem(this.selected + 1, 3 + this.selected + 1 - this.scrollOffset);
                        this._drawScrollBar();
                        this._markDirty();
                    }
                }
                return;
            }
            if (data === '\x1B[B') {
                if (this.selected < this.items.length - 1) {
                    this.selected++;
                    if (this.selected >= this.scrollOffset + this.visibleCount) {
                        this.scrollOffset = this.selected - this.visibleCount + 1;
                        this.refreshContent();
                    } else {
                        this._drawItem(this.selected - 1, 3 + this.selected - 1 - this.scrollOffset);
                        this._drawItem(this.selected, 3 + this.selected - this.scrollOffset);
                        this._drawScrollBar();
                        this._markDirty();
                    }
                }
                return;
            }
            return;
        }

        const code = data.charCodeAt(0);
        if (code === 0x0D || code === 0x0A) {
            const result = this._onSelect(this.items[this.selected]);
            if (result === 'close') return 'close';
            return;
        }
        if (code === 0x1B || code === 0x03) {
            this._onCancel();
            return 'close';
        }
    }
}

// ── InputDialog ──

export class InputDialog extends Dialog {
    constructor(term, opts) {
        const width = opts.width || 40;
        const h = 8;
        const x = Math.floor((term.cols - width) / 2);
        const y = Math.floor((term.rows - h) / 2);

        super(term, { ...opts, width });

        this.x = x;
        this.y = Math.max(0, y - 1);
        this.h = h;
        this.prompt = opts.prompt || '';
        this.inputText = '';
        this._onConfirm = opts.onConfirm || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    open() {
        super.open();
        this._showCursor();
    }

    _showCursor() {
        const bufW = this._bufWidth(this.inputText);
        const cx = 4 + bufW;
        const cy = 4;
        const ch = ' ';
        const attr = { fg: 0, bg: 7, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: true, conceal: false, crossedOut: false };
        if (cx < this.width) {
            this._buffer[cy][cx] = _makeCell(ch, attr);
        }
        this.term.markRowDirty(this.y + cy);
    }

    _renderContent() {
        this._leftRow(3, '  ' + this.prompt);
        this._leftRow(4, ' > ' + this.inputText);
        this._showCursor();
    }

    _onKey(data) {
        if (data.length > 1) return;

        const code = data.charCodeAt(0);
        if (code === 0x0D || code === 0x0A) {
            this._onConfirm(this.inputText);
            return 'close';
        }
        if (code === 0x1B || code === 0x03) {
            this._onCancel();
            return 'close';
        }
        if (code === 0x7F || code === 0x08) {
            if (this.inputText.length > 0) {
                this.inputText = this.inputText.slice(0, -1);
                this.refreshContent();
            }
            return;
        }
        if (code >= 0x20) {
            this.inputText += data;
            this.refreshContent();
            return;
        }
    }
}

// ── ClockDialog ──

export class ClockDialog extends Dialog {
    constructor(term, opts) {
        super(term, Object.assign({ width: 22, footer: 'ESC/Enter to exit', title: null }, opts));
        this.h = 6;
        this.x = Math.floor((term.cols - this.width) / 2);
        this.y = Math.floor((term.rows - this.h) / 2);
        this._onExit = opts.onExit || null;
    }

    _renderContent() {
        _writeStr(this._buffer, 1, 0, '\u2502' + ' '.repeat(this.width - 2) + '\u2502', this.width);
        this._centerRow(2, '\x1B[7m  EXIT  \x1B[0m');
    }

    _onKey(data) {
        if (data.length !== 1) return;
        const code = data.charCodeAt(0);
        if (code === 0x1B || code === 0x03 || code === 0x0D || code === 0x0A) {
            if (this._onExit) this._onExit();
            return 'close';
        }
    }
}

// ── ShowDialog ──

export class ShowDialog extends Dialog {
    constructor(term, opts) {
        super(term, Object.assign({ width: 40, footer: 'ESC to back', title: null }, opts));
        this.message = opts.message || '';
        this._lines = this.message.split('\n');
        const h = Math.max(4, this._lines.length + 4);
        this.h = h;
        this.x = Math.floor((term.cols - this.width) / 2);
        this.y = Math.floor((term.rows - h) / 2);
        this._onExit = opts.onExit || null;
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(1 + i, this._lines[i]);
        }
    }

    _onKey(data) {
        if (data.length !== 1) return;
        const code = data.charCodeAt(0);
        if (code === 0x1B || code === 0x03 || code === 0x0D || code === 0x0A) {
            if (this._onExit) this._onExit();
            return 'close';
        }
    }
}