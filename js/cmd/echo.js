import { CmdBase } from './CmdBase.js';
import { textScaleFlag, textScaleSGR } from '../util/text-scale.js';

export class Echo extends CmdBase {
    execute(args) {
        let scale = 1, inv = false, flip = false, i = 0;
        for (; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--') { i++; break; }
            if (arg === '--inv') { inv = true; continue; }
            if (arg === '--flip') { flip = true; continue; }
            const value = textScaleFlag(arg);
            if (value === 0) return this.error('Text scale must be --x2 through --x10.');
            if (!value) break;
            scale = value;
        }
        this.print(textScaleSGR(scale) + (inv ? '\x1B[520m' : '') +
            (flip ? '\x1B[522m' : '') + args.slice(i).join(' ') + '\x1B[501;521;523m\n');
    }

    static get commandName() { return 'echo'; }
    static get help() { return 'Echo text'; }
    static get menu() { return null; }
    static get usage() { return 'echo [--x2…--x10|--big] [--inv] [--flip] [--] text...'; }
}
