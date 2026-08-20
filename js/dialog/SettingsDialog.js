import { Dialog } from './Dialog.js';
import { SelectDialog } from './SelectDialog.js';
import { VerticalSelectDialog } from './VerticalSelectDialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';
import { makeCell, defaultAttr } from '../util/sgr.js';

const _borderL = makeCell('│', defaultAttr(), 1);
const _borderR = makeCell('│', defaultAttr(), 1);

export class SettingsDialog extends Dialog {
    constructor(term, opts) {
        const settings = opts.settings || [];
        const h = settings.length + 8;
        const width = opts.width || 40;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width, title: opts.title || 'jpmj', h });

        this._settings = settings;
        this._startIdx = settings.length;
        this.h = h;
        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this._childDialog = null;
        this._onStart = opts.onStart || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._selected = 0;
    }

    open() {
        super.open();
    }

    handleKey(data) {
        if (this.closed) return;
        if (this._childDialog) {
            this._childDialog.handleKey(data);
            if (!this._childDialog || this._childDialog.closed) {
                this._childDialog = null;
                this.refreshContent();
            }
            return;
        }
        const result = this._onKey(data);
        if (result === 'close') this.close();
    }

    _renderContent() {
        const contentY = 3;
        const W = this.width;
        const innerW = W - 2;

        const maxLabelW = Math.max(...this._settings.map(s => this._bufWidth(s.label)));
        const maxValueW = Math.max(...this._settings.map(s => this._bufWidth(s.value)));
        const contentW = maxLabelW + 2 + 2 + maxValueW + 2;
        const labelX = Math.floor((innerW - contentW) / 2);
        const valueX = labelX + maxLabelW + 2;

        for (let i = 0; i < this._settings.length; i++) {
            const s = this._settings[i];
            const isSelected = i === this._selected;
            const prefix = isSelected ? '\x1B[7m\x1B[1m' : '';
            const suffix = isSelected ? '\x1B[0m' : '';

            const row = contentY + i;
            this._t(row, ' '.repeat(W));

            const labelStr = prefix + '  ' + s.label;
            const valueStr = '  ' + s.value + suffix;

            this._vb.writeStr(row, labelX, labelStr, W - 1);
            this._vb.writeStr(row, valueX, valueStr, W - 1);
            this._vb.setCell(row, 0, _borderL);
            this._vb.setCell(row, W - 1, _borderR);
        }

        this._t(contentY + this._settings.length, '│' + '─'.repeat(this.width - 2) + '│');

        const startRow = contentY + this._settings.length + 1;
        const startSelected = this._selected === this._startIdx;
        const startLabel = startSelected
            ? '\x1B[7m\x1B[1m ▶ 開始 \x1B[0m'
            : '   開始  ';
        this._centerRow(startRow, startLabel);
    }

    _onKey(data) {
        const code = data.charCodeAt(0);

        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) { this._onCancel(); return 'close'; }
            const { final } = csi;
            if (final === 'A') {
                this._selected = this._selected > 0 ? this._selected - 1 : this._startIdx;
                this.refreshContent();
            } else if (final === 'B') {
                this._selected = this._selected < this._startIdx ? this._selected + 1 : 0;
                this.refreshContent();
            }
            return;
        }
        if (code === 0x03) { this._onCancel(); return 'close'; }
        if (code === 0x0D || code === 0x0A) {
            if (this._selected === this._startIdx) {
                const result = {};
                for (const s of this._settings) result[s.key] = s.value;
                this._onStart(result);
                return 'close';
            }
            this._openSubmenu(this._selected);
            return;
        }
    }

    _openSubmenu(settingIdx) {
        const s = this._settings[settingIdx];
        const opts = s.options;
        const currentIdx = opts.indexOf(s.value);

        if (opts.length <= 5) {
            const dialog = new SelectDialog(this.term, {
                title: s.label,
                options: opts,
                footer: '← → Move  ↩ Confirm  ESC Cancel',
                onSelect: (idx) => {
                    s.value = opts[idx];
                    this._childDialog = null;
                    this.refreshContent();
                },
                onCancel: () => {
                    this._childDialog = null;
                    this.refreshContent();
                },
            });
            dialog.open();
            this._childDialog = dialog;
        } else {
            const dialog = new VerticalSelectDialog(this.term, {
                title: s.label,
                options: opts,
                cols: 3,
                footer: '↑↓←→ Move  ↩ Confirm  ESC Cancel',
                onSelect: (idx) => {
                    s.value = opts[idx];
                    this._childDialog = null;
                    this.refreshContent();
                },
                onCancel: () => {
                    this._childDialog = null;
                    this.refreshContent();
                },
            });
            dialog.open();
            this._childDialog = dialog;
        }
    }
}
