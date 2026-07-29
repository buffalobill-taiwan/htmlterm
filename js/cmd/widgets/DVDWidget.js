import { term } from '../../system/sys.js';
import { WidgetBase } from '../WidgetBase.js';
import { makeCell } from '../../util/sgr.js';

const COLORS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14];

export class DVDWidget extends WidgetBase {
    constructor() {
        super();
        this._w = 6;
        this._h = 2;
        const cols = term.cols;
        const rows = term.rows;
        this.setPosition(Math.floor((cols - this._w) / 2), Math.floor((rows - this._h) / 2));
        this._dx = 1;
        this._dy = 1;
        this._color = 1;
        this._intervalId = null;
    }

    start() {
        super.start();
        this.draw();
        this._startInterval(() => this._tick(), 120);
    }

    stop() {
        this._stopInterval();
        super.stop();
    }

    getSaveState() {
        return {
            ...super.getSaveState(),
            dx: this._dx,
            dy: this._dy,
            color: this._color,
        };
    }

    restoreSaveState(state) {
        super.restoreSaveState(state);
        this._dx = state.dx;
        this._dy = state.dy;
        this._color = state.color;
    }

    startDrag(col, row) {
        this._stopInterval();
        super.startDrag(col, row);
    }

    endDrag() {
        this._startInterval(() => this._tick(), 120);
        super.endDrag();
    }

    _tick() {
        if (this._dragOffX !== undefined) {
            this.draw();
            return;
        }

        const oldY = this._y;

        let nx = this._x + this._dx;
        let ny = this._y + this._dy;

        let bounced = false;
        if (nx < 0 || nx + this._w > term.cols) {
            this._dx = -this._dx;
            nx = this._x + this._dx;
            bounced = true;
        }
        if (ny < 0 || ny + this._h > term.rows) {
            this._dy = -this._dy;
            ny = this._y + this._dy;
            bounced = true;
        }

        if (bounced) {
            this._color = COLORS[Math.floor(Math.random() * COLORS.length)];
        }

        this.setPosition(nx, ny);

        for (let r = oldY; r < oldY + this._h; r++) {
            if (r >= 0 && r < term.rows) term.markRowDirty(r);
        }

        this.draw();
    }

    draw() {
        const text = 'DVD';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 2; c++) {
                    const x = i * 2 + c;
                    const cell = makeCell(ch, { fg: 0, bg: this._color }, 1);
                    cell.clip = true;
                    cell.clipOffX = -c;
                    cell.clipOffY = -r;
                    this._buffer[r][x] = cell;
                }
            }
        }
        for (let r = 0; r < this._h; r++) {
            term.markRowDirty(this._y + r);
        }
    }
}
