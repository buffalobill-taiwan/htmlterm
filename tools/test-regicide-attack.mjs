import assert from 'node:assert/strict';
import { RegicideGame } from '../js/cmd/cardgames/regicide/RegicideGame.js';
import { createGame } from '../js/cmd/cardgames/regicide/rules.js';
import { setSystem } from '../js/system/sys.js';

// Drive the real flight, flash and cleanup helpers with one deterministic clock.
const frames = new Map(), timers = new Map(), overlays = new Set(), cleanups = new Set();
let now = 0, id = 0;
globalThis.requestAnimationFrame = cb => { frames.set(++id, cb); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.setTimeout = (cb, delay) => { timers.set(++id, { cb, at: now + delay }); return id; };
globalThis.clearTimeout = id => timers.delete(id);
Object.defineProperty(performance, 'now', { value: () => now });
function step() {
    now += 16;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.cb(); }
    const pending = [...frames.values()]; frames.clear();
    for (const cb of pending) cb(now);
}
function until(predicate) {
    for (let i = 0; i < 1000; i++) { if (predicate()) return; step(); }
    assert.fail('Animation did not reach expected phase');
}
const term = { cols: 80, rows: 25, writeVB() {}, markRowDirty() {},
    screen: { markRowDirty() {} },
    addOverlay: overlay => overlays.add(overlay), removeOverlay: overlay => overlays.delete(overlay) };
setSystem({ term });
const cmd = { executionGuard: () => () => true,
    addCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); } };
const c = (rank, suit) => ({ rank, suit });
function fixture(cards, options = {}) {
    const g = new RegicideGame(cmd); g.stopDeals();
    g.state = { ...createGame(() => 0.5), enemy: c(13, 0), hp: 40,
        hand: [...cards, c(9, 0)], played: [c(4, 0)], deck: [c(5, 0), c(6, 0)], discard: [], ...options };
    g.selected = new Set(cards.map((_, i) => i)); g.cursor = 0;
    g.draw(); return g;
}
function dispose(g) {
    g.dispose();
    assert.equal(overlays.size, 0); assert.equal(frames.size, 0); assert.equal(timers.size, 0);
    assert.equal(cleanups.size, 0);
}
for (const cards of [[c(3, 3)], [c(1, 0), c(4, 3)], [c(2, 0), c(2, 1), c(2, 2), c(2, 3)]]) {
    const g = fixture(cards, { discard: [c(7, 1), c(8, 1)] });
    const oldHand = [...g.state.hand], oldUsed = [...g.state.played];
    g.key('\r');
    assert.deepEqual(g.handOverride, oldHand);
    assert.deepEqual(g.usedDisplay, oldUsed);
    assert.equal(g.flashing, false);
    const stage = [...overlays].find(o => o.x === 17 && o.y === 14 && o.w === (cards.length - 1) * 9 + 5);
    assert.ok(stage);
    until(() => !g.handOverride);
    for (let i = 0; i < cards.length; i++) assert.equal(stage.getCell(1, i * 9 + 1).ch, '♠♥♦♣'[cards[i].suit]);
    assert.deepEqual(g.usedDisplay, oldUsed);
    if (cards.length === 4) {
        assert.equal(g.recovering, true);
        until(() => !g.recovering);
        assert.ok(overlays.has(stage));
    }
    until(() => g.flashing);
    assert.ok(overlays.has(stage));
    assert.deepEqual(g.usedDisplay, oldUsed);
    const hand = [...g.state.hand];
    g.key('s'); g.key('j'); g.key('\r');
    assert.deepEqual(g.state.hand, hand);
    until(() => !g.flashing);
    assert.equal(g.dealing, true);
    assert.deepEqual(g.usedDisplay, oldUsed); // Flight has started, nothing has landed.
    until(() => (g.usedDisplay?.length ?? 0) > oldUsed.length || !g.stagedAttack);
    if (cards.length > 1) assert.equal(g.usedDisplay.length, oldUsed.length + 1);
    until(() => !g.stagedAttack);
    assert.deepEqual(g.state.played, [...oldUsed, ...cards]);
    assert.equal(overlays.has(stage), false);
    until(() => !g.dealing);
    dispose(g);
}
// No counterattack still completes the collection and releases input.
const shielded = fixture([c(10, 0)], { enemy: c(11, 1), hp: 20 });
shielded.key('\r'); until(() => !shielded.dealing);
assert.equal(shielded.state.phase, 'attack'); assert.equal(shielded.stagedAttack, null); dispose(shielded);

