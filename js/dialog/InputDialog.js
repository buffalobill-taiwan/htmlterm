import { Dialog } from './Dialog.js';
import { makeCursorCell } from '../sgr.js';
import { centeredDialogPos } from './position.js';
import { DEFAULT_DIALOG_WIDTH } from '../constants.js';

export class InputDialog extends Dialog {
    constructor(term, opts) {
        const width = opts.width || DEFAULT_DIALOG_WIDTH;
        const h = 8;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this.prompt = opts.prompt || '';
        this.inputText = '';
        this._onConfirm = opts.onConfirm || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    open() {
        super.open();
        this._showCursor();
    }

    _showCursor() {
        const bufW = this._bufWidth(this.inputText);
        const cx = 1 + this._inputPrefix.length + bufW;
        const cy = this._inputRow;
        if (cx < this.width - 1) {
            this._buffer[cy][cx] = makeCursorCell();
        }
        this.term.markRowDirty(this.y + cy);
    }

    _renderContent() {
        this._inputPrefix = ' > ';
        this._inputRow = 4;
        this._leftRow(3, '  ' + this.prompt);
        this._leftRow(this._inputRow, this._inputPrefix + this.inputText);
        this._showCursor();
    }

    _onKey(data) {
        if (data.length > 1) return;

        const code = data.charCodeAt(0);
        if (code === 0x0D || code === 0x0A) {
            this._onConfirm(this.inputText);
            return 'close';
        }
        if (code === 0x1B || code === 0x03) {
            this._onCancel();
            return 'close';
        }
        if (code === 0x7F || code === 0x08) {
            if (this.inputText.length > 0) {
                this.inputText = this.inputText.slice(0, -1);
                this.refreshContent();
            }
            return;
        }
        if (code >= 0x20) {
            this.inputText += data;
            this.refreshContent();
            return;
        }
    }
}
