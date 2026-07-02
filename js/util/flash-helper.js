import { makeCell, defaultAttr, OverlayZ } from './sgr.js';

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

function _isAborted(cmd, gen) {
    return cmd.abortEpoch !== gen;
}

function _cleanup(term, state) {
    if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
    }
    if (state.ov !== null) {
        term.removeOverlay(state.ov);
        term.markAllDirty();
        state.ov = null;
    }
}

function _runFlashSequence(cmd, term, count, getCell) {
    if (count < 1) return;
    const gen = cmd.abortEpoch;
    const state = { timerId: null, ov: null, remaining: count };

    function cycle() {
        if (_isAborted(cmd, gen)) { _cleanup(term, state); return; }
        if (state.remaining <= 0) { _cleanup(term, state); cmd.releaseBusy(); return; }

        state.ov = _createOverlay(term, getCell);
        term.addOverlay(state.ov);
        term.markAllDirty();

        state.timerId = setTimeout(() => {
            state.timerId = null;
            if (_isAborted(cmd, gen)) { _cleanup(term, state); return; }
            _cleanup(term, state);
            state.remaining--;
            if (state.remaining > 0) {
                state.timerId = setTimeout(() => {
                    state.timerId = null;
                    cycle();
                }, 100);
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
    const gen = cmd.abortEpoch;
    const queue = artworks.slice();
    const state = { timerId: null, ov: null };

    function next() {
        if (_isAborted(cmd, gen)) { _cleanup(term, state); return; }
        if (queue.length === 0) { _cleanup(term, state); cmd.releaseBusy(); return; }

        const mod = queue.shift();
        const { cols, pixels } = mod.default;
        const artRows = Math.ceil(pixels.length / cols);
        const cellRows = Math.ceil(artRows / 2);
        const ox = Math.floor((term.cols - cols) / 2);
        const oy = Math.floor((term.rows - cellRows) / 2);

        state.ov = {
            y: oy, x: ox, h: cellRows, w: cols,
            z: OverlayZ.FLASH,
            owner: null,
            getCell: (relY, relX) => {
                const py = relY * 2;
                const fg = pixels[py * cols + relX];
                const bg = py + 1 < artRows ? pixels[(py + 1) * cols + relX] : 0;
                return makeCell('▀', { ...defaultAttr(), fg, bg }, 1);
            },
        };
        term.addOverlay(state.ov);
        term.markAllDirty();

        state.timerId = setTimeout(() => {
            state.timerId = null;
            if (_isAborted(cmd, gen)) { _cleanup(term, state); return; }
            _cleanup(term, state);
            if (queue.length > 0) {
                state.timerId = setTimeout(() => {
                    state.timerId = null;
                    next();
                }, 150);
            } else {
                cmd.releaseBusy();
            }
        }, 150);
    }

    cmd.holdBusy();
    next();
}
