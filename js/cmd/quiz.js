import { CmdBase } from './CmdBase.js';

export class Quiz extends CmdBase {
    execute(args) {
        const a = Math.floor(Math.random() * 9) + 1;
        let b = Math.floor(Math.random() * 9) + 1;
        const ops = ['+', '-', '\u00D7'];
        const op = ops[Math.floor(Math.random() * 3)];
        if (op === '-' && a < b) b = [a, a = b][0];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

        this.print(`\x1B[36m${a} ${op} ${b} = ?\x1B[0m\n`);

        this.readLine((line) => {
            const userAns = parseInt(line, 10);
            if (userAns === answer) {
                this.print('\x1B[1;32m\u2713 Correct!\x1B[0m\n');
            } else {
                this.print(`\x1B[1;31m\u2717 Wrong!\x1B[0m  Answer: \x1B[1;37m${answer}\x1B[0m\n`);
            }
        });
    }

    static get commandName() { return 'quiz'; }
    static get help() { return 'Math quiz'; }
    static get menu() { return 'Math Quiz'; }
}
