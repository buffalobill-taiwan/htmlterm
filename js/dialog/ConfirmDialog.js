import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';

export class ConfirmDialog extends Dialog {
    constructor(term, opts) {
        const width = opts.width || 36;
        const message = opts.message || '';
        const lines = message.split('\n');
        const h = lines.length + 7;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this._lines = lines;
        this._selected = 0;
        this._onConfirm = opts.onConfirm || (() => {});
        this._onCancel  = opts.onCancel  || (() => {});
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(3 + i, this._lines[i]);
        }

        const btnYes = this._selected === 0;
        const btnNo  = this._selected === 1;
        const yesStr = btnYes ? '\x1B[7m\x1B[1m Yes \x1B[0m' : ' Yes ';
        const noStr  = btnNo  ? '\x1B[7m\x1B[1m No \x1B[0m'  : ' No ';
        const gap = Math.max(0, this.width - 2 - 5 - 2 - 4);
        const leftGap = Math.floor(gap / 2);
        const rightGap = Math.ceil(gap / 2);
        const btnRow = ' '.repeat(leftGap) + yesStr + '  ' + noStr + ' '.repeat(rightGap);
        this._centerRow(3 + this._lines.length, btnRow);
    }

    _onKey(data) {
        const code = data.charCodeAt(0);

        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) { this._onCancel(); return 'close'; }
            const { final } = csi;
            if (final === 'D') { this._selected = 0; this.refreshContent(); }
            else if (final === 'C') { this._selected = 1; this.refreshContent(); }
            return;
        }
        if (code === 0x03) { this._onCancel(); return 'close'; }
        if (code === 0x0D || code === 0x0A) {
            if (this._selected === 0) this._onConfirm();
            else this._onCancel();
            return 'close';
        }
    }
}
