import { wrapDialogText } from './text.js';
import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';

export class SelectDialog extends Dialog {
    constructor(term, opts) {
        const width = Math.max(8, Math.min(term.cols, opts.width || 40));
        const message = opts.message || '';
        const lines = wrapDialogText(message, width - 2);
        const h = lines.length + 7;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this._lines = lines;
        this._options = opts.options || ['OK'];
        this._selected = Math.max(0, Math.min(this._options.length - 1, opts.selectedIndex || 0));
        this._optionRows = [];
        let row = [], used = 0;
        for (let i = 0; i < this._options.length; i++) {
            const parts = wrapDialogText(this._options[i], width - 4);
            for (const text of parts) {
                const w = this._bufWidth(text) + 2;
                if (row.length && (used + 2 + w > width - 2 || parts.length > 1)) {
                    this._optionRows.push(row); row = []; used = 0;
                }
                used += (row.length ? 2 : 0) + w;
                row.push({ index: i, text });
            }
        }
        if (row.length) this._optionRows.push(row);
        this.h = this._lines.length + Math.max(1, this._optionRows.length) + 6;
        if (opts.y == null) this.y = Math.max(0, centeredDialogPos(term, width, this.h).y - 1);
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(3 + i, this._lines[i]);
        }

        for (let r = 0; r < this._optionRows.length; r++) {
            const items = this._optionRows[r].map(({ index, text }) =>
                index === this._selected ? '\x1B[7m\x1B[1m ' + text + ' \x1B[0m' : ' ' + text + ' ');
            this._centerRow(3 + this._lines.length + r, items.join('  '));
        }
    }

    _revealSelection() {
        const r = this._optionRows.findIndex(row => row.some(item => item.index === this._selected));
        if (r >= 0) this._ensureVisible(3 + this._lines.length + r);
    }

    open() {
        super.open();
        if (this._selected > 0) { this._revealSelection(); this._publishBuffer(); }
    }

    _onKey(data) {
        const code = data.charCodeAt(0);

        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) { return this.complete(this._onCancel); }
            const { final } = csi;
            if (!this._options.length) return;
            if (final === 'D') {
                this._selected = (this._selected - 1 + this._options.length) % this._options.length;
                this._revealSelection();
                this.refreshContent();
            } else if (final === 'C') {
                this._selected = (this._selected + 1) % this._options.length;
                this._revealSelection();
                this.refreshContent();
            }
            return;
        }
        if (code === 0x03) { return this.complete(this._onCancel); }
        if (code === 0x0D || code === 0x0A) {
            if (this._options.length) return this.complete(this._onSelect, this._selected);
        }
    }
}
