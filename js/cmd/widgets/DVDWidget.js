import { term } from '../../system/sys.js';
import { WidgetBase } from '../WidgetBase.js';
import { makeCell } from '../../util/sgr.js';
import { isWide } from '../../util/unicode-width.js';

const COLORS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14];

export class DVDWidget extends WidgetBase {
    constructor(text = 'DVD') {
        super();
        this._text = text;
        let w = 0;
        for (let i = 0; i < text.length; i++) w += isWide(text[i]) ? 4 : 2;
        this._w = w;
        this._h = 2;
        const cols = term.cols;
        const rows = term.rows;
        this.setPosition(Math.floor((cols - this._w) / 2), Math.floor((rows - this._h) / 2));
        this._dx = 1;
        this._dy = 1;
        this._color = 1;
        this._intervalId = null;
        this._initPalette();
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
            text: this._text,
            dx: this._dx,
            dy: this._dy,
            color: this._color,
        };
    }

    restoreSaveState(state) {
        super.restoreSaveState(state);
        if (this._text !== state.text) {
            this._text = state.text;
            this._initPalette();
        }
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

    _initPalette() {
        this._frames = new Map();
        for (const color of COLORS) {
            const rows = [[], []];
            for (const ch of this._text) {
                const nCols = isWide(ch) ? 4 : 2;
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < nCols; c++) {
                        const cell = makeCell(ch, 7, color, false);
                        cell.clip = true;
                        cell.clipOffX = -c;
                        cell.clipOffY = -r;
                        rows[r].push(cell);
                    }
                }
            }
            this._frames.set(color, rows);
        }
    }

    draw() {
        this._buffer = this._frames.get(this._color);
        for (let r = 0; r < this._h; r++) {
            term.markRowDirty(this._y + r);
        }
    }
}
