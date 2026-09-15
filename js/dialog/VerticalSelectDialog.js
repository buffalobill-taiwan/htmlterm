import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { parseCSI } from '../system/TextInputModel.js';
import { makeCell, defaultAttr } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

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
        const cellHeight = opts.cellHeight || 1;
        const rows = Math.ceil(options.length / cols);
        const h = lines.length + rows * cellHeight + 6;
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
        this._cellHeight = cellHeight;
        this._optVBs = null;
        this._optCursorVBs = null;
        this._optW = 0;
        this._optMode = false;
        this._optionSlots = [];
        this._slotsOwner = null;
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) {
            this._centerRow(3 + i, this._lines[i]);
        }

        const contentY = 3 + this._lines.length;

        if (this._renderOption && !this._optVBs) {
            this._buildOptionVBs();
        }

        if (this._optMode) {
            this._renderOptionCells(contentY);
            return;
        }

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
                const sgr = isSelected ? '\x1B[7m\x1B[1m' : '';

                let content;
                if (this._renderOption) {
                    content = this._renderOption(idx, this._options[idx], isSelected);
                } else {
                    const opt = this._options[idx];
                    const optW = this._bufWidth(opt);
                    const pad = cellW - 2 - optW;
                    const left = Math.floor(pad / 2);
                    const right = Math.ceil(pad / 2);
                    content = ' ' + ' '.repeat(left) + opt + ' '.repeat(right + 1);
                }
                this._vb.writeStr(row, cx, sgr + content, this.width - 1);
                cx += cellW;
            }

            this._vb.setCell(row, this.width - 1, _borderR);
        }
    }

    _buildOptionVBs() {
        const first = this._renderOption(0, this._options[0], false);
        const n = this._options.length;
        if (!(first instanceof VirtualBuffer)) {
            this._optVBs = [];
            return;
        }
        this._optMode = true;
        this._optVBs = new Array(n);
        this._optCursorVBs = new Array(n);
        let maxW = 0;
        for (let i = 0; i < n; i++) {
            const normal = i === 0 ? first : this._renderOption(i, this._options[i], false);
            const cursor = this._renderOption(i, this._options[i], true);
            this._optVBs[i] = normal;
            this._optCursorVBs[i] = cursor;
            if (normal.width > maxW) maxW = normal.width;
        }
        this._optW = maxW;
    }

    _renderOptionCells(contentY) {
        const cellW = this._cellWidth != null ? this._cellWidth : this._optW + 2;
        const cellH = this._cellHeight;
        const totalW = cellW * this._cols;
        const leftPad = Math.floor((this.width - 2 - totalW) / 2);

        const count = this._options.length;
        if (this._slotsOwner !== this._vb) {
            this._optionSlots.length = 0;
            for (let i = 0; i < count; i++) this._optionSlots.push(this._vb.addChildSlot());
            this._slotsOwner = this._vb;
        }
        for (let i = 0; i < this._optionSlots.length; i++) this._optionSlots[i].active = false;

        for (let r = 0; r < this._rows; r++) {
            const baseRow = contentY + r * cellH;
            for (let dr = 0; dr < cellH; dr++) {
                const row = baseRow + dr;
                this._t(row, ' '.repeat(this.width));
                this._vb.setCell(row, 0, _borderL);
                this._vb.setCell(row, this.width - 1, _borderR);
            }
            for (let c = 0; c < this._cols; c++) {
                const idx = r * this._cols + c;
                if (idx >= count) break;
                const cx = 1 + leftPad + c * cellW;
                const isSelected = r === this._selRow && c === this._selCol;
                const slot = this._optionSlots[idx];
                slot.vb = isSelected ? this._optCursorVBs[idx] : this._optVBs[idx];
                slot.x = cx + Math.max(0, Math.floor((cellW - this._optVBs[idx].width) / 2));
                slot.y = baseRow;
                slot.active = true;
            }
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
