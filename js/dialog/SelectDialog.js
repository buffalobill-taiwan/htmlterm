import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { wrapDialogText, clipDialogText } from './text.js';
import { bufWidth } from '../util/display-width.js';
import { parseCSI } from '../system/TextInputModel.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

const selectedSGR = '\x1B[7m\x1B[1m';
const resetSGR = '\x1B[0m';
const labelOf = option => String(option?.label ?? option ?? '');

// One selection model for buttons, lists and grids. The viewport owns paging;
// Dialog still owns frame routing, overlay publication and completion.
export class SelectDialog extends Dialog {
    constructor(term, opts) {
        const options = opts.options || ['OK'];
        const layout = opts.layout || 'horizontal';
        if (!['horizontal', 'list', 'grid'].includes(layout)) throw new TypeError('Unknown selection layout');
        const naturalWidth = Math.max(0, ...options.map(o => bufWidth(labelOf(o))));
        const width = Math.max(8, Math.min(term.cols, opts.width || (layout === 'list' ? naturalWidth + 8 : 40)));
        const footer = layout === 'horizontal' ? '←→ Move ↩ OK Esc Back'
            : layout === 'grid' ? '↑↓←→ Move ↩ OK Esc Back'
                : '↑↓ Move ↩ OK Esc Back';
        super(term, { footer, ...opts, width });
        this._layout = layout;
        this._options = options;
        this._selected = Math.max(0, Math.min(options.length - 1, opts.selectedIndex || 0));
        this._wrap = opts.wrap !== false;
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._closeOnSelect = opts.closeOnSelect ?? true;
        this._renderOption = opts.renderOption;
        this._align = opts.align || (layout === 'list' ? 'left' : 'center');
        this._numbered = opts.numbered || false;
        this._numberWidth = Math.max(2, String(options.length).length);
        this._labelWidth = naturalWidth;
        this._scrollbar = opts.scrollbar || false;
        this._contentWidth = width - 2 - (this._scrollbar ? 1 : 0);
        this._lines = opts.message ? wrapDialogText(opts.message, width - 2) : [];
        // Reserve at least one option row even for a very long message.
        this._lines = this._lines.slice(0, Math.max(0, term.rows - this._headerRows - this._footerRows - 1));
        this._contentY = this._headerRows + this._lines.length;
        this._scrollOffset = 0;
        this._cells = [];
        this._slots = [];
        this._optionBuffers = null;
        this._cellHeight = Math.max(1, Math.min(opts.cellHeight || 1, term.rows - this._contentY - this._footerRows));
        this._cols = layout === 'grid'
            ? Math.max(1, Math.min(opts.cols || 3, Math.floor(this._contentWidth / (opts.cellWidth || naturalWidth + 4)) || 1)) : 1;
        this._cellWidth = layout === 'list' ? this._contentWidth
            : Math.min(opts.cellWidth || (opts.renderOption ? this._contentWidth : naturalWidth + 4), Math.floor(this._contentWidth / this._cols));
        this._buildLayout();
        const capacity = Math.max(1, Math.floor((term.rows - this._contentY - this._footerRows) / this._cellHeight));
        this._visibleRows = Math.max(1, Math.min(this._rows || 1, opts.visibleCount || capacity, capacity));
        this.h = this._contentY + this._visibleRows * this._cellHeight + this._footerRows;
        const pos = centeredDialogPos(term, width, this.h);
        this.x = opts.x ?? pos.x;
        this.y = opts.y ?? Math.max(0, pos.y - 1);
        this._revealSelection();
    }

    _buildLayout() {
        if (this._layout !== 'horizontal') {
            const left = Math.floor((this._contentWidth - this._cols * this._cellWidth) / 2);
            for (let i = 0; i < this._options.length; i++) {
                this._cells.push({ index: i, row: Math.floor(i / this._cols), x: 1 + left + i % this._cols * this._cellWidth, width: this._cellWidth });
            }
            this._rows = Math.ceil(this._options.length / this._cols);
            return;
        }
        // Buttons flow across rows, including wrapped labels. All fragments of
        // a long button retain the same option index and confirmation result.
        let row = 0, used = 0, start = 0;
        const finishRow = () => {
            const offset = Math.floor((this._contentWidth - used) / 2);
            for (let i = start; i < this._cells.length; i++) this._cells[i].x += offset;
            start = this._cells.length;
        };
        for (let i = 0; i < this._options.length; i++) {
            for (const text of wrapDialogText(labelOf(this._options[i]), this._contentWidth - 2)) {
                const width = Math.min(this._contentWidth, bufWidth(text) + 2);
                if (used && used + 2 + width > this._contentWidth) { finishRow(); row++; used = 0; }
                const x = 1 + used + (used ? 2 : 0);
                this._cells.push({ index: i, row, x, width, text });
                used = x - 1 + width;
            }
        }
        finishRow();
        this._rows = this._cells.length ? row + 1 : 0;
    }

    _initBuffer() {
        super._initBuffer();
        if (!this._renderOption || !this._options.length) return;
        // Cache both appearances once, retaining child slots across key presses.
        this._optionBuffers = this._options.map((option, index) => [false, true].map(selected => {
            const content = this._renderOption(index, option, selected);
            if (!(content instanceof VirtualBuffer)) return content;
            const clipped = new VirtualBuffer(this._cellWidth, this._cellHeight);
            const slot = clipped.addChildSlot();
            slot.vb = content;
            slot.x = Math.max(0, Math.floor((this._cellWidth - content.width) / 2));
            slot.active = true;
            return clipped;
        }));
        for (let i = 0; i < this._visibleRows * this._cols; i++) this._slots.push(this._vb.addChildSlot());
    }

