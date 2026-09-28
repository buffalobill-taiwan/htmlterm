import { wrapDialogText } from './text.js';
import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { DEFAULT_DIALOG_WIDTH } from '../util/constants.js';

export class ShowDialog extends Dialog {
    constructor(term, opts) {
        super(term, Object.assign({ width: DEFAULT_DIALOG_WIDTH, footer: 'ESC to back', title: null }, opts));
        this.message = opts.message || '';
        this._lines = wrapDialogText(this.message, this.width - 2);
        this._headerRows = this.title ? 3 : 1;
        const h = this._lines.length + this._headerRows + 3;
        const pos = centeredDialogPos(term, this.width, h);
        this.h = h;
        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : pos.y;
        this._onExit = opts.onExit || null;
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(this._headerRows + i, this._lines[i]);
        }
    }

    _onKey(data) {
        if (data.length !== 1) return;
        const code = data.charCodeAt(0);
        if (code === 0x1B || code === 0x03 || code === 0x0D || code === 0x0A) {
            return this.complete(this._onExit);
        }
    }
}
