import assert from 'node:assert/strict';
import { EmissaryGame } from '../js/cmd/cardgames/emissary/EmissaryGame.js';
import { createGame } from '../js/cmd/cardgames/emissary/rules.js';
import { setSystem } from '../js/system/sys.js';
import { displayWidth } from '../js/util/display-width.js';

const frames = new Map(), overlays = new Set(), cleanups = new Set();
let frameId = 0;
globalThis.requestAnimationFrame = cb => { frames.set(++frameId, cb); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const tick = time => {
    const pending = [...frames.values()]; frames.clear();
    for (const cb of pending) cb(time);
};
setSystem({ term: {
    cols: 80, rows: 25, writeVB() {}, markRowDirty() {},
    addOverlay: overlay => overlays.add(overlay),
    removeOverlay: overlay => overlays.delete(overlay),
} });
const cmd = {
    executionGuard: () => () => true,
    addCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); },
};

const a = { rank: 3, suit: 2 }, b = { rank: 1, suit: 0 }, c = { rank: 2, suit: 1 };
function fixture(hand, phase = 'discardTwo') {
    const game = new EmissaryGame(cmd);
    game.state = createGame(); game.state.hand = hand;
    game.phase = phase; game.handCursor = 0; game.discardMarked = new Set([0]);
    return game;
}
const game = fixture([a, b, c]);
game.key('s');
assert.equal(game.animating, true);
assert.deepEqual(game.state.hand, [a, b, c]);
const overlay = [...overlays][0];
assert.deepEqual([overlay.x, overlay.y, overlay.w, overlay.h], [2, 15, 71, 7]);
tick(1000); tick(1120);
assert.equal(overlay.getCell(5, 1).ch, '♦');
assert.equal(overlay.getCell(1, 7).ch, '♠');
game.key('s'); game.key(' '); game.key('\r');
assert.equal(game.sortBySuit, true);
tick(1360); tick(1480);
assert.deepEqual(game.state.hand, [b, c, a]);
assert.equal(game.handCursor, 2);
assert.deepEqual([...game.discardMarked], [2]);
assert.equal(game.animating, false);
assert.equal(overlays.size, 0);
game.key('s');
assert.equal(game.sortBySuit, false);
assert.equal(game.animating, false);
const long = fixture(Array.from({length: 20}, (_, i) => ({rank: 20-i, suit: i%4})));
long.key('s'); tick(2000); tick(2480);
assert.equal(long.handCursor, 19); assert.equal(long.handScroll, 8);
assert.deepEqual([...long.discardMarked], [19]);
const cancelled = fixture([a,b]);
cancelled.key('s'); tick(3000); cancelled.stopAnimations(); tick(3480);
assert.deepEqual(cancelled.state.hand, [a,b]);
assert.equal(overlays.size, 0); assert.equal(frames.size, 0);
const aborted = fixture([a,b]); aborted.key('s'); tick(4000);
for (const cleanup of [...cleanups]) cleanup();
assert.deepEqual(aborted.state.hand, [a,b]);
assert.equal(overlays.size, 0); assert.equal(frames.size, 0);
for (const phase of ['swap', 'won', 'lost']) {
    const blocked = fixture([a,b], phase); blocked.key('s');
    assert.equal(blocked.sortBySuit, false);
}
setSystem(null);
console.log('Emissary sorting: ordering, selection, lanes, scrolling, gating and cancellation passed');
