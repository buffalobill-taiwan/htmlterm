import { makeCell } from './sgr.js';
import { markDirtyRows } from './drag.js';

const FLASH_WHITE = makeCell(' ', 15, 15, false);

// One timer and overlay belong to the calling frame, including the gaps.
function runSequence(cmd, term, count, createOverlay, visibleMs, gapMs) {
    if (count < 1) return;
    let timer = null;
    let overlay = null;
    let index = 0;
    let active = true;

    const hide = () => {
        if (!overlay) return;
        term.removeOverlay(overlay);
        markDirtyRows(term, overlay.y, overlay.h);
        overlay = null;
    };
    const removeCleanup = cmd.addCleanup(() => {
        active = false;
        clearTimeout(timer);
        hide();
    });
    const next = () => {
        if (!active) return;
        overlay = createOverlay(index++);
        term.addOverlay(overlay);
        markDirtyRows(term, overlay.y, overlay.h);
        timer = setTimeout(() => {
            if (!active) return;
            hide();
            if (index < count) {
                timer = setTimeout(next, gapMs);
            } else {
                active = false;
                timer = null;
                removeCleanup();
                cmd.releaseBusy();
            }
        }, visibleMs);
    };
    cmd.holdBusy();
    next();
}

export function screenFlash(cmd, term, count) {
    const overlay = {
        y: 0, x: 0, h: term.rows, w: term.cols, owner: null,
        getCell: () => FLASH_WHITE,
    };
    runSequence(cmd, term, count, () => overlay, 60, 100);
}

export function borderFlash(cmd, term, count) {
    const cols = term.cols;
    const rows = term.rows;
    const overlay = {
        y: 0, x: 0, h: rows, w: cols, owner: null,
        getCell: (y, x) =>
            (y === 0 || y === rows - 1 || x === 0 || x === cols - 1) ? FLASH_WHITE : null,
    };
    runSequence(cmd, term, count, () => overlay, 60, 100);
}

export function artSequence(cmd, term, artworks) {
    if (!artworks?.length) return;
    // Cache decoded backing cells once, including repeated artworks.
    const cache = new Map();
    const overlays = artworks.map(mod => {
        if (cache.has(mod)) return cache.get(mod);
        const { cols, pixels } = mod.default;
        const artRows = Math.ceil(pixels.length / cols);
        const cellRows = Math.ceil(artRows / 2);
        const cells = Array.from({ length: cellRows }, (_, y) =>
            Array.from({ length: cols }, (_, x) => makeCell('▀',
                pixels[y * 2 * cols + x],
                y * 2 + 1 < artRows ? pixels[(y * 2 + 1) * cols + x] : 0, false)));
        const overlay = {
            y: Math.floor((term.rows - cellRows) / 2),
            x: Math.floor((term.cols - cols) / 2),
            h: cellRows, w: cols, owner: null,
            getCell: (y, x) => cells[y][x],
        };
        cache.set(mod, overlay);
        return overlay;
    });
    runSequence(cmd, term, overlays.length, i => overlays[i], 150, 150);
}
