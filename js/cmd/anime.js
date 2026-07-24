import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { decodeRLE, applyDiff } from '../util/pixel-codec.js';
import { makeCell, defaultAttr } from '../util/sgr.js';
import { startBufferAnimation } from '../system/RAFAnimationHelper.js';

function toCells(pixels, cols, termRows, pixelRows) {
    const attr = defaultAttr();
    const frameBuf = new Array(termRows);
    for (let ty = 0; ty < termRows; ty++) {
        const row = new Array(cols);
        for (let x = 0; x < cols; x++) {
            attr.fg = pixels[ty * 2 * cols + x];
            attr.bg = (ty * 2 + 1) < pixelRows ? pixels[(ty * 2 + 1) * cols + x] : 0;
            row[x] = makeCell('▀', attr, 1);
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
        const ox = Math.floor((term.cols - cols) / 2);
        const oy = Math.floor((term.rows - overlayH) / 2);

        // Decode all frames
        let prevFrame = decodeRLE(rle0, cols * rows);
        let cellFrames = [toCells(prevFrame, cols, termRows, rows)];
        for (const diff of diffs) {
            applyDiff(prevFrame, diff);
            cellFrames.push(toCells(prevFrame, cols, termRows, rows));
        }
        prevFrame = null;

        // Create hint row
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

        // getCell reads directly from the current frame pointer — no intermediate buffer
        let curFrameCells = cellFrames[0];
        const getCell = (relRow, relCol) => {
            if (relRow < termRows) return curFrameCells[relRow][relCol];
            if (relRow === termRows) return hintRow[relCol];
            return null;
        };

        // Cache screen.markRowDirty to bypass Proxy wrapper allocation
        const screen = term.screen;
        const markDirty = screen.markRowDirty.bind(screen);

        // Mark hint row dirty once (it never changes)
        markDirty(oy + termRows);

        // Start animation with frame-level row diffing
        let frameIdx = 0;
        let prevFrameCells = cellFrames[0];

        const animation = startBufferAnimation(
            this,
            getCell,
            (ts, loopFrameIdx) => {
                frameIdx = (frameIdx + 1) % cellFrames.length;
                curFrameCells = cellFrames[frameIdx];

                // Only mark rows that actually changed
                for (let ty = 0; ty < termRows; ty++) {
                    const src = curFrameCells[ty];
                    const dst = prevFrameCells[ty];
                    let changed = false;
                    for (let x = 0; x < cols; x++) {
                        if (src[x] !== dst[x]) { changed = true; break; }
                    }
                    if (changed) markDirty(oy + ty);
                }

                prevFrameCells = curFrameCells;
            },
            {
                y: oy,
                x: ox,
                w: cols,
                h: overlayH,
                frameDuration: 1000 / 30,  // 30fps
                onCleanup: () => { cellFrames = null; },
            }
        );
    }
}
