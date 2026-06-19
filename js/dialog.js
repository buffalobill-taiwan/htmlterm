// ── Utility functions ──

function saveArea(term, y, h) {
    const saved = [];
    for (let r = 0; r < h && y + r < term.rows; r++) {
        const row = term.buffer[y + r];
        saved.push(row ? row.map(c => ({ ...c })) : null);
    }
    return saved;
}

function restoreArea(term, saved, y) {
    for (let r = 0; r < saved.length && y + r < term.rows; r++) {
        if (saved[r]) term.buffer[y + r] = saved[r];
    }
    term._markAllDirty();
}

function saveCursor(term) {
    return { x: term.curX, y: term.curY };
}

function restoreCursor(term, cur) {
    term.curX = cur.x;
    term.curY = cur.y;
}

// ── StateStack — nested dialog state management ──

class StateStack {
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

    isCovered(row) {
        for (const s of this._stack) {
            if (row >= s.y && row < s.y + s.h) return true;
        }
        return false;
    }

    push(y, h) {
        this._stack.push({
            y,
            h,
            saved: saveArea(this.term, y, h),
            cursor: saveCursor(this.term),
            cursorHidden: this.term._cursorHidden,
        });
        this.term._cursorHidden = true;
        this.term.write('\x1B[?25l');
    }

    pop() {
        const state = this._stack.pop();
        if (!state) return;
        this.term._cursorHidden = state.cursorHidden;
        this.term.write(state.cursorHidden ? '\x1B[?25l' : '\x1B[?25h');
        restoreCursor(this.term, state.cursor);
        restoreArea(this.term, state.saved, state.y);
        for (const fn of this._restoreHooks) fn();
    }

    get depth() {
        return this._stack.length;
    }
}

// ── Dialog base class ──

class Dialog {
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
        this._savedArea = null;
        this._savedCursor = null;
    }

    open() {
        if (this.stack) {
            this.stack.push(this.y, this.h);
        } else {
            this._savedArea = saveArea(this.term, this.y, this.h);
            this._savedCursor = saveCursor(this.term);
            this.term.write('\x1B[?25l');
        }
        this._drawFrame();
        this._renderContent();
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        if (this.stack) {
            this.stack.pop();
        } else {
            if (this._savedArea) {
                restoreArea(this.term, this._savedArea, this.y);
                this._savedArea = null;
            }
            if (this._savedCursor) {
                restoreCursor(this.term, this._savedCursor);
                this._savedCursor = null;
            }
            this.term.write('\x1B[?25h');
        }
    }

    handleKey(data) {
        if (this.closed) return;
        const result = this._onKey(data);
        if (result === 'close') this.close();
    }

    refreshContent() {
        this._renderContent();
    }

    _bufWidth(str) {
        if (!str) return 0;
        let w = 0;
        for (const ch of str) {
            w += this.term._isWide(ch) ? 2 : 1;
        }
        return w;
    }

    _t(row, s) {
        this.term.write(`\x1B[${this.y + 1 + row};${this.x + 1}H${s}`);
    }

    _drawFrame() {
        const W = this.width;
        const V = '\u2502';
        const H = '\u2500';

        this._t(0, '\u250C' + H.repeat(W - 2) + '\u2510');

        const title = this.title;
        const titlePad = W - 4 - this._bufWidth(title);
        const titleL = Math.floor(titlePad / 2);
        const titleR = Math.ceil(titlePad / 2);
        this._t(1, V + ' ' + ' '.repeat(titleL) + '\x1B[1m' + title + '\x1B[22m' + ' '.repeat(titleR) + ' ' + V);

        this._t(2, '\u251C' + H.repeat(W - 2) + '\u2524');

        this._t(this.h - 3, '\u251C' + H.repeat(W - 2) + '\u2524');

        const foot = this.footer;
        const footPad = W - 4 - this._bufWidth(foot);
        const footL = Math.floor(footPad / 2);
        const footR = Math.ceil(footPad / 2);
        this._t(this.h - 2, V + ' ' + ' '.repeat(footL) + foot + ' '.repeat(footR) + ' ' + V);

        this._t(this.h - 1, '\u2514' + H.repeat(W - 2) + '\u2518');
    }

    _renderContent() {}

    _onKey(data) {
        if (data.length === 1 && (data.charCodeAt(0) === 0x1B || data.charCodeAt(0) === 0x03)) {
            return 'close';
        }
    }
}

