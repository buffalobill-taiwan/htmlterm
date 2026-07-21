import { bufWidth } from '../util/display-width.js';
import { addDragMethods, markDirtyRows } from '../util/drag.js';
import { OverlayZ, makeOverlayGetCell } from '../util/sgr.js';
import { DEFAULT_DIALOG_WIDTH } from '../util/constants.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

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
        this._vb = null;
        this._buffer = null;
        this._overlay = null;
        this._savePos = opts.savePos || null;

        addDragMethods(this, term, {
            getX: () => this.x, getY: () => this.y,
            setX: v => this.x = v, setY: v => this.y = v,
            getW: () => this.width, getH: () => this.h,
            getOverlay: () => this._overlay,
        });
    }

    open() {
        this._initBuffer();
        this._buffer = this._vb.render();
        this._overlay = {
            y: this.y,
            x: this.x,
            h: this.h,
            w: this.width,
            z: OverlayZ.DIALOG,
            owner: this,
            getCell: makeOverlayGetCell(() => this._buffer, this.width, this.h),
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
        this._vb = null;
        this._buffer = null;
    }

    handleKey(data) {
        if (this.closed) return;
        const result = this._onKey(data);
        if (result === 'close') this.close();
    }

    refreshContent() {
        this._renderContent();
        this._buffer = this._vb.render();
        this._markDirty();
    }

    _markDirty() {
        markDirtyRows(this.term, this.y, this.h);
    }

    _bufWidth(str) { return bufWidth(str); }

    _t(row, s) {
        this._vb.writeStr(row, 0, s, this.width);
    }

    _centerRow(row, content) {
        const W = this.width;
        const pad = Math.max(0, W - 2 - this._bufWidth(content));
        const leftPad = Math.floor(pad / 2);
        const rightPad = Math.ceil(pad / 2);
        this._vb.writeStr(row, 0, '│' + ' '.repeat(leftPad) + content + ' '.repeat(rightPad) + '│', W);
    }

    _leftRow(row, content) {
        const W = this.width;
        const pad = Math.max(0, W - 2 - this._bufWidth(content));
        this._vb.writeStr(row, 0, '│' + content + ' '.repeat(pad) + '│', W);
    }

    _drawFrame() {
        const W = this.width;
        const H = '─';

        this._t(0, '┌' + H.repeat(W - 2) + '┐');

        if (this.title) {
            this._centerRow(1, ' \x1B[1m' + this.title + '\x1B[22m ');
            this._t(2, '├' + H.repeat(W - 2) + '┤');
        }

        this._t(this.h - 3, '├' + H.repeat(W - 2) + '┤');
        this._centerRow(this.h - 2, ' ' + this.footer + ' ');
        this._t(this.h - 1, '└' + H.repeat(W - 2) + '┘');
    }

    _renderContent() {}

    _initBuffer() {
        this._vb = new VirtualBuffer(this.width, this.h);
    }
}
