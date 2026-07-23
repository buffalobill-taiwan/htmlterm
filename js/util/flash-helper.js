import { makeCell, defaultAttr, OverlayZ } from './sgr.js';
import { scheduleWithAbort, createAbortGuard } from '../system/BusyAsyncHelper.js';

const FLASH_WHITE = makeCell(' ', (() => {
    const a = defaultAttr();
    a.fg = 15; a.bg = 15;
    return a;
})(), 1);

function _createOverlay(term, getCell) {
    return {
        y: 0, x: 0, h: term.rows, w: term.cols,
        z: OverlayZ.FLASH,
        owner: null,
        getCell,
    };
}

function _runFlashSequence(cmd, term, count, getCell) {
    if (count < 1) return;
    let remaining = count;
    let ov = null;

    function cleanup() {
        if (ov) { term.removeOverlay(ov); term.markAllDirty(); ov = null; }
    }

    function cycle() {
        if (remaining <= 0) { cleanup(); cmd.releaseBusy(); return; }

        ov = _createOverlay(term, getCell);
        term.addOverlay(ov);
        term.markAllDirty();

        const guard = createAbortGuard(() => cmd.abortEpoch);
        setTimeout(() => {
            if (!guard()) { cleanup(); cmd.releaseBusy(); return; }
            cleanup();
            remaining--;
            if (remaining > 0) {
                scheduleWithAbort(() => cmd.abortEpoch, cycle, 100);
            } else {
                cmd.releaseBusy();
            }
        }, 60);
    }

    cmd.holdBusy();
    cycle();
}

export function screenFlash(cmd, term, count) {
    _runFlashSequence(cmd, term, count, () => FLASH_WHITE);
}

export function borderFlash(cmd, term, count) {
    const cols = term.cols;
    const rows = term.rows;
    _runFlashSequence(cmd, term, count, (y, x) =>
        (y === 0 || y === rows - 1 || x === 0 || x === cols - 1) ? FLASH_WHITE : null);
}

export function artSequence(cmd, term, artworks) {
    if (!artworks || artworks.length === 0) return;
    const queue = artworks.slice();
    let ov = null;

    function cleanup() {
        if (ov) { term.removeOverlay(ov); term.markAllDirty(); ov = null; }
    }

    function next() {
        if (queue.length === 0) { cleanup(); cmd.releaseBusy(); return; }

        const mod = queue.shift();
        const { cols, pixels } = mod.default;
        const artRows = Math.ceil(pixels.length / cols);
        const cellRows = Math.ceil(artRows / 2);
        const ox = Math.floor((term.cols - cols) / 2);
        const oy = Math.floor((term.rows - cellRows) / 2);

        const attr = defaultAttr();
        ov = {
            y: oy, x: ox, h: cellRows, w: cols,
            z: OverlayZ.FLASH,
            owner: null,
            getCell: (relY, relX) => {
                const py = relY * 2;
                attr.fg = pixels[py * cols + relX];
                attr.bg = py + 1 < artRows ? pixels[(py + 1) * cols + relX] : 0;
                return makeCell('▀', attr, 1);
            },
        };
        term.addOverlay(ov);
        term.markAllDirty();

        const guard = createAbortGuard(() => cmd.abortEpoch);
        setTimeout(() => {
            if (!guard()) { cleanup(); cmd.releaseBusy(); return; }
            cleanup();
            if (queue.length > 0) {
                scheduleWithAbort(() => cmd.abortEpoch, next, 150);
            } else {
                cmd.releaseBusy();
            }
        }, 150);
    }

    cmd.holdBusy();
    next();
}
