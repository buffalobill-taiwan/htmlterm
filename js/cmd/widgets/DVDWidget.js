import { WidgetBase } from '../WidgetBase.js';

const COLORS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14];
const LOGO = [
    '       ',
    ' D V D ',
    '       ',
];

export class DVDWidget extends WidgetBase {
    constructor() {
        super();
        this._w = 7;
        this._h = 3;
        const cols = this.term.cols;
        const rows = this.term.rows;
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
    }

    _tick() {
        const oldY = this._y;
        const oldX = this._x;

        let nx = this._x + this._dx;
        let ny = this._y + this._dy;

        let bounced = false;
        if (nx < 0 || nx + this._w > this.term.cols) {
            this._dx = -this._dx;
            nx = this._x + this._dx;
            bounced = true;
        }
        if (ny < 0 || ny + this._h > this.term.rows) {
            this._dy = -this._dy;
            ny = this._y + this._dy;
            bounced = true;
        }

        if (bounced) {
            this._color = COLORS[Math.floor(Math.random() * COLORS.length)];
        }

        this.setPosition(nx, ny);

        for (let r = oldY; r < oldY + this._h; r++) {
            if (r >= 0 && r < this.term.rows) this.term.markRowDirty(r);
        }

        this.draw();
    }

    draw() {
        for (let r = 0; r < this._h; r++) {
            for (let c = 0; c < this._w; c++) {
                const ch = LOGO[r][c];
                const fg = (ch === 'D' || ch === 'V') ? 0 : this._color;
                this.putc(c, r, ch, fg, this._color);
            }
        }
    }
}
