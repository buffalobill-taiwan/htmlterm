import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';

export class SelectDialog extends Dialog {
    constructor(term, opts) {
        const width = opts.width || 40;
        const message = opts.message || '';
        const lines = message.split('\n');
        const h = lines.length + 7;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this._lines = lines;
        this._options = opts.options || ['OK'];
        this._selected = 0;
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(3 + i, this._lines[i]);
        }

        const items = this._options.map((opt, i) => {
            return i === this._selected
                ? '\x1B[7m\x1B[1m ' + opt + ' \x1B[0m'
                : ' ' + opt + ' ';
        });

        const totalWidth = items.reduce((sum, s) => sum + this._bufWidth(s), 0)
            + (items.length - 1) * 2;
        const gap = Math.max(0, this.width - 2 - totalWidth);
        const leftGap = Math.floor(gap / 2);
        const rightGap = Math.ceil(gap / 2);
        const row = ' '.repeat(leftGap) + items.join('  ') + ' '.repeat(rightGap);
        this._centerRow(3 + this._lines.length, row);
    }

    _onKey(data) {
        const code = data.charCodeAt(0);

        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) { this._onCancel(); return 'close'; }
            const { final } = csi;
            if (final === 'D') {
                this._selected = (this._selected - 1 + this._options.length) % this._options.length;
                this.refreshContent();
            } else if (final === 'C') {
                this._selected = (this._selected + 1) % this._options.length;
                this.refreshContent();
            }
            return;
        }
        if (code === 0x03) { this._onCancel(); return 'close'; }
        if (code === 0x0D || code === 0x0A) {
            this._onSelect(this._selected);
            return 'close';
        }
    }
}
