import { CmdBase } from './CmdBase.js';
import { yellow, bold, white, green } from '../util/sgr.js';
import { displayWidth } from '../util/display-width.js';

const fortunes = [
    '42 is the answer. But what was the question again?',
    'In a world of GUIs, be a terminal.',
    'There is no place like ~',
    'Have you tried turning it off and on again?',
    'Talk is cheap. Show me the code.',
    'Any sufficiently advanced technology is indistinguishable from magic.',
    "It's not a bug — it's an undocumented feature.",
    'The best way to predict the future is to invent it.',
    'First, solve the problem. Then, write the code.',
    'Debugging is twice as hard as writing the code in the first place.',
    '千里之行，始於足下。',
    '學而不思則罔，思而不學則殆。',
    '己所不欲，勿施於人。',
    '溫故而知新，可以為師矣。',
    '三人行，必有我師焉。',
    '天行健，君子以自強不息。',
    '不以物喜，不以己悲。',
    '人生如逆旅，我亦是行人。',
    '生活就像海洋，只有意志堅強的人才能到達彼岸。',
    '上善若水，水善利萬物而不爭。',
    '美麗的花兒，如果缺少伴侶，也是孤單的。',
    '七車び八起きり',
    '猿も木から落ちる',
    '継続は力なり',
    '花より団子',
    '時は金なり',
    '急がば回れ',
    '郷に入っては郷に従え',
    '明日は明日の風が吹く',
    '塵も積もれば山となる',
    '虎穴に入らずんば虎子を得ず',
];

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
