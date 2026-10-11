import { Dialog } from '../../dialog/Dialog.js';
import { centeredDialogPos } from '../../dialog/position.js';
import { parseCSI } from '../../system/TextInputModel.js';
import { bufWidth } from '../../util/display-width.js';

const DIFFS = [['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']];
const SIDES = [['先手（紅方）', 'red'], ['後手（黑方）', 'black']];

export class AiSetupDialog extends Dialog {
    constructor(term, opts) {
        const width = Math.max(8, Math.min(term.cols, opts.width || 48));
        const h = 9;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width, title: '中國象棋' });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this.footer = opts.footer || '↑↓ 切換  ← → 選擇  Enter 開始  Esc 返回';
        this._row = 0;
        const diff = DIFFS.findIndex(d => d[1] === opts.difficulty);
        this._diffIdx = diff >= 0 ? diff : 1;
        this._sideIdx = opts.human === 'black' ? 1 : 0;
        this._onConfirm = opts.onConfirm || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _renderContent() {
        const rows = [
            { label: '難度', items: DIFFS.map(d => d[0]), sel: this._diffIdx, active: this._row === 0 },
            { label: '先後手', items: SIDES.map(s => s[0]), sel: this._sideIdx, active: this._row === 1 },
        ];
        const labelW = Math.max(0, ...rows.map(r => bufWidth(r.label)));
        const lines = rows.map(r => {
            let line = (r.active ? '\x1B[1m▶\x1B[22m ' : '  ') + r.label +
                ' '.repeat(labelW - bufWidth(r.label)) + '  ';
            for (let j = 0; j < r.items.length; j++) {
                line += j === r.sel ? '\x1B[7m\x1B[1m ' + r.items[j] + ' \x1B[0m' : ' ' + r.items[j] + ' ';
                if (j < r.items.length - 1) line += ' ';
            }
            return line;
        });
        const leftPad = Math.max(0, Math.floor((this.width - 2 - Math.max(...lines.map(l => bufWidth(l)))) / 2));
        for (let i = 0; i < lines.length; i++) {
            const row = 3 + i * 2;
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
            if (final === 'A' || final === 'B') {
                this._row = this._row === 0 ? 1 : 0;
            } else if (final === 'D' || final === 'C') {
                const delta = final === 'D' ? -1 : 1;
                if (this._row === 0) this._diffIdx = (this._diffIdx + delta + DIFFS.length) % DIFFS.length;
                else this._sideIdx = (this._sideIdx + delta + SIDES.length) % SIDES.length;
            } else {
                return;
            }
            this.refreshContent();
            return;
        }
        if (code === 0x03) { return this.complete(this._onCancel); }
        if (code === 0x0D || code === 0x0A) {
            return this.complete(this._onConfirm, {
                difficulty: DIFFS[this._diffIdx][1],
                human: SIDES[this._sideIdx][1],
            });
        }
    }
}
