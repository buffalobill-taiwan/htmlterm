import { defaultAttr, applySGR, makeCell, isWide } from '../sgr.js';
import { startDrag, moveDrag, endDrag, markDirtyRows } from '../drag.js';

export function _writeStr(buf, y, x, str, maxX) {
    let attr = defaultAttr();
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
                    applySGR(attr, params);
                }
                i++;
            }
            continue;
        }
        if (cx >= (maxX || buf[y].length)) break;
        const w = isWide(str[i]) ? 2 : 1;
        if (cx + w > (maxX || buf[y].length)) break;
        buf[y][cx] = makeCell(str[i], attr, w);
        if (w === 2 && cx + 1 < (maxX || buf[y].length)) {
            buf[y][cx + 1] = { width: 0 };
        }
        cx += w;
        i++;
    }
}

export class Dialog {
    constructor(term, opts) {
        this.term = term;
        this.stack = opts.stack || null;
        this.width = opts.width || 40;
        this.title = opts.title || '';
        this.footer = opts.footer || '';
        this.closed = false;
        this.x = opts.x != null ? opts.x : 0;
        this.y = opts.y != null ? opts.y : 0;
        this.h = 0;
        this._buffer = null;
        this._overlay = null;
        this._savePos = opts.savePos || null;
    }

    open() {
        this._initBuffer();
        this._overlay = {
            y: this.y,
            x: this.x,
            h: this.h,
            w: this.width,
            z: 100,
            owner: this,
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
        if (this._savePos) this._savePos(this.x, this.y);
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

    startDrag(col, row) {
        startDrag(this, col, row, this.x, this.y);
    }

    moveDrag(col, row) {
        moveDrag(this, this.term, col, row, this.x, this.y, this.width, this.h,
            (nx, ny) => { this.x = nx; this.y = ny; });
    }

    endDrag() {
        endDrag(this);
    }

    _markDirty() {
        markDirtyRows(this.term, this.y, this.h);
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
            w += isWide(ch) ? 2 : 1;
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
