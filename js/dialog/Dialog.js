import { bufWidth } from '../util/display-width.js';
import { addDragMethods, markDirtyRows } from '../util/drag.js';
import { makeCell, defaultAttr } from '../util/sgr.js';
import { parseCSI } from '../system/TextInputModel.js';
import { DEFAULT_DIALOG_WIDTH } from '../util/constants.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

const border = makeCell('│', defaultAttr(), 1);
function sameCell(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    for (const key in a) if (a[key] !== b[key]) return false;
    for (const key in b) if (a[key] !== b[key]) return false;
    return true;
}

export class Dialog {
    constructor(term, opts) {
        this.term = term;
        this.width = Math.max(2, Math.min(term.cols, opts.width || DEFAULT_DIALOG_WIDTH));
        this._headerRows = 3;
        this._footerRows = 3;
        this._scroll = 0;
        this._publishedScroll = 0;
        this._completion = null;
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
        this._fullHeight = this.h;
        this.h = Math.min(this.h, this.term.rows);
        this.x = Math.max(0, Math.min(this.x, this.term.cols - this.width));
        this.y = Math.max(0, Math.min(this.y, this.term.rows - this.h));
        this._initBuffer();
        this._buffer = this._vb.render();
        this._overlay = {
            y: this.y,
            x: this.x,
            h: this.h,
            w: this.width,
            owner: this,
            getCell: (row, col) => this._buffer?.[this._sourceRow(row, this._scroll)]?.[col] ?? null,
        };
        this.term.addOverlay(this._overlay, 'dialog');

        this._drawFrame();
        this._markDirty();
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
        const csi = parseCSI(data);
        if (this._fullHeight > this.h && csi?.final === '~' && (csi.params === '5' || csi.params === '6')) {
            const step = this.h - this._headerRows - this._footerRows;
            this._scroll = Math.max(0, Math.min(this._fullHeight - this.h,
                this._scroll + (csi.params === '5' ? -step : step)));
            this._publishBuffer();
            return;
        }
        const result = this._onKey(data);
        if (result === 'close') this.close();
    }

    refreshContent() {
        if (this.closed || !this._vb) return;
        this._renderContent();
        this._publishBuffer();
    }

    _markDirty() {
        markDirtyRows(this.term, this.y, this.h);
    }

    _bufWidth(str) { return bufWidth(str); }

    _t(row, s) {
        this._vb.writeStr(row, 0, s, this.width);
    }

    // Result callbacks run only after DialogFrame restores the parent's cursor.
    complete(callback, ...args) {
        this._completion = () => callback?.(...args);
        return 'close';
    }

    _sourceRow(row, scroll) {
        if (row < this._headerRows) return row;
        if (row >= this.h - this._footerRows) return this._fullHeight - (this.h - row);
        return row + scroll;
    }

    _ensureVisible(row, height = 1) {
        const visible = this.h - this._headerRows - this._footerRows;
        if (row < this._headerRows + this._scroll) this._scroll = row - this._headerRows;
        if (row + height > this._headerRows + this._scroll + visible)
            this._scroll = row + height - this._headerRows - visible;
        this._scroll = Math.max(0, Math.min(this._fullHeight - this.h, this._scroll));
    }

    _publishBuffer() {
        const next = this._vb.render();
        for (let r = 0; r < this.h; r++) {
            const oldRow = this._buffer?.[this._sourceRow(r, this._publishedScroll)];
            const newRow = next[this._sourceRow(r, this._scroll)];
            if (!oldRow || newRow.some((cell, c) => !sameCell(cell, oldRow[c])))
                this.term.markRowDirty(this.y + r);
        }
        this._buffer = next;
        this._publishedScroll = this._scroll;
    }

    _centerRow(row, content) {
        this._leftRow(row, content, true);
    }

    _leftRow(row, content, center = false) {
        const inner = this.width - 2;
        this._t(row, ' '.repeat(this.width));
        const x = 1 + (center ? Math.max(0, Math.floor((inner - this._bufWidth(content)) / 2)) : 0);
        this._vb.writeStr(row, x, content, this.width - 1);
        this._vb.setCell(row, 0, border);
        this._vb.setCell(row, this.width - 1, border);
    }

    _drawFrame() {
        const W = this.width;
        const H = '─';

        for (let row = 1; row < this._fullHeight - 1; row++) this._leftRow(row, '');
        this._t(0, '┌' + H.repeat(W - 2) + '┐');

        if (this.title) {
            this._centerRow(1, ' \x1B[1m' + this.title + '\x1B[22m ');
            this._t(2, '├' + H.repeat(W - 2) + '┤');
        }

        this._t(this._fullHeight - 3, '├' + H.repeat(W - 2) + '┤');
        const footer = this._fullHeight > this.h ? 'PgUp/Dn Scroll  ' + this.footer : this.footer;
        this._centerRow(this._fullHeight - 2, ' ' + footer + ' ');
        this._t(this._fullHeight - 1, '└' + H.repeat(W - 2) + '┘');
    }

    _renderContent() {}

    _initBuffer() {
        this._vb = new VirtualBuffer(this.width, this._fullHeight);
    }
}