    _renderContent() {
        for (let i = 0; i < this._lines.length; i++) this._centerRow(this._headerRows + i, this._lines[i]);
        for (let r = 0; r < this._visibleRows * this._cellHeight; r++) this._leftRow(this._contentY + r, '');
        for (const slot of this._slots) slot.active = false;
        let slotIndex = 0;
        for (const cell of this._cells) {
            if (cell.row < this._scrollOffset || cell.row >= this._scrollOffset + this._visibleRows) continue;
            const selected = cell.index === this._selected;
            const y = this._contentY + (cell.row - this._scrollOffset) * this._cellHeight;
            const custom = this._optionBuffers?.[cell.index][selected ? 1 : 0];
            if (custom instanceof VirtualBuffer) {
                const slot = this._slots[slotIndex++];
                slot.vb = custom; slot.x = cell.x; slot.y = y; slot.active = true;
                continue;
            }
            const content = custom != null ? String(custom) : this._formatOption(cell);
            const lines = this._cellHeight > 1 ? wrapDialogText(content, cell.width) : [content];
            for (let dr = 0; dr < this._cellHeight; dr++) {
                const text = clipDialogText(lines[dr] || '', cell.width);
                const pad = Math.max(0, cell.width - bufWidth(text));
                const left = this._align === 'center' ? Math.floor(pad / 2) : 0;
                this._vb.writeStr(y + dr, cell.x,
                    (selected ? selectedSGR : '') + ' '.repeat(left) + text + ' '.repeat(pad - left) + resetSGR, cell.x + cell.width);
            }
        }
        if (this._scrollbar) this._drawScrollBar();
    }

    _formatOption(cell) {
        if (cell.text != null) return ' ' + cell.text + ' ';
        const option = this._options[cell.index];
        const label = labelOf(option);
        if (this._align === 'center' && !this._numbered && option?.description == null && option?.trailing == null) return label;
        const prefix = this._numbered ? ' ' + String(cell.index + 1).padStart(this._numberWidth) + '  ' : ' ';
        const description = option?.description == null ? '' : '  ' + String(option.description);
        const left = prefix + label + (description ? ' '.repeat(Math.max(0, this._labelWidth - bufWidth(label))) + description : '');
        if (option?.trailing == null) return left;
        const right = clipDialogText(String(option.trailing) + ' ', Math.max(0, cell.width - 1));
        const room = Math.max(0, cell.width - bufWidth(right) - 1);
        const clipped = clipDialogText(left, room);
        return clipped + ' '.repeat(Math.max(1, cell.width - bufWidth(clipped) - bufWidth(right))) + right;
    }

    _drawScrollBar() {
        const count = this._visibleRows * this._cellHeight;
        const max = this._rows - this._visibleRows;
        const thumb = max > 0 ? Math.round(this._scrollOffset / max * (count - 1)) : -1;
        for (let r = 0; r < count; r++) this._vb.writeStr(this._contentY + r, this.width - 2,
            max > 0 ? (r === thumb ? '█' : '░') : ' ', this.width - 1);
    }

    _revealSelection() {
        const row = this._cells.find(cell => cell.index === this._selected)?.row || 0;
        if (row < this._scrollOffset) this._scrollOffset = row;
        if (row >= this._scrollOffset + this._visibleRows) this._scrollOffset = row - this._visibleRows + 1;
        this._scrollOffset = Math.max(0, Math.min(this._scrollOffset, this._rows - this._visibleRows));
    }

    _moveTo(index) {
        const next = Math.max(0, Math.min(this._options.length - 1, index));
        if (next === this._selected) return;
        this._selected = next;
        this._revealSelection();
        this.refreshContent();
    }

    _step(value, delta, count) {
        return this._wrap ? (value + delta + count) % count : Math.max(0, Math.min(count - 1, value + delta));
    }

    _onKey(data) {
        if (data === '\x1B' || data === '\x03') return this.complete(this._onCancel);
        if (!this._options.length) return;
        if (data === '\r' || data === '\n') {
            const option = this._options[this._selected];
            const close = typeof this._closeOnSelect === 'function' ? this._closeOnSelect(this._selected, option) : this._closeOnSelect;
            if (close) return this.complete(this._onSelect, this._selected, option);
            this._onSelect(this._selected, option);
            return;
        }
        const csi = parseCSI(data);
        if (!csi) return;
        const { final, params } = csi;
        const n = this._options.length;
        if (final === 'H' || (final === '~' && ['1', '7'].includes(params))) return this._moveTo(0);
        if (final === 'F' || (final === '~' && ['4', '8'].includes(params))) return this._moveTo(n - 1);
        if (final === '~' && ['5', '6'].includes(params)) {
            const delta = (params === '5' ? -1 : 1) * this._visibleRows;
            if (this._layout === 'horizontal') {
                const row = this._cells.find(cell => cell.index === this._selected).row;
                const target = Math.max(0, Math.min(this._rows - 1, row + delta));
                return this._moveTo(this._cells.find(cell => cell.row === target).index);
            }
            return this._moveTo(this._selected + delta * this._cols);
        }
        if (this._layout === 'horizontal') {
            if (final === 'D' || final === 'C') this._moveTo(this._step(this._selected, final === 'D' ? -1 : 1, n));
        } else if (this._layout === 'list') {
            if (final === 'A' || final === 'B') this._moveTo(this._step(this._selected, final === 'A' ? -1 : 1, n));
        } else {
            let row = Math.floor(this._selected / this._cols), col = this._selected % this._cols;
            if (final === 'A' || final === 'B') row = this._step(row, final === 'A' ? -1 : 1, this._rows);
            else if (final === 'D' || final === 'C') col = this._step(col, final === 'D' ? -1 : 1, Math.min(this._cols, n - row * this._cols));
            else return;
            this._moveTo(Math.min(n - 1, row * this._cols + col));
        }
    }
}
