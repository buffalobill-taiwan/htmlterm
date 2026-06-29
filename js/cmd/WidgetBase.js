import { SystemManager } from '../shell/system.js';
import { makeCell, defaultAttr, OverlayZ, createEmptyBuffer, makeOverlayGetCell } from '../util/sgr.js';
import { addDragMethods, markDirtyRows } from '../util/drag.js';

export class WidgetBase {
    constructor() {
        this.term = SystemManager.instance.term;
        this._y = 0;
        this._x = 0;
        this._w = 0;
        this._h = 0;
        this._buffer = null;
        this._overlay = null;

        addDragMethods(this, this.term, {
            getX: () => this._x, getY: () => this._y,
            setX: v => this._x = v, setY: v => this._y = v,
            getW: () => this._w, getH: () => this._h,
            getOverlay: () => this._overlay,
        });
    }

    start() {
        this._buffer = createEmptyBuffer(this._w, this._h);
        this._overlay = {
            y: this._y,
            x: this._x,
            h: this._h,
            w: this._w,
            z: OverlayZ.WIDGET,
            owner: this,
            getCell: makeOverlayGetCell(() => this._buffer, this._w, this._h),
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

    getSaveState() {
        return { x: this._x, y: this._y };
    }

    restoreSaveState(state) {
        this.setPosition(state.x, state.y);
    }

    _markDirty() {
        markDirtyRows(this.term, this._y, this._h);
    }

    _startInterval(fn, ms) {
        this._stopInterval();
        this._intervalId = setInterval(fn, ms);
    }

    _stopInterval() {
        if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    }

    putc(x, y, ch, fg, bg, attrs) {
        if (y < 0 || y >= this._h || x < 0 || x >= this._w) return;
        const def = defaultAttr();
        const attr = Object.assign(def, attrs, {
            fg: fg != null ? fg : def.fg,
            bg: bg != null ? bg : def.bg,
        });
        this._buffer[y][x] = makeCell(ch, attr);
        this.term.markRowDirty(this._y + y);
    }
}
