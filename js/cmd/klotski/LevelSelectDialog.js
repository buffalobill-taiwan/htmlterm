import { VerticalSelectDialog } from '../../dialog/VerticalSelectDialog.js';
import LEVELS from '../../data/klotski-levels.json' with { type: 'json' };
import { centeredDialogPos } from '../../dialog/position.js';
import { bufWidth } from '../../util/display-width.js';

class LevelSelectDialog extends VerticalSelectDialog {
    constructor(term, opts) {
        const width = 40;
        const h = LEVELS.length + 6;
        const pos = centeredDialogPos(term, width, h);
        super(term, {
            ...opts,
            width,
            title: '選擇關卡 Klotski',
            footer: '↑↓ 選關  ↩ 開始  ESC 離開',
            options: LEVELS,
            cols: 1,
            wrap: true,
            y: opts.y != null ? opts.y : pos.y,
            renderOption: (idx, opt) => {
                const left = ' ' + String(idx + 1).padStart(2) + '  ' + opt.name;
                const right = String(opt.mini) + '步 ';
                const pad = Math.max(0, width - 2 - bufWidth(left) - bufWidth(right));
                return left + ' '.repeat(pad) + right;
            },
        });
    }
}

export { LevelSelectDialog };
