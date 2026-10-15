import { makeCell } from './sgr.js';
import { bufWidth, isWide } from './display-width.js';

export function buildCallEffectBuffer(text) {
    const W = bufWidth(text) * 2 + 2, H = 4;
    const buf = Array.from({ length: H }, () => Array(W).fill(null));
    const fg = 7, bg = 0;
    buf[0][0] = makeCell('╔', fg, bg, false);
    buf[0][W - 1] = makeCell('╗', fg, bg, false);
    buf[H - 1][0] = makeCell('╚', fg, bg, false);
    buf[H - 1][W - 1] = makeCell('╝', fg, bg, false);
    for (let c = 1; c < W - 1; c++) {
        buf[0][c] = makeCell('═', fg, bg, false);
        buf[H - 1][c] = makeCell('═', fg, bg, false);
    }
    for (let r = 1; r < H - 1; r++) {
        buf[r][0] = makeCell('║', fg, bg, false);
        buf[r][W - 1] = makeCell('║', fg, bg, false);
    }
    let x = 1;
    for (const ch of text) {
        const width = isWide(ch) ? 4 : 2;
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < width; c++) {
                const cell = makeCell(ch, fg, bg, true, 1);
                cell.clip = true;
                cell.clipOffX = -c;
                cell.clipOffY = -r;
                buf[1 + r][x + c] = cell;
            }
        }
        x += width;
    }
    return buf;
}
