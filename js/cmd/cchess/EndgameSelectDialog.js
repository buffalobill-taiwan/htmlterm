import { MenuDialog } from '../../dialog/MenuDialog.js';
import { bufWidth } from '../../util/display-width.js';

export class EndgameSelectDialog extends MenuDialog {
    constructor(term, opts) {
        const width = 40;
        super(term, opts.options, {
            ...opts,
            width,
            title: '選擇殘局 中國象棋',
            footer: '↑↓選關 PgUp/Dn翻頁 ↩開始 Esc返回',
            visibleCount: Math.min(10, opts.options.length),
        });
    }

    _drawItem(index, bufRow) {
        const item = this.items[index];
        const left = ' ' + String(index + 1).padStart(2) + '  ' + item.name;
        const right = String(item.step) + '步 ';
        const pad = Math.max(0, this.width - 3 - bufWidth(left) - bufWidth(right));
        const selected = index === this.selected;
        this._leftRow(bufRow, '');
        this._vb.writeStr(bufRow, 1,
            (selected ? '\x1B[7m\x1B[1m' : '') + left + ' '.repeat(pad) + right +
            (selected ? '\x1B[0m' : ''), this.width - 2);
    }

    _onKey(data) {
        if (data === '\r' || data === '\n') {
            if (this.items.length) return this.complete(this._onSelect, this.selected);
            return;
        }
        return super._onKey(data);
    }
}
