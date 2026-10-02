import { VerticalSelectDialog } from '../../dialog/VerticalSelectDialog.js';
import { centeredDialogPos } from '../../dialog/position.js';
import { bufWidth } from '../../util/display-width.js';

export class EndgameSelectDialog extends VerticalSelectDialog {
    constructor(term, opts) {
        const width = 40;
        const pos = centeredDialogPos(term, width, opts.options.length + 6);
        super(term, {
            ...opts,
            width,
            title: '選擇殘局 中國象棋',
            footer: '↑↓ 選關  ↩ 開始  ESC 返回',
            cols: 1,
            wrap: true,
            y: opts.y != null ? opts.y : pos.y,
            renderOption: (idx, opt) => {
                const left = ' ' + String(idx + 1).padStart(2) + '  ' + opt.name;
                const right = String(opt.step) + '步 ';
                const pad = Math.max(0, width - 2 - bufWidth(left) - bufWidth(right));
                return left + ' '.repeat(pad) + right;
            },
        });
    }
}
