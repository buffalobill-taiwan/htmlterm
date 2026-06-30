import { CmdBase } from './CmdBase.js';

export class AnimeCmd extends CmdBase {
    static get commandName() { return 'anime'; }
    static get help() { return 'Play anime frames (124 frames, 30fps, Ctrl+C to stop)'; }
    static get menu() { return 'Anime player'; }

    async execute(args) {
        const { default: data } = await import('./art/anime.js');
        const { cols, rows, frames } = data;
        const termRows = rows / 2;  // ▀ half-block: 2 px rows → 1 terminal row

        // Pre-render all frames with cursor-up prefix for in-place update
        const rendered = frames.map(pixels => {
            let out = `\x1B[${termRows + 1}A`;  // +1 for the hint line
            for (let ty = 0; ty < termRows; ty++) {
                for (let x = 0; x < cols; x++) {
                    const fg = pixels[ty * 2 * cols + x];
                    const bg = (ty * 2 + 1) < rows ? pixels[(ty * 2 + 1) * cols + x] : 0;
                    out += `\x1B[38;5;${fg};48;5;${bg}m▀\x1B[0m`;
                }
                out += '\n';
            }
            out += '\x1B[2mPress Ctrl+C to stop\x1B[0m\n';
            return out;
        });

        // Print frame 0 without cursor-up (first output, like art command)
        let firstFrame = '\x1B[?25l';  // hide cursor
        const pixels0 = frames[0];
        for (let ty = 0; ty < termRows; ty++) {
            for (let x = 0; x < cols; x++) {
                const fg = pixels0[ty * 2 * cols + x];
                const bg = (ty * 2 + 1) < rows ? pixels0[(ty * 2 + 1) * cols + x] : 0;
                firstFrame += `\x1B[38;5;${fg};48;5;${bg}m▀\x1B[0m`;
            }
            firstFrame += '\n';
        }
        firstFrame += '\x1B[2mPress Ctrl+C to stop\x1B[0m\n';
        this.print(firstFrame);

        this.holdBusy();
        const gen = this.abortEpoch;
        let frameIdx = 0;

        this._afterDrain(() => {
            if (gen !== this.abortEpoch) { this.releaseBusy(); return; }
            this.term.write('\x1B[?25l');  // typewriter drain shows cursor; hide it again

            const interval = setInterval(() => {
                if (gen !== this.abortEpoch) {
                    clearInterval(interval);
                    this.term.write('\x1B[?25h');  // restore cursor
                    this.releaseBusy();
                    return;
                }
                frameIdx = (frameIdx + 1) % rendered.length;
                this.term.write(rendered[frameIdx]);
            }, Math.round(1000 / 30));
        });
    }
}
