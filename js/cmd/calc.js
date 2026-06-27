import { CmdBase } from './CmdBase.js';
import { safeEval } from '../calc-expr.js';
import { red } from '../sgr.js';
import { InputDialog, ShowDialog } from '../dialog/index.js';

export class Calc extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args);
        if (p.hasHelp) return this.showHelp();
        const expr = p.rest.join(' ');
        if (!expr) return this.error('no expression provided');
        try {
            const result = safeEval(expr);
            this.print(result + '\n');
        } catch (e) {
            this.error('invalid expression');
        }
    }
    static get commandName() { return 'calc'; }
    static get help() { return 'Simple calculator'; }
    static get menu() { return 'Simple Calculator'; }
    static get usage() { return 'calc <expression>'; }

    static openMenuDialog(shell, menuDlg) {
        shell.system._createDialog(InputDialog, 'calc', {
            title: '請輸入算式',
            prompt: '算式：',
            footer: 'Enter Confirm  ESC Back',
            onConfirm: (expr) => {
                if (!expr.trim()) return;
                let msg;
                try { msg = String(safeEval(expr)); }
                catch (e) { msg = red('Error:') + ' ' + (e.message || 'invalid expression'); }
                setTimeout(() => {
                    shell.system._createDialog(ShowDialog, 'show', { message: msg, onExit: () => {} });
                }, 0);
            },
            onCancel: () => {},
        });
    }
}
