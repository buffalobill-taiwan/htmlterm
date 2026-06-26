import { isWide } from '../unicode-width.js';
import { _writeStr } from './write.js';
import { startDrag, moveDrag, endDrag, markDirtyRows } from '../drag.js';
import { OverlayZ, isFinalByte, createEmptyBuffer } from '../sgr.js';
import { DEFAULT_DIALOG_WIDTH, CSI_INTRODUCER } from '../constants.js';

export class Dialog {
    constructor(term, opts) {
        this.term = term;
        this.width = opts.width || DEFAULT_DIALOG_WIDTH;
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
            z: OverlayZ.DIALOG,
            owner: this,
            getCell: (relRow, relCol) => {
                if (this._buffer && relRow < this.h && relCol < this.width) {
                    return this._buffer[relRow][relCol];
                }
                return null;
            }
        };
        this.term.addOverlay(this._overlay);

        this._drawFrame();
        this.refreshContent();
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        if (this._savePos) this._savePos(this.x, this.y);
        this._markDirty();
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
        moveDrag({
            obj: this, term: this.term, col, row,
            fromX: this.x, fromY: this.y,
            w: this.width, h: this.h,
            setPos: (nx, ny) => { this.x = nx; this.y = ny; },
        });
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
                if (code === CSI_INTRODUCER) continue;
                if (isFinalByte(code)) inEsc = false;
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

    _initBuffer() {
        this._buffer = createEmptyBuffer(this.width, this.h);
    }
}
