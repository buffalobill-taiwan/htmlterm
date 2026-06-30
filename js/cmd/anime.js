import { CmdBase } from './CmdBase.js';
import { decodeRLE, applyDiff } from '../util/pixel-codec.js';
import { OverlayZ, createEmptyBuffer, makeOverlayGetCell, CURSOR_HIDE, CURSOR_SHOW, makeCell, defaultAttr } from '../util/sgr.js';

function toCells(pixels, cols, termRows, pixelRows) {
    const frameBuf = new Array(termRows);
    for (let ty = 0; ty < termRows; ty++) {
        const row = new Array(cols);
        for (let x = 0; x < cols; x++) {
            const fg = pixels[ty * 2 * cols + x];
            const bg = (ty * 2 + 1) < pixelRows ? pixels[(ty * 2 + 1) * cols + x] : 0;
            row[x] = makeCell('▀', { ...defaultAttr(), fg, bg }, 1);
        }
        frameBuf[ty] = row;
    }
    return frameBuf;
}

export class AnimeCmd extends CmdBase {
    static get commandName() { return 'anime'; }
    static get help() { return 'Play anime frames (124 frames, 30fps, Ctrl+C to stop)'; }
    static get menu() { return 'Anime player'; }

    async execute(args) {
        const { default: data } = await import('./art/anime.js');
        const { cols, rows, frames: numFrames, rle0, diffs } = data;
        const termRows = rows / 2;
        const overlayH = termRows + 1;
        const ox = Math.floor((this.term.cols - cols) / 2);
        const oy = Math.floor((this.term.rows - overlayH) / 2);

        let prevFrame = decodeRLE(rle0, cols * rows);
        const cellFrames = [toCells(prevFrame, cols, termRows, rows)];
        for (const diff of diffs) {
            applyDiff(prevFrame, diff);
            cellFrames.push(toCells(prevFrame, cols, termRows, rows));
        }

        const hintText = 'Press Ctrl+C to stop';
        const hintPad = Math.floor((cols - hintText.length) / 2);
        const def = defaultAttr();
        const hintRow = new Array(cols);
        for (let x = 0; x < cols; x++) hintRow[x] = null;
        for (let x = 0; x < hintText.length; x++) {
            const cell = makeCell(hintText[x], def, 1);
            cell.dim = true;
            hintRow[hintPad + x] = cell;
        }

        const buffer = createEmptyBuffer(cols, overlayH);
        const overlay = {
            y: oy, x: ox, h: overlayH, w: cols,
            z: OverlayZ.FLASH,
            owner: null,
            getCell: makeOverlayGetCell(() => buffer, cols, overlayH),
        };

        this.holdBusy();
        const gen = this.abortEpoch;

        const copyFrame = (frameIdx) => {
            const frame = cellFrames[frameIdx];
            for (let ty = 0; ty < termRows; ty++) {
                const srcRow = frame[ty];
                const dstRow = buffer[ty];
                for (let x = 0; x < cols; x++) dstRow[x] = srcRow[x];
            }
            buffer[termRows] = hintRow;
        };

        let rafId = null;
        const cleanup = () => {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            this.term.removeOverlay(overlay);
            this.term.markAllDirty();
            this.term.write(CURSOR_SHOW);
            this.releaseBusy();
        };

        this.term.write(CURSOR_HIDE);

        copyFrame(0);
        this.term.addOverlay(overlay);
        this.term.markAllDirty();

        let frameIdx = 0;
        let lastFrame = 0;
        const TARGET_MS = 1000 / 30;

        const loop = (ts) => {
            if (gen !== this.abortEpoch) { cleanup(); return; }
            if (ts - lastFrame >= TARGET_MS) {
                frameIdx = (frameIdx + 1) % cellFrames.length;
                copyFrame(frameIdx);
                this.term.markAllDirty();
                lastFrame = ts;
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
    }
}
