import { CmdBase } from './CmdBase.js';
import { yellow, bold, white, green } from '../util/sgr.js';
import { displayWidth } from '../util/select-grid.js';
import { fortunes } from './fortune.js';

const COW_EYES = [
    { top: '^__^', eyes: 'oo' },
    { top: '*__*', eyes: '**' },
    { top: '.__.', eyes: '..' },
    { top: '@__@', eyes: '@@' },
    { top: 'O__O', eyes: 'OO' },
    { top: '>__<', eyes: '><' },
    { top: '-__-', eyes: '--' },
    { top: '\'__\'', eyes: '\'\'' },
    { top: 'T__T', eyes: 'xX' },
];

export class Cowsay extends CmdBase {
    execute(args) {
        const text = args.join(' ') || fortunes[Math.floor(Math.random() * fortunes.length)];
        const w = displayWidth(text);
        const border = yellow('='.repeat(w + 2));
        const mid = yellow('< ') + bold(white(text)) + yellow(' >');
        const face = COW_EYES[Math.floor(Math.random() * COW_EYES.length)];
        const cow = green('        \\   ') + bold(white(face.top)) + green('\n') +
                   green('         \\  (') + bold(white(face.eyes)) + green(')\\_______\n') +
                   green('            (__)\\       )\\/\\\n') +
                   green('                ||----') + yellow('w') + green(' |\n') +
                   green('                ||     ||') + '\n';
        this.print(' ' + border + '\n' + mid + '\n' + ' ' + border + '\n' + cow);
    }
    static get commandName() { return 'cowsay'; }
    static get help() { return 'Let a cow speak'; }
    static get menu() { return 'Talking Cow'; }
}
