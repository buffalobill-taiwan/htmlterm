import assert from 'node:assert/strict';
import { setSystem } from '../js/system/sys.js';
import { flyCard } from '../js/cmd/cardgames/freecell/animation.js';
import { FreeCellGame } from '../js/cmd/cardgames/freecell/FreeCellGame.js';
import { clone, validate } from '../js/cmd/cardgames/freecell/engine.js';

const frames = new Map(), overlays = new Set(), cleanups = new Set(), dirty = [];
let id = 0, time = 100, completed = 0;
const savedRAF = globalThis.requestAnimationFrame, savedCancel = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
setSystem({ term: {
    cols: 80, rows: 25,
    addOverlay: o => overlays.add(o), removeOverlay: o => overlays.delete(o),
    markRowDirty: r => dirty.push(r), writeVB() {},
} });
const cmd = {
    executionGuard: () => () => true,
    addCleanup(fn) { cleanups.add(fn); return () => cleanups.delete(fn); },
    openDialog() { throw Error('Input opened a dialog during flight'); },
    _quit() { throw Error('Input quit during flight'); },
    _menu() { throw Error('Input opened a menu during flight'); },
};
const tick = (elapsed = 20) => {
    time += elapsed;
    const pending = [...frames.values()]; frames.clear();
    for (const fn of pending) fn(time);
};
const drain = () => {
    let remaining = 1000;
    while (frames.size && remaining--) tick();
    assert.ok(remaining > 0, 'Animation must finish');
};
try {
    flyCard(cmd, 0, { x: 4, y: 6 }, { x: 7, y: 3 }, () => completed++);
    const overlay = [...overlays][0], face = overlay.getCell(0, 0);
    tick(); // Establish the RAF start timestamp.
    assert.deepEqual([overlay.x, overlay.y], [4, 6]);
    tick(); assert.deepEqual([overlay.x, overlay.y], [5, 5]);
    assert.equal(overlay.getCell(0, 0), face);
    tick(); assert.deepEqual([overlay.x, overlay.y], [6, 4]);
    tick(); assert.equal(completed, 1); assert.equal(overlays.size, 0);
    assert.ok(dirty.every(r => r >= 3 && r <= 8), 'Only old/new card rows are dirty');
    const cancel = flyCard(cmd, 0, { x: 4, y: 6 }, { x: 40, y: 2 }, () => completed++);
    tick(); cancel(); drain();
    assert.equal(completed, 1); assert.equal(overlays.size, 0);

    const game = new FreeCellGame(cmd);
    game.initial = { columns: [[12],[],[],[],[],[],[],[]], cells: [null,null,null,null], foundations: [12,13,13,13] };
    game.state = clone(game.initial);
    const before = clone(game.state);
    game.selected = { zone: 'column', index: 0, card: 0 };
    assert.equal(game.move({ zone: 'cell', index: 0 }), true);
    assert.equal(game.flight.from.zone, 'cell');
    assert.equal(game.state.foundations[0], 12, 'Collection waits for landing');
    assert.equal(game.state.cells[0], 12, 'Logical state stays complete during flight');
    const locked = JSON.stringify({ state: game.state, cursor: game.cursor, scroll: game.scroll });
    for (const key of ['q','m','n','r','u','\x1B',' ','\r','\x1B[C','\x1B[6~']) game.key(key);
    for (const type of ['mousedown','mousemove','mouseup']) assert.equal(game.handleMouse(type, { col: 4, row: 6, btn: 0 }), true);
    assert.equal(JSON.stringify({ state: game.state, cursor: game.cursor, scroll: game.scroll }), locked);
    assert.equal(game.drag, null);
    assert.equal(game.history.length, 1);
    drain(); validate(game.state);
    assert.equal(game.collecting, false); assert.equal(game.state.foundations[0], 13);
    assert.match(game.status, /恭喜完成/);
    game.key('u'); assert.deepEqual(game.state, before);

    game.initial = { columns: [[12],[25],[38],[51],[],[],[],[]], cells: [null,null,null,null], foundations: [12,12,12,12] };
    game.restart();
    assert.equal(game.collecting, false);
    assert.equal(overlays.size, 0);
    assert.deepEqual(game.state, game.initial, 'Opening preserves all cards');
    assert.equal(game.history.length, 0);
    game.key('\x1B[C'); game.key('\r'); game.key(' ');
    assert.deepEqual(game.state, game.initial, 'Navigation and selection do not collect');
    game.selected = { zone: 'column', index: 0, card: 0 };
    assert.equal(game.move({ zone: 'column', index: 1 }), false);
    assert.equal(game.collecting, false, 'Rejected moves do not start collection');
    assert.equal(game.move({ zone: 'column', index: 4 }), true);
    assert.equal(game.flight.from.zone, 'column');
    // Columns 1, 2, 3 collect before the moved king in column 4.
    for (const suit of [1,2,3,0]) {
        assert.equal(game.flight.to.index, suit);
        while (game.collecting && game.flight.to.index === suit) tick();
        assert.equal(game.state.foundations[suit], 13);
        assert.ok(overlays.size <= 1, 'Cards fly one at a time');
    }
    assert.equal(game.collecting, false); assert.equal(overlays.size, 0);
    game.key('u'); assert.deepEqual(game.state, game.initial, 'Undo restores the uncollected opening');
    game.restart();
    game.selected = { zone: 'column', index: 0, card: 0 };
    game.move({ zone: 'cell', index: 0 }); tick(); game.dispose();
    const disposed = clone(game.state); drain();
    assert.deepEqual(game.state, disposed);
    assert.equal(overlays.size, 0); assert.equal(cleanups.size, 0);
    const longGame = new FreeCellGame(cmd);
    longGame.initial = {
        columns: [Array.from({ length: 19 }, (_, i) => i + 1).concat(0),
            Array.from({ length: 32 }, (_, i) => i + 20), [], [], [], [], [], []],
        cells: [null,null,null,null], foundations: [0,0,0,0],
    };
    validate(longGame.initial);
    longGame.restart();
    longGame.selected = { zone: 'column', index: 1, card: 31 };
    assert.equal(longGame.move({ zone: 'cell', index: 0 }), true);
    assert.equal(longGame.scroll[0], 6);
    assert.equal([...overlays][0].y, 19, 'Scrolled source exposes the full departing card');
    drain(); validate(longGame.state); longGame.dispose();
    flyCard(cmd, 0, { x: 4, y: 6 }, { x: 40, y: 2 }, () => completed++);
    for (const cleanup of [...cleanups]) cleanup();
    drain(); assert.equal(completed, 1); assert.equal(overlays.size, 0);
    console.log('FreeCell flight timing, sequential collection, input lock, undo and cleanup passed');
} finally {
    setSystem(null);
    globalThis.requestAnimationFrame = savedRAF;
    globalThis.cancelAnimationFrame = savedCancel;
}
