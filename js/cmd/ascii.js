import { CmdBase } from './CmdBase.js';
import { bold, gray, sgr } from '../util/sgr.js';

export class Ascii extends CmdBase {
    execute(args) {
        this.print(bold('Standard 16 ANSI Colors:') + '\n');
        for (let bg = 0; bg < 16; bg++) {
            this.print(sgr(48, 5, bg)('  '));
            if (bg % 8 === 7) this.print('\n');
        }
        this.print('\n' + bold('Color Cube 6×6×6 (▄ bg=G₁ fg=Gₒ, B=0..5):') + '\n');
        for (let g = 0; g < 6; g += 2) {
            this.print(gray(g + '-' + (g + 1)) + ' ');
            for (let b = 0; b < 6; b++) {
                this.print(gray(b));
                for (let r = 0; r < 6; r++) {
                    const top = 16 + r + g * 36 + b * 6;
                    const bot = 16 + r + (g + 1) * 36 + b * 6;
                    this.print(sgr(38, 5, bot, 48, 5, top)('▄'));
                }
            }
            this.print('\n');
        }
    }
    static get commandName() { return 'ascii'; }
    static get help() { return 'Show ANSI color chart'; }
    static get menu() { return 'ANSI Color Chart'; }
}
