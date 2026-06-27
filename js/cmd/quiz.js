import { CmdBase } from './CmdBase.js';
import { cyan, bold, green, red, white } from '../sgr.js';
import { InputDialog, ShowDialog } from '../dialog/index.js';

export class Quiz extends CmdBase {
    execute(args) {
        let a = Math.floor(Math.random() * 9) + 1;
        let b = Math.floor(Math.random() * 9) + 1;
        const ops = ['+', '-', '×'];
        const op = ops[Math.floor(Math.random() * 3)];
        if (op === '-' && a < b) [a, b] = [b, a];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

        this.print(cyan(a + ' ' + op + ' ' + b + ' = ?') + '\n');

        this.readLine((line) => {
            const userAns = parseInt(line, 10);
            if (userAns === answer) {
                this.print(bold(green('✓ Correct!')) + '\n');
            } else {
                this.print(bold(red('✗ Wrong!')) + '  Answer: ' + bold(white(answer)) + '\n');
            }
        });
    }

    static get commandName() { return 'quiz'; }
    static get help() { return 'Math quiz'; }
    static get menu() { return 'Math Quiz'; }

    static openMenuDialog(shell, menuDlg) {
        let a = Math.floor(Math.random() * 9) + 1;
        let b = Math.floor(Math.random() * 9) + 1;
        const ops = ['+', '-', '×'];
        const op = ops[Math.floor(Math.random() * 3)];
        if (op === '-' && a < b) b = [a, a = b][0];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

        shell.system._createDialog(InputDialog, 'quiz', {
            title: 'Quiz',
            prompt: `${a} ${op} ${b} = ?`,
            footer: 'Enter Answer  ESC Back',
            onConfirm: (expr) => {
                if (!expr.trim()) return;
                const userAns = parseInt(expr.trim(), 10);
                let msg;
                if (userAns === answer) {
                    msg = bold(green('✓ Correct!'));
                } else {
                    msg = bold(red('✗ Wrong!')) + '  Answer: ' + bold(white('' + answer));
                }
                setTimeout(() => {
                    shell.system._createDialog(ShowDialog, 'show', { message: msg, onExit: () => {} });
                }, 0);
            },
            onCancel: () => {},
        });
    }
}
