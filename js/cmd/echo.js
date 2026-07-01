import { CmdBase } from './CmdBase.js';

export class Echo extends CmdBase {
    execute(args) {
        if (args[0] === '--big') {
            this._bigEcho(args);
        } else {
            this.print(args.join(' ') + '\n');
        }
    }

    _bigEcho(args) {
        const bigText = args[1];
        const rest = args.slice(2).join(' ');
        let s = '\x1B[500m' + bigText + '\x1B[501m';
        if (rest) s += '\x1B[B' + rest;
        s += '\n';
        this.print(s);
    }

    static get commandName() { return 'echo'; }
    static get help() { return 'Echo text'; }
    static get menu() { return null; }
}
