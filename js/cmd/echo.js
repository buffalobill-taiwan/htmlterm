import { CmdBase } from './CmdBase.js';
import { textScaleFlag, textScaleSGR } from '../util/text-scale.js';

export class Echo extends CmdBase {
    execute(args) {
        const scale = textScaleFlag(args[0]);
        if (scale === 0) return this.error('Text scale must be --x2 through --x10.');
        if (scale) {
            this._bigEcho(args, scale);
        } else {
            this.print(args.join(' ') + '\n');
        }
    }

    _bigEcho(args, scale) {
        const bigText = args[1] || '';
        const rest = args.slice(2).join(' ');
        let s = textScaleSGR(scale) + bigText + '\x1B[501m';
        if (rest) s += `\x1B[${scale - 1}B` + rest;
        s += '\n';
        this.print(s);
    }

    static get commandName() { return 'echo'; }
    static get help() { return 'Echo text'; }
    static get menu() { return null; }
    static get usage() { return 'echo [--x2…--x10|--big] text...'; }
}