// Exact, excess and final kills must collect the attack before dissolving the enemy.
for (const [hp, final] of [[10, false], [9, false], [10, true]]) {
    const g = fixture([c(5, 3)], { hp, ...(final ? { castle: [] } : {}) });
    const used = [...g.state.played, g.state.hand[0]];
    g.key('\r'); until(() => g.flashing);
    assert.equal(g.dissolving, false); assert.equal(g.usedDisplay.length, 1);
    until(() => !g.flashing);
    assert.equal(g.dissolving, false); assert.ok(g.stagedAttack);
    until(() => g.dissolving);
    assert.equal(g.stagedAttack, null); assert.deepEqual(g.usedDisplay, used);
    until(() => !g.dealing);
    assert.equal(g.state.phase, final ? 'win' : 'attack');
    assert.equal(g.usedDisplay, null); dispose(g);
}
// Cleanup at departure, recovery, flash and collection suppresses later effects.
for (const phase of ['departure', 'recovery', 'flash', 'collection']) {
    const g = fixture([c(2, 1), c(2, 2)], { discard: [c(7, 0), c(8, 0)] });
    g.key('\r');
    if (phase === 'recovery') until(() => g.recovering);
    if (phase === 'flash' || phase === 'collection') until(() => g.flashing);
    if (phase === 'collection') until(() => !g.flashing);
    dispose(g);
    for (let i = 0; i < 100; i++) step();
    assert.equal(overlays.size, 0); assert.equal(g.stagedAttack, null);
}
// Effect banners show power, not capped counts, and advance only after both gates.
function trackPhases(g) {
    const records = [], original = g.runEffectPhase.bind(g);
    g.runEffectPhase = (text, animate, next) => {
        const record = { text, start: now, attack: g.displayAttack };
        records.push(record);
        original(text, done => animate(() => { record.animationEnd = now; done(); }), () => {
            record.end = now; next();
        });
    };
    return records;
}
const mixed = fixture([c(2, 0), c(2, 1), c(2, 2), c(2, 3)], {
    enemy: c(13, 3), discard: [c(7, 0)], deck: [],
});
const phases = trackPhases(mixed);
mixed.key('\r');
assert.equal(mixed.displayAttack, 20);
until(() => mixed.recovering);
assert.equal(mixed.displayAttack, 20);
until(() => phases.length === 2);
assert.equal(mixed.displayAttack, 20);
until(() => phases.length === 3);
assert.equal(mixed.displayAttack, 12);
until(() => !mixed.dealing);
assert.deepEqual(phases.map(p => p.text), ['♥回收8', '♦抽牌8', '♠減攻8', '傷害8']);
for (let i = 0; i < phases.length; i++) {
    assert.ok(phases[i].end - phases[i].start >= 1000);
    assert.ok(phases[i].end >= phases[i].animationEnd);
    if (i) assert.equal(phases[i].start, phases[i - 1].end);
}
assert.equal(mixed.state.hand.length, 2); // Only one card was recovered/drawn.
dispose(mixed);
for (const [cards, options, expected] of [
    [[c(2, 1)], {}, ['傷害2']], // No discard to recover.
    [[c(2, 2)], { deck: [] }, ['傷害2']],
    [[c(2, 0)], { enemy: c(13, 1), shield: 20 }, ['傷害2']],
    [[c(2, 3)], {}, ['♣倍傷4']],
    [[c(2, 3)], { enemy: c(13, 3) }, ['傷害2']],
    [[c(10, 0)], { enemy: c(11, 1), shield: 5 }, ['♠減攻10', '傷害10']],
]) {
    const g = fixture(cards, options), records = trackPhases(g);
    g.key('\r'); until(() => !g.dealing);
    assert.deepEqual(records.map(p => p.text), expected);
    dispose(g);
}
const long = fixture([c(1, 1), c(13, 0)], {
    discard: Array.from({ length: 21 }, (_, i) => c(2 + i % 9, i % 4)),
});
const longPhases = trackPhases(long);
long.key('\r'); until(() => !long.dealing);
assert.equal(longPhases[0].text, '♥回收21');
assert.ok(longPhases[0].animationEnd - longPhases[0].start > 1000);
assert.equal(longPhases[0].end, longPhases[0].animationEnd);
dispose(long);
// Cancellation during the extra reading-time hold must suppress the next phase.
const waiting = fixture([c(2, 1)], { discard: [c(7, 0)] });
const waitingPhases = trackPhases(waiting);
waiting.key('\r'); until(() => waitingPhases[0]?.animationEnd !== undefined);
assert.ok(waiting.effectPhase); assert.equal(waitingPhases[0].end, undefined);
dispose(waiting);
for (let i = 0; i < 100; i++) step();
assert.equal(waitingPhases.length, 1);
console.log('Regicide effect banners: sequence, power, immunity, attack timing, minimum duration and long animations passed');
setSystem(null);
console.log('Regicide attack staging: positions, effects, counts, kills, gating and cleanup passed');
