import { CmdBase } from './CmdBase.js';

export const ARTWORKS = [
    () => import('../data/art/mona.json', { with: { type: 'json' } }),
    () => import('../data/art/night.json', { with: { type: 'json' } }),
    () => import('../data/art/adam.json', { with: { type: 'json' } }),
    () => import('../data/art/kanagawa.json', { with: { type: 'json' } }),
    () => import('../data/art/glaneuses.json', { with: { type: 'json' } }),
    () => import('../data/art/blacklotus.json', { with: { type: 'json' } }),
    () => import('../data/art/parel.json', { with: { type: 'json' } }),
    () => import('../data/art/tang.json', { with: { type: 'json' } }),
    () => import('../data/art/skrik.json', { with: { type: 'json' } }),
];

export class Art extends CmdBase {
    static get commandName() { return 'art'; }
    static get help() { return 'Render ASCII art from a random artwork'; }
    static get menu() { return 'ASCII art'; }
    static get usage() { return 'art'; }

    async execute(args) {
        const isActive = this.executionGuard();
        const loader = ARTWORKS[Math.floor(Math.random() * ARTWORKS.length)];
        const module = await loader();
        if (!isActive()) return;
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
