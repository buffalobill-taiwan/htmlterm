import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';
import { makeCell, defaultAttr } from '../util/sgr.js';

const _borderAttr = defaultAttr();
const _borderL = makeCell('│', _borderAttr, 1);
const _borderR = makeCell('│', _borderAttr, 1);

export class VerticalSelectDialog extends Dialog {
    constructor(term, opts) {
        const width = opts.width || 36;
        const message = opts.message || '';
        const lines = message ? message.split('\n') : [];
        const options = opts.options || ['OK'];
        const cols = opts.cols || 3;
        const rows = Math.ceil(options.length / cols);
        const h = lines.length + rows + 6;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this._options = options;
        this._cols = cols;
        this._rows = rows;
        this.h = h;
        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this._lines = lines;
        this._selRow = 0;
        this._selCol = 0;
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._renderOption = opts.renderOption || null;
        this._cellWidth = opts.cellWidth || null;
        this._wrap = opts.wrap || false;
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(3 + i, this._lines[i]);
        }

        const contentY = 3 + this._lines.length;

        let cellW;
        if (this._cellWidth != null) {
            cellW = this._cellWidth;
        } else if (this._renderOption) {
            cellW = this.width - 2;
        } else {
            const maxLen = Math.max(...this._options.map(o => this._bufWidth(o)));
            cellW = maxLen + 4;
        }
        const totalW = cellW * this._cols;
        const leftPad = Math.floor((this.width - 2 - totalW) / 2);

        for (let r = 0; r < this._rows; r++) {
            const row = contentY + r;
            this._t(row, ' '.repeat(this.width));
            this._vb.setCell(row, 0, _borderL);

            let cx = 1 + leftPad;
            for (let c = 0; c < this._cols; c++) {
                const idx = r * this._cols + c;
                if (idx >= this._options.length) break;
                const isSelected = r === this._selRow && c === this._selCol;

                if (this._renderOption) {
                    const rendered = this._renderOption(idx, this._options[idx], isSelected);
                    const sgr = isSelected ? '\x1B[7m\x1B[1m' : '';
                    this._vb.writeStr(row, cx, sgr + rendered, this.width - 1);
                } else {
                    const opt = this._options[idx];
                    const optW = this._bufWidth(opt);
                    const pad = cellW - 2 - optW;
                    const left = Math.floor(pad / 2);
                    const right = Math.ceil(pad / 2);
                    const content = ' ' + ' '.repeat(left) + opt + ' '.repeat(right + 1);
                    const sgr = isSelected ? '\x1B[7m\x1B[1m' : '';
                    this._vb.writeStr(row, cx, sgr + content, this.width - 1);
                }
                cx += cellW;
            }

            this._vb.setCell(row, this.width - 1, _borderR);
        }
    }

    _onKey(data) {
        const code = data.charCodeAt(0);

        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) { this._onCancel(); return 'close'; }
            const { final } = csi;
            if (final === 'A') {
                this._selRow = this._selRow > 0 ? this._selRow - 1 : (this._wrap ? this._rows - 1 : 0);
            } else if (final === 'B') {
                this._selRow = this._selRow < this._rows - 1 ? this._selRow + 1 : (this._wrap ? 0 : this._rows - 1);
            } else if (final === 'D') {
                this._selCol = this._selCol > 0 ? this._selCol - 1 : (this._wrap ? this._cols - 1 : 0);
            } else if (final === 'C') {
                this._selCol = this._selCol < this._cols - 1 ? this._selCol + 1 : (this._wrap ? 0 : this._cols - 1);
            }
            const idx = this._selRow * this._cols + this._selCol;
            if (idx >= this._options.length) {
                this._selCol = Math.max(0, this._options.length - 1 - this._selRow * this._cols);
            }
            this.refreshContent();
            return;
        }
        if (code === 0x03) { this._onCancel(); return 'close'; }
        if (code === 0x0D || code === 0x0A) {
            const idx = this._selRow * this._cols + this._selCol;
            if (idx < this._options.length) {
                this._onSelect(idx);
            }
            return 'close';
        }
    }
}
