import assert from 'node:assert/strict';
import { RegicideGame } from '../js/cmd/cardgames/regicide/RegicideGame.js';
import { createGame } from '../js/cmd/cardgames/regicide/rules.js';
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
const card = (rank, suit) => ({ rank, suit });
function fixture(hand, phase = 'attack') {
    const game = new RegicideGame(cmd);
    game.stopDeals();
    game.state = { ...createGame(), hand, phase, enemy: card(11, 0) };
    game.selected = new Set([0]); game.cursor = 0; game.sortBySuit = false;
    game.draw();
    return game;
}
function finish() { tick(1000); tick(1480); }
const a = card(3, 2), b = card(1, 0), c = card(2, 1);
const game = fixture([a, b, c], 'defend');
game.key('s');
assert.equal(game.sorting, true);
assert.deepEqual(game.state.hand, [a, b, c]);
const overlay = [...overlays][0];
assert.deepEqual([overlay.x, overlay.y, overlay.w, overlay.h], [3, 16, 69, 7]);
assert.equal(game.areas.preview.vb.getCell(0, 0), null);
const checkCard = (x, y, suit, immune = false) => {
    const cell = overlay.getCell(y + 1, x + 1);
    assert.equal(cell.ch, '♠♥♦♣'[suit]);
    assert.equal(cell.bg, 8); // Defence tint survives every animation stage.
    if (immune) assert.equal(cell.fg, 250);
};
tick(1000);
checkCard(0, 2, 2); checkCard(9, 2, 0, true);
tick(1120);
checkCard(0, 4, 2); checkCard(9, 0, 0, true); checkCard(18, 0, 1);
tick(1360);
checkCard(18, 4, 2); checkCard(0, 0, 0, true); checkCard(9, 0, 1);
game.key('S'); game.key(' '); game.key('\r'); game.key('j');
assert.equal(game.sortBySuit, true);
assert.deepEqual(game.state.hand, [a, b, c]);
tick(1480);
assert.deepEqual(game.state.hand, [b, c, a]);
assert.deepEqual([...game.selected], [2]); assert.equal(game.cursor, 2);
assert.equal(game.sorting, false); assert.equal(overlays.size, 0);
assert.equal(cleanups.size, 0);
game.key('S'); // Already in suit order: counts but does not animate.
assert.equal(game.sortBySuit, false); assert.equal(game.sorting, false);
assert.ok(displayWidth('←→ 移動  Space 選牌  Enter 確認  S 排序  J 小丑  H 規則  N 選單  Q/Esc 離開') <= 76);

const mixed = [card(13, 0), card(10, 3), card(11, 0), card(1, 2), card(10, 1)];
const ordering = fixture(mixed);
ordering.key('S'); finish();
assert.deepEqual(ordering.state.hand.map(c => [c.rank, c.suit]), [[1, 2], [10, 1], [10, 3], [11, 0], [13, 0]]);
ordering.key('s'); finish();
assert.deepEqual(ordering.state.hand.map(c => [c.rank, c.suit]), [[11, 0], [13, 0], [10, 1], [1, 2], [10, 3]]);
for (const hand of [[], [a]]) {
    const small = fixture(hand);
    small.key('s'); assert.equal(small.sortBySuit, true); assert.equal(small.sorting, false);
}
for (const phase of ['win', 'loss']) {
    const ended = fixture([a, b], phase);
    ended.key('s'); assert.equal(ended.sortBySuit, false);
}
const blocked = fixture([a, b]);
blocked.dealing = true; blocked.key('s'); assert.equal(blocked.sortBySuit, false);
blocked.dealing = false; blocked.key('s'); tick(1000); blocked.stopDeals(); tick(1480);
assert.deepEqual(blocked.state.hand, [a, b]);
assert.equal(blocked.sorting, false); assert.equal(overlays.size, 0); assert.equal(frames.size, 0);
const aborted = fixture([a, b]);
aborted.key('s'); tick(1000);
for (const cleanup of [...cleanups]) cleanup();
assert.equal(overlays.size, 0); assert.equal(frames.size, 0);
assert.deepEqual(aborted.state.hand, [a, b]);
setSystem(null);
console.log('Regicide sorting: ordering, identity, animation lanes/tints, input gating and cleanup passed');
