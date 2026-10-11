import { Dialog } from '../../dialog/Dialog.js';
import { centeredDialogPos } from '../../dialog/position.js';
import { parseCSI } from '../../system/TextInputModel.js';
import { bufWidth } from '../../util/display-width.js';

// A compact title + vertical option list without a footer.
export class ModeSelectDialog extends Dialog {
    constructor(term, opts) {
        const options = opts.options || [];
        const contentW = options.length ? Math.max(0, ...options.map(o => bufWidth(o))) : 0;
        const width = Math.max(8, Math.min(term.cols, opts.width || contentW + 8));
        const h = 3 + Math.max(1, options.length) + 1;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width, title: opts.title || '' });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this._options = options;
        this._selected = Math.max(0, Math.min(options.length - 1, opts.selectedIndex || 0));
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _drawFrame() {
        const H = '─';
        this._t(0, '┌' + H.repeat(this.width - 2) + '┐');
        this._centerRow(1, ' \x1B[1m' + this.title + '\x1B[22m ');
        this._t(2, '├' + H.repeat(this.width - 2) + '┤');
        for (let row = 3; row < this._fullHeight - 1; row++) this._leftRow(row, '');
        this._t(this._fullHeight - 1, '└' + H.repeat(this.width - 2) + '┘');
    }

    _renderContent() {
        const inner = this.width - 2;
        for (let i = 0; i < this._options.length; i++) {
            const text = this._options[i];
            const w = bufWidth(text);
            const pad = Math.max(0, Math.floor((inner - w) / 2));
            const padded = ' '.repeat(pad) + text + ' '.repeat(Math.max(0, inner - w - pad));
            const sgr = i === this._selected ? '\x1B[7m\x1B[1m' : '';
            this._leftRow(3 + i, sgr + padded + (sgr ? '\x1B[0m' : ''));
        }
    }

    _onKey(data) {
        const code = data.charCodeAt(0);

        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) {
                // Only a lone ESC cancels; unrecognised sequences are ignored.
                if (data === '\x1B' || data.length === 1) return this.complete(this._onCancel);
                return;
            }
            if (csi.final === 'A') this._moveBy(-1);
            else if (csi.final === 'B') this._moveBy(1);
            return;
        }
        if (code === 0x03) { return this.complete(this._onCancel); }
        if (code === 0x0D || code === 0x0A) {
            if (this._options.length) return this.complete(this._onSelect, this._selected);
        }
    }

    _moveBy(delta) {
        const n = this._options.length;
        if (!n) return;
        const next = Math.max(0, Math.min(n - 1, this._selected + delta));
        if (next === this._selected) return;
        this._selected = next;
        this.refreshContent();
    }
}
