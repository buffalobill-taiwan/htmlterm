import { CmdBase } from './CmdBase.js';

export const ARTWORKS = [
    () => import('./art/mona.js'),
    () => import('./art/night.js'),
    () => import('./art/adam.js'),
    () => import('./art/kanagawa.js'),
    () => import('./art/glaneuses.js'),
    () => import('./art/blacklotus.js'),
    () => import('./art/parel.js'),
    () => import('./art/tang.js'),
    () => import('./art/skrik.js'),
];

export class Art extends CmdBase {
    static get commandName() { return 'art'; }
    static get help() { return 'Render ASCII art from a random artwork'; }
    static get menu() { return 'ASCII art'; }

    async execute(args) {
        const loader = ARTWORKS[Math.floor(Math.random() * ARTWORKS.length)];
        const module = await loader();
        const { cols, pixels } = module.default;
        const ROWS = pixels.length / cols;
        let out = '';
        for (let y = 0; y < ROWS; y += 2) {
            for (let x = 0; x < cols; x++) {
                const fg = pixels[y * cols + x];
                const bg = y + 1 < ROWS ? pixels[(y + 1) * cols + x] : 0;
                out += `\x1B[38;5;${fg};48;5;${bg}m▀\x1B[0m`;
            }
            out += '\n';
        }
        this.print(out);
    }
}
