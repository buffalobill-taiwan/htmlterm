import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/cmd/cardgames/regicide/rules.js', import.meta.url), 'utf8');
const {createGame, preview, play, jester} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const c = (rank, suit) => ({rank, suit});
const s = createGame(() => 0.5);
assert.equal(s.hand.length, 8);
assert.equal(s.deck.length, 32);
assert.equal(s.castle.length, 11);
s.enemy = c(11, 1); s.hp = 20; s.hand = [c(5, 3), c(5, 2)];
assert.equal(preview(s, [0, 1]).damage, 20);
assert.equal(play(s, [0, 1]), true);
assert.equal(s.defeated, 1);
assert.equal(s.deck[0].rank, 11);
assert.equal(s.phase, 'attack');
s.hand = [c(6, 0), c(6, 2)];
assert.equal(play(s, [0, 1]), false);
s.hand = [c(1, 0), c(13, 2)];
assert.equal(preview(s, [0, 1]).total, 21);
s.phase = 'defend'; s.enemy = c(11, 2); s.shield = 0;
s.hand = [c(10, 1)];
assert.equal(play(s, [0]), true);
assert.equal(s.phase, 'attack');
assert.equal(jester(s), true);
assert.equal(s.jesters, 1);
assert.equal(s.hand.length, 8);
s.phase = 'defend'; s.jesters = 0; s.hand = [c(2, 0)];
assert.equal(play(s, [0]), false);
console.log('Regicide rules passed');

// Insufficient defence must either offer a Jester or end the game.
for (const [jesters, deck, expected] of [
    [0, [c(10, 0)], 'loss'],
    [1, [], 'loss'],
    [1, [c(10, 0)], 'defend'],
]) {
    const game = createGame(() => 0.5);
    Object.assign(game, {enemy: c(11, 1), hp: 20, hand: [c(2, 1), c(2, 2)], jesters, deck});
    assert.equal(play(game, [0]), true);
    assert.equal(game.phase, expected);
    if (expected === 'loss') assert.equal(game.lossReason, '手牌點數不足以抵傷');
    else {
        assert.equal(jester(game), true);
        assert.equal(play(game, [0]), true);
    }
}
const rescue = createGame(() => 0.5);
Object.assign(rescue, {enemy: c(11, 1), hp: 20, hand: [c(2, 1)], jesters: 1, deck: [c(1, 0)]});
play(rescue, [0]);
assert.equal(rescue.phase, 'defend');
jester(rescue);
assert.equal(rescue.phase, 'loss');
const healing = createGame(() => 0.5);
Object.assign(healing, {enemy: c(11, 0), hp: 20, hand: [c(2, 1), c(2, 2)],
    discard: [c(10, 3), c(10, 2)], deck: []});
const effects = [];
assert.equal(play(healing, [0, 1], effects), true);
assert.deepEqual(effects.map(e => e.type), ['recover', 'draw', 'attack']);
assert.equal(effects[0].count, 2);
assert.equal(effects[0].deckCount, 2);
assert.equal(healing.hand.length, 2);
assert.equal(healing.deck.length, 0);
