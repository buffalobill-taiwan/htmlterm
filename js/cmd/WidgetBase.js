import { makeCell } from '../sgr.js';
import { startDrag, moveDrag, endDrag, markDirtyRows } from '../drag.js';

export class WidgetBase {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this._y = 0;
        this._x = 0;
        this._w = 0;
        this._h = 0;
        this._buffer = null;
        this._overlay = null;
        this._managedPos = true;
    }

    start() {
        this._buffer = this._createEmptyBuffer();
        this._overlay = {
            y: this._y,
            x: this._x,
            h: this._h,
            w: this._w,
            z: 10,
            owner: this,
            getCell: (relRow, relCol) => {
                if (relRow < this._h && relCol < this._w && this._buffer) {
                    return this._buffer[relRow][relCol];
                }
                return null;
            }
        };
        this.term.addOverlay(this._overlay);
    }

    stop() {
        if (this._overlay) {
            for (let r = this._y; r < this._y + this._h; r++) {
                this.term.markRowDirty(r);
            }
        }
        this.term.removeOverlay(this._overlay);
        this._overlay = null;
        this._buffer = null;
    }

    draw() {}

    setPosition(x, y) {
        this._x = x;
        this._y = y;
        if (this._overlay) {
            this._overlay.x = x;
            this._overlay.y = y;
        }
    }

    getPosition() {
        return { x: this._x, y: this._y };
    }

    startDrag(col, row) {
        startDrag(this, col, row, this._x, this._y);
    }

    moveDrag(col, row) {
        moveDrag(this, this.term, col, row, this._x, this._y, this._w, this._h,
            (nx, ny) => { this._x = nx; this._y = ny; });
    }

    _markDirty() {
        markDirtyRows(this.term, this._y, this._h);
    }

    endDrag() {
        endDrag(this);
    }

    putc(x, y, ch, fg, bg, attrs) {
        if (y < 0 || y >= this._h || x < 0 || x >= this._w) return;
        const attr = {
            fg: fg != null ? fg : 7,
            bg: bg != null ? bg : 0,
            bold: attrs && attrs.bold || false,
            dim: attrs && attrs.dim || false,
            italic: attrs && attrs.italic || false,
            underline: attrs && attrs.underline || false,
            blink: attrs && attrs.blink || false,
            inverse: attrs && attrs.inverse || false,
            conceal: attrs && attrs.conceal || false,
            crossedOut: attrs && attrs.crossedOut || false,
        };
        this._buffer[y][x] = makeCell(ch, attr);
        this.term.markRowDirty(this._y + y);
    }

    _createEmptyBuffer() {
        const buf = [];
        for (let r = 0; r < this._h; r++) {
            const row = new Array(this._w);
            for (let c = 0; c < this._w; c++) {
                row[c] = null;
            }
            buf.push(row);
        }
        return buf;
    }
}