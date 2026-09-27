import { makeCell } from './sgr.js';

const digits = Object.fromEntries(Array.from(' 0123456789-', ch =>
    [ch, Object.freeze(makeCell(ch, 11, 0, true))]));

export function buildStatRow(prefix) {
    const cells = Array.from({ length: 16 }, (_, i) => i < 8
        ? makeCell(prefix[i] || ' ', 7, 0, false)
        : digits[' ']);
    return cells;
}

export function writeStatRow(dstRow, cells, value) {
    const text = String(value).padStart(8);
    for (let i = 0; i < 8; i++) cells[8 + i] = digits[text[i]] || digits[' '];
    for (let i = 0; i < 16; i++) dstRow[i] = cells[i];
}
