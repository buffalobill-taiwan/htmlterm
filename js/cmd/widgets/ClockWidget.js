import { SystemManager } from '../../system.js';
import { WidgetBase } from '../WidgetBase.js';
import { formatTime } from '../../sgr.js';

export class ClockWidget extends WidgetBase {
    constructor(opts = {}) {
        super();
        this._w = 8;
        this._x = SystemManager.instance.term.cols - this._w;
        this._h = 1;
        this._bg = opts.bg != null ? opts.bg : 4;
        this._intervalId = null;
    }

    start() {
        super.start();
        this.draw();
        this._startInterval(() => this.draw(), 1000);
    }

    stop() {
        this._stopInterval();
        super.stop();
    }

    draw() {
        const time = formatTime(new Date());
        for (let i = 0; i < this._w; i++) {
            this.putc(i, 0, time[i] || ' ', 7, this._bg);
        }
    }
}
