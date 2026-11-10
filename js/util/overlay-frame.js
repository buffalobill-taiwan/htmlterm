import { VirtualBuffer } from './VirtualBuffer.js';
import { makeCell } from './sgr.js';

/** Pre-build a double-line box border as an array of cell rows. */
export function buildFrameCells(w, h, color) {
    const bc = ch => makeCell(ch, color, 0, true);
    const cells = [];
    for (let r = 0; r < h; r++) {
        const row = new Array(w).fill(null);
        if (r === 0) {
            row[0] = bc('╔');
            for (let c = 1; c < w - 1; c++) row[c] = bc('═');
            row[w - 1] = bc('╗');
        } else if (r === h - 1) {
            row[0] = bc('╚');
            for (let c = 1; c < w - 1; c++) row[c] = bc('═');
            row[w - 1] = bc('╝');
        } else {
            row[0] = bc('║');
            row[w - 1] = bc('║');
        }
        cells.push(row);
    }
    return cells;
}

/** Pre-build an overlay inner area: blank cells with one line of text. */
export function buildTextInner(w, h, text, { row = 1, x = 1 } = {}) {
    const vb = new VirtualBuffer(w, h);
    const e = makeCell(' ', 0, 0, false);
    for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++)
            vb._buffer[r][c] = e;
    vb.writeStr(row, x, text);
    return vb._buffer.map(r => r.slice());
}

/** Pre-build the shared "GAME OVER" panel contents. */
export function buildGameOverInner(w, h) {
    const vb = new VirtualBuffer(w, h);
    const e = makeCell(' ', 0, 0, false);
    for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++)
            vb._buffer[r][c] = { ...e };
    const t1 = ' GAME OVER ';
    vb.writeStr(1, Math.floor((w - t1.length) / 2), '\x1B[1;31m' + t1 + '\x1B[0m');
    vb.writeStr(2, 1, '\x1B[31m' + '─'.repeat(w - 2) + '\x1B[0m');
    const t2 = '[n]ew [q]uit';
    vb.writeStr(3, Math.floor((w - t2.length) / 2), '\x1B[90m' + t2 + '\x1B[0m');
    return vb._buffer.map(r => r.slice());
}
