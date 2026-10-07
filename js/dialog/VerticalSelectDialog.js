import { bufWidth } from '../util/display-width.js';
import { wrapDialogText } from './text.js';
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
        const width = Math.max(8, Math.min(term.cols, opts.width || 36));
        const message = opts.message || '';
        const lines = message ? wrapDialogText(message, width - 2) : [];
        const options = opts.options || ['OK'];
        const desiredCellWidth = opts.cellWidth || (opts.renderOption ? width - 2 : Math.max(0, ...options.map(o => bufWidth(o))) + 4);
        const cols = Math.max(1, Math.min(opts.cols || 3, Math.floor((width - 2) / desiredCellWidth) || 1));
        const cellWidth = Math.min(width - 2, desiredCellWidth);
        const cellHeight = opts.cellHeight || (opts.renderOption ? 1 : Math.max(1, ...options.map(o => wrapDialogText(o, cellWidth - 2).length)));
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
        const selected = Math.max(0, Math.min(options.length - 1, opts.selectedIndex || 0));
        this._selRow = Math.floor(selected / cols);
        this._selCol = selected % cols;
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._renderOption = opts.renderOption || null;
        this._cellWidth = cellWidth;
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

        if (this._options.length && this._renderOption && !this._optVBs) {
            this._buildOptionVBs();
        }

        if (this._optMode) {
            this._renderOptionCells(contentY);
            return;
        }

        const cellW = this._cellWidth;
        const leftPad = Math.max(0, Math.floor((this.width - 2 - cellW * this._cols) / 2));
        for (let r = 0; r < this._rows; r++) {
            for (let dr = 0; dr < this._cellHeight; dr++) this._leftRow(contentY + r * this._cellHeight + dr, '');
            for (let c = 0; c < this._cols; c++) {
                const idx = r * this._cols + c;
                if (idx >= this._options.length) break;
                const selected = r === this._selRow && c === this._selCol;
                const sgr = selected ? '\x1B[7m\x1B[1m' : '';
                const x = 1 + leftPad + c * cellW;
                const content = this._renderOption
                    ? this._renderOption(idx, this._options[idx], selected)
                    : ' ' + this._options[idx];
                const lines = wrapDialogText(content, cellW);
                for (let dr = 0; dr < this._cellHeight; dr++) {
                    const text = lines[dr] || '';
                    this._vb.writeStr(contentY + r * this._cellHeight + dr, x,
                        sgr + text + ' '.repeat(Math.max(0, cellW - this._bufWidth(text))), x + cellW);
                }
            }
        }
    }

    open() {
        super.open();
        if (this._selRow > 0) { this._revealSelection(); this._publishBuffer(); }
    }

    _revealSelection() {
        this._ensureVisible(3 + this._lines.length + this._selRow * this._cellHeight, this._cellHeight);
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
            const clip = source => {
                const cell = new VirtualBuffer(this._cellWidth, this._cellHeight);
                const slot = cell.addChildSlot();
                slot.vb = source;
                slot.x = Math.max(0, Math.floor((this._cellWidth - source.width) / 2));
                slot.active = true;
                return cell;
            };
            this._optVBs[i] = clip(normal);
            this._optCursorVBs[i] = clip(cursor);
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
            if (!csi) {
                // Only a lone ESC cancels; unrecognised sequences are ignored.
                if (data === '\x1B' || data.length === 1) return this.complete(this._onCancel);
                return;
            }
            const { final } = csi;
            if (!this._options.length) return;
            if (final === 'A') {
                this._selRow = this._selRow > 0 ? this._selRow - 1 : (this._wrap ? this._rows - 1 : 0);
            } else if (final === 'B') {
                this._selRow = this._selRow < this._rows - 1 ? this._selRow + 1 : (this._wrap ? 0 : this._rows - 1);
            } else if (final === 'D') {
                this._selCol = this._selCol > 0 ? this._selCol - 1 : (this._wrap ? this._cols - 1 : 0);
            } else if (final === 'C') {
                this._selCol = this._selCol < this._cols - 1 ? this._selCol + 1 : (this._wrap ? 0 : this._cols - 1);
            }
            if (!['A', 'B', 'C', 'D'].includes(final)) return;
            const idx = this._selRow * this._cols + this._selCol;
            if (idx >= this._options.length) {
                this._selCol = Math.max(0, this._options.length - 1 - this._selRow * this._cols);
            }
            this._revealSelection();
            this.refreshContent();
            return;
        }
        if (code === 0x03) { return this.complete(this._onCancel); }
        if (code === 0x0D || code === 0x0A) {
            const idx = this._selRow * this._cols + this._selCol;
            if (idx < this._options.length) {
                return this.complete(this._onSelect, idx);
            }
            return 'close';
        }
    }
}
