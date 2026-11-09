import assert from 'node:assert/strict';
import { RegicideGame } from '../js/cmd/cardgames/regicide/RegicideGame.js';
import { createGame, jester } from '../js/cmd/cardgames/regicide/rules.js';
let now = 0;
const original = globalThis.performance;
globalThis.performance = { now: () => now };
const fixture = () => Object.assign(Object.create(RegicideGame.prototype), {
    state: createGame(), draw() {}, stopDeals() {}, dealNewCards() {},
});
const press = (g, times) => times.forEach((time, i) => { now = time; g.key(i % 2 ? 'c' : 'C'); });
try {
    for (const remaining of [0, 1]) {
        const g = fixture(); g.state.jesters = remaining;
        press(g, [0, 250, 500, 750, 1000]);
        assert.equal(g.state.cheatMode, true);
        assert.equal(g.state.jesters, 2);
        for (let i = 0; i < 3; i++) assert.equal(jester(g.state), true);
        assert.equal(g.state.jesters, 2);
        assert.equal(g.state.stats.jesterUses, 3);
        press(g, [1100, 1200, 1300, 1400, 1500]);
        assert.equal(g.state.cheatMode, true);
        g.start();
        assert.equal(g.state.cheatMode, false);
        assert.deepEqual(g.cheatKeys, []);
        assert.equal(g.state.stats.jesterUses, 0);
    }
    const slow = fixture();
    press(slow, [0, 250, 500, 750, 1001]);
    assert.equal(slow.state.cheatMode, false);
    slow.key('x');
    press(slow, [1100, 1200, 1300, 1400]);
    assert.equal(slow.state.cheatMode, false);
    for (const blocked of [{dealing: true}, {sorting: true}, {dialog: {}}]) {
        const g = Object.assign(fixture(), blocked);
        press(g, [0, 1, 2, 3, 4]);
        assert.equal(g.state.cheatMode, false);
    }
    for (const phase of ['win', 'loss']) {
        const g = fixture(); g.state.phase = phase;
        press(g, [0, 1, 2, 3, 4]);
        assert.equal(g.state.cheatMode, false);
    }
    const normal = createGame();
    jester(normal);
    assert.equal(normal.jesters, 1);
    assert.equal(normal.stats.jesterUses, 1);
} finally { globalThis.performance = original; }
console.log('Regicide cheat activation, gating, reset and usage passed');