// ── MenuDialog ──

class MenuDialog extends Dialog {
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
            const row = this.y + 3 + i;
            if (idx < this.items.length) {
                this._drawItem(idx, row, this.x);
            } else {
                this.term.write(`\x1B[${row + 1};${this.x + 1}H\u2502${' '.repeat(this.width - 3)}`);
            }
        }
        this._drawScrollBar();
    }

    _drawItem(index, row, col) {
        const item = this.items[index];
        const sel = index === this.selected;
        const contentWidth = this.width - 3;
        const namePadded = item.name.padEnd(10);
        const content = '  ' + namePadded + '  ' + item.desc;
        const bufW = this._bufWidth(content);
        const pad = contentWidth - bufW;

        this.term.write(`\x1B[${row + 1};${col + 1}H\u2502`);
        if (sel) this.term.write('\x1B[7m\x1B[1m');
        this.term.write(content + ' '.repeat(Math.max(0, pad)));
        if (sel) this.term.write('\x1B[0m');
    }

    _drawScrollBar() {
        const total = this.items.length;
        const visible = this.visibleCount;
        const offset = this.scrollOffset;
        const Y = this.y + 3;
        const X = this.x + this.width - 2;

        if (total <= visible) {
            for (let i = 0; i < visible; i++) {
                this.term.write(`\x1B[${Y + i + 1};${X + 1}H \u2502`);
            }
            return;
        }

        const maxOffset = total - visible;
        const thumbRow = maxOffset > 0 ? Math.round((offset / maxOffset) * (visible - 1)) : 0;

        for (let i = 0; i < visible; i++) {
            const idx = offset + i;
            if (idx >= total) {
                this.term.write(`\x1B[${Y + i + 1};${X + 1}H \u2502`);
                continue;
            }
            const scrollCh = (i === thumbRow) ? '\u2588' : '\u2591';
            this.term.write(`\x1B[${Y + i + 1};${X + 1}H${scrollCh}\u2502`);
        }
    }

    _onKey(data) {
        if (data.length > 1) {
            if (data === '\x1B[A') {
                if (this.selected > 0) {
                    this.selected--;
                    if (this.selected < this.scrollOffset) {
                        this.scrollOffset = this.selected;
                        this._renderContent();
                    } else {
                        const Y = this.y + 3;
                        const X = this.x;
                        this._drawItem(this.selected, Y + this.selected - this.scrollOffset, X);
                        this._drawItem(this.selected + 1, Y + this.selected + 1 - this.scrollOffset, X);
                        this._drawScrollBar();
                    }
                }
                return;
            }
            if (data === '\x1B[B') {
                if (this.selected < this.items.length - 1) {
                    this.selected++;
                    if (this.selected >= this.scrollOffset + this.visibleCount) {
                        this.scrollOffset = this.selected - this.visibleCount + 1;
                        this._renderContent();
                    } else {
                        const Y = this.y + 3;
                        const X = this.x;
                        this._drawItem(this.selected - 1, Y + this.selected - 1 - this.scrollOffset, X);
                        this._drawItem(this.selected, Y + this.selected - this.scrollOffset, X);
                        this._drawScrollBar();
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

class InputDialog extends Dialog {
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
        const cx = this.x + 4 + bufW;
        const cy = this.y + 4;
        this.term.write(`\x1B[${cy + 1};${cx + 1}H\x1B[?25h`);
    }

    _renderContent() {
        const W = this.width;
        const V = '\u2502';

        const promptLine = '  ' + this.prompt;
        const promptPad = W - 2 - this._bufWidth(promptLine);
        this._t(3, V + promptLine + ' '.repeat(Math.max(0, promptPad)) + V);

        const inputLine = ' > ' + this.inputText;
        const inputPad = W - 2 - this._bufWidth(inputLine);
        this._t(4, V + inputLine + ' '.repeat(Math.max(0, inputPad)) + V);
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
                this._renderContent();
                this._showCursor();
            }
            return;
        }
        if (code >= 0x20) {
            this.inputText += data;
            this._renderContent();
            this._showCursor();
            return;
        }
    }
}
