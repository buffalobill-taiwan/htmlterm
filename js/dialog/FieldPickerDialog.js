import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';
import { bufWidth } from '../util/display-width.js';

// A settings-style dialog: one labelled row per field, each with inline
// options. Arrows switch fields/values; Enter confirms as a value object
// keyed by field key.
export class FieldPickerDialog extends Dialog {
    constructor(term, opts) {
        const fields = (opts.fields || []).map(f => {
            const options = (f.options || []).map(o => Array.isArray(o)
                ? { label: String(o[0]), value: o[1] }
                : { label: String(o), value: o });
            let sel = 0;
            if (f.default !== undefined && f.default !== null) {
                const found = options.findIndex(o => o.value === f.default);
                if (found >= 0) sel = found;
            }
            return { key: f.key, label: f.label || '', options, sel };
        });
        const labelW = Math.max(0, ...fields.map(f => bufWidth(f.label)));
        const linesW = Math.max(0, ...fields.map(f => {
            const optionsW = f.options.reduce((a, o) => a + bufWidth(o.label) + 2, 0)
                + Math.max(0, f.options.length - 1);
            return 2 + labelW + 2 + optionsW;
        }));
        const width = Math.max(8, Math.min(term.cols, opts.width || linesW + 10));
        const gap = opts.gap == null ? 1 : opts.gap;
        const h = 7 + Math.max(0, fields.length - 1) * (1 + gap);
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this.footer = opts.footer || (fields.length === 1
            ? '← → 選擇  Enter 開始  Esc 退出'
            : '↑↓ 切換  ← → 選擇  Enter 開始  Esc 退出');
        this._fields = fields;
        this._labelW = labelW;
        this._gap = gap;
        this._row = 0;
        this._onConfirm = opts.onConfirm || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _renderContent() {
        const fields = this._fields;
        if (!fields.length) return;
        const lines = fields.map((f, i) => {
            let line = (i === this._row ? '\x1B[1m▶\x1B[22m ' : '  ') + f.label +
                ' '.repeat(this._labelW - bufWidth(f.label)) + '  ';
            for (let j = 0; j < f.options.length; j++) {
                line += j === f.sel ? '\x1B[7m\x1B[1m ' + f.options[j].label + ' \x1B[0m' : ' ' + f.options[j].label + ' ';
                if (j < f.options.length - 1) line += ' ';
            }
            return line;
        });
        const leftPad = Math.max(0, Math.floor((this.width - 2 - Math.max(...lines.map(l => bufWidth(l)))) / 2));
        for (let i = 0; i < lines.length; i++) {
            const row = 3 + i * (1 + this._gap);
            this._leftRow(row, '');
            this._vb.writeStr(row, 1 + leftPad, lines[i], this.width - 1);
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
            const { final } = csi;
            const n = this._fields.length;
            if (final === 'A' || final === 'B') {
                const delta = final === 'A' ? -1 : 1;
                this._row = Math.max(0, Math.min(n - 1, this._row + delta));
            } else if (final === 'D' || final === 'C') {
                const delta = final === 'D' ? -1 : 1;
                const f = this._fields[this._row];
                f.sel = (f.sel + delta + f.options.length) % f.options.length;
            } else {
                return;
            }
            this.refreshContent();
            return;
        }
        if (code === 0x03) { return this.complete(this._onCancel); }
        if (code === 0x0D || code === 0x0A) {
            const values = {};
            for (const f of this._fields) values[f.key] = f.options.length ? f.options[f.sel].value : undefined;
            return this.complete(this._onConfirm, values);
        }
    }
}