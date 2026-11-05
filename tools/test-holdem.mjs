import assert from 'node:assert/strict';
import { evaluate, handName } from '../js/cmd/cardgames/holdem/evaluate.js';
import { createTable, startHand, act, advanceStreet, legalActions, observation, settle, potSize } from '../js/cmd/cardgames/holdem/rules.js';
import { equity, decide, roundRaise } from '../js/cmd/cardgames/holdem/ai.js';
import { mulberry32 } from '../js/util/random.js';
const cards = text => text.split(' ').map(c => ({ rank: '23456789TJQKA'.indexOf(c[0]) === 12 ? 1 : '23456789TJQKA'.indexOf(c[0]) + 2, suit: 'shdc'.indexOf(c[1]) }));
const ranked = [
    'As Kd 9h 6c 3s', 'As Ad 9h 6c 3s', 'As Ad 9h 9c 3s', 'As Ad Ah 6c 3s',
    'As 2d 3h 4c 5s', 'As Js 9s 6s 3s', 'As Ad Ah 6c 6s', 'As Ad Ah Ac 3s', '9s Ts Js Qs Ks',
];
const values = ranked.map(h => evaluate(cards(h)));
for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
assert.equal(handName(values[8]), '同花順');
assert.ok(evaluate(cards('2s 3h 4d 5c 6s')) > values[4]);
assert.ok(evaluate(cards('As Ad Kh 8c 2s')) > evaluate(cards('Ah Ac Qh Jc Ts')));
assert.equal(evaluate(cards('As Ad Ah Ks Kd Kh 2s')), evaluate(cards('As Ad Ah Ks Kd')));
assert.equal(evaluate(cards('As Ad Ks Kd Qs Qd Jh')), evaluate(cards('As Ad Ks Kd Qs')));
assert.equal(evaluate(cards('2s 3d As Ks Qs Js Ts')), evaluate(cards('As Ks Qs Js Ts')));
assert.equal(evaluate(cards('2s 2d As Kh Qs Jd Tc')), evaluate(cards('3s 3d As Kh Qs Jd Tc')));

const rng = mulberry32(654321);
const table = createTable(rng); startHand(table, rng);
assert.equal(table.actor, (table.bb + 1) % 6);
assert.equal(potSize(table), 15);
for (let i = 0; i < 6; i++) assert.ok(act(table, { type: 'call' }));
assert.equal(table.phase, 'between'); advanceStreet(table);
assert.equal(table.actor, table.sb); assert.equal(table.board.length, 3);
assert.equal(table.burned.length, 1);
for (let i = 0; i < 6; i++) assert.ok(act(table, { type: 'check' }));
assert.equal(table.phase, 'between'); advanceStreet(table);
assert.equal(table.board.length, 4); assert.equal(table.burned.length, 2);
// Rejections are transactional.
let before = JSON.stringify(table);
assert.equal(act(table, { type: 'raise', to: 9 }), false); assert.equal(JSON.stringify(table), before);
assert.ok(act(table, { type: 'raise', to: 10 }));
before = JSON.stringify(table);
assert.equal(act(table, { type: 'check' }), false); assert.equal(JSON.stringify(table), before);

function betting(stacks = [1000, 1000, 1000, 1000, 1000, 1000]) {
    const s = createTable(() => 0); startHand(s, mulberry32(3));
    Object.assign(s, { actor: 0, street: 1, currentBet: 0, lastRaise: 10, board: cards('2s 3h 7d'), phase: 'betting' });
    s.players.forEach((p, i) => Object.assign(p, { stack: stacks[i], bet: 0, total: 0, lastAct: null, folded: false }));
    return s;
}
// Full raise to 100, two short all-ins to 150 and 200: original bettor can raise.
let s = betting([1000, 150, 200, 1000, 1000, 1000]);
assert.ok(act(s, { type: 'raise', to: 100 }));
assert.ok(act(s, { type: 'allin' })); assert.ok(act(s, { type: 'allin' }));
for (let i = 0; i < 3; i++) act(s, { type: 'call' });
assert.equal(s.actor, 0); assert.equal(legalActions(s).raise, true); assert.equal(legalActions(s).min, 300);
// One short all-in does not reopen a previous bettor's raise rights.
s = betting([1000, 150, 1000, 1000, 1000, 1000]);
act(s, { type: 'raise', to: 100 }); act(s, { type: 'allin' });
for (let i = 0; i < 4; i++) act(s, { type: 'call' });
assert.equal(s.actor, 0); assert.equal(legalActions(s).raise, false); assert.equal(legalActions(s).allIn, false);
before = JSON.stringify(s); assert.equal(act(s, { type: 'allin' }), false); assert.equal(JSON.stringify(s), before);
act(s, { type: 'call' }); assert.equal(s.phase, 'between');
// A caller at 150 still cannot raise when later all-ins total only 200.
s = betting([1000, 150, 1000, 200, 1000, 1000]);
act(s, { type: 'raise', to: 100 }); act(s, { type: 'allin' }); act(s, { type: 'call' });
act(s, { type: 'allin' }); act(s, { type: 'call' }); act(s, { type: 'call' }); act(s, { type: 'call' });
assert.equal(s.actor, 2); assert.equal(legalActions(s).raise, false);
// Unacted players can raise after a short all-in; short blind still costs 10 to call.
s = betting([1000, 5, 1000, 1000, 1000, 1000]);
act(s, { type: 'check' }); act(s, { type: 'allin' }); assert.equal(legalActions(s).raise, true);
s = createTable(() => 0); s.players[2].stack = 3; startHand(s, rng);
assert.equal(s.currentBet, 10); assert.equal(legalActions(s).call, 10);

// Multiple side pots, dead folded contributions, and uncalled excess.
s = betting(); s.board = cards('2s 3h 7d 9c Js'); s.button = 5;
const holes = ['As Ad', 'Ks Kd', 'Qs Qd', 'Ts Td', '8s 8d', '6s 6d'];
s.players.forEach((p, i) => Object.assign(p, { hole: cards(holes[i]), total: [100, 200, 300, 400, 50, 50][i], stack: 0, won: 0, folded: i >= 4 }));
settle(s);
assert.deepEqual(s.pots.map(p => p.amount), [300, 200, 300, 200]);
assert.deepEqual(s.players.map(p => p.stack), [500, 300, 200, 100, 0, 0]);
assert.deepEqual(s.refunds, [{ seat: 3, amount: 100 }]);
assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0), 1100);
// Board tie: odd chip goes to the first winning seat left of the button.
s = betting(); s.board = cards('As Ks Qs Js Ts'); s.button = 0;
s.players.forEach((p, i) => Object.assign(p, { total: i < 3 ? 1 : 0, stack: 0, won: 0, folded: i >= 2 }));
settle(s); assert.equal(s.players[1].stack, 2); assert.equal(s.players[0].stack, 1);
// Folds end without revealing cards or dealing the rest of the board.
s = createTable(() => 0); startHand(s, rng);
for (let i = 0; i < 5; i++) act(s, { type: 'fold' });
assert.equal(s.phase, 'result'); assert.equal(s.showdown, false); assert.equal(s.board.length, 0);
assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0), 6000);

// Random legal hands cover round progression, chip conservation and unique cards.
for (let trial = 0; trial < 500; trial++) {
    s = createTable(rng); startHand(s, rng); let steps = 0;
    while (s.phase !== 'result' && steps++ < 300) {
        if (s.phase === 'between') { advanceStreet(s); continue; }
        const l = legalActions(s), roll = rng();
        const action = roll < 0.15 ? { type: 'fold' } : roll < 0.3 && l.allIn ? { type: 'allin' } :
            roll < 0.5 && l.raise && l.max >= l.min ? { type: 'raise', to: l.min } : { type: l.call ? 'call' : 'check' };
        assert.ok(act(s, action));
        if (s.phase !== 'result') assert.equal(s.players.reduce((sum, p) => sum + p.stack + p.total, 0), 6000);
    }
    assert.equal(s.phase, 'result');
    assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0), 6000);
    const all = [...s.deck, ...s.board, ...s.burned, ...s.players.flatMap(p => p.hole)];
    assert.equal(all.length, 52); assert.equal(new Set(all.map(c => c.suit * 13 + c.rank)).size, 52);
}
// Rebuys and button rotation only at hand boundaries.
s.players[1].stack = 0; const button = s.button;
if (!s.players[0].stack) s.players[0].stack = 1000;
assert.ok(startHand(s, rng)); assert.equal(s.button, (button + 1) % 6);
assert.equal(s.players[1].stack + s.players[1].bet, 1000);
assert.equal(startHand(s, rng), false);

// AI gets no hidden cards, deck, burns or opponent hand identities.
s = betting(); const publicView = observation(s);
s.deck.reverse(); s.burned = cards('Ac'); s.players[1].hole = cards('Ks Kh');
assert.deepEqual(observation(s), publicView);
assert.deepEqual(Object.keys(publicView).sort(), ['bet', 'board', 'currentBet', 'hole', 'legal', 'opponents', 'personality', 'pot', 'stack'].sort());
const tie = { ...publicView, hole: cards('2h 3h'), board: cards('As Ks Qs Js Ts'), opponents: 5 };
assert.ok(Math.abs(equity(tie, 100, rng) - 1 / 6) < 1e-12);
assert.equal(equity({ ...tie, hole: cards('As Ks'), board: cards('Qs Js Ts 2h 3h') }, 100, rng), 1);
assert.equal(roundRaise(28, 20, 1000), 30);
assert.equal(roundRaise(23, 20, 1000), 25);
assert.equal(roundRaise(18, 20, 1000), 20);
assert.equal(roundRaise(18, 23, 1000), 25);
assert.equal(roundRaise(80, 20, 43), 43);
assert.equal(roundRaise(36, 36, 38), 38);
assert.equal(roundRaise(50, 60, 40), 40);
for (let i = 0; i < 12; i++) {
    s = createTable(rng); startHand(s, rng);
    const view = observation(s);
    const a = decide(view, mulberry32(i));
    assert.deepEqual(a, decide(view, mulberry32(i)));
    if (a.type === 'raise' && a.to !== view.legal.max) assert.equal(a.to % 5, 0);
    assert.ok(act(s, a));
}
console.log('Hold’em: hand ranks, betting/reopening, pots/refunds, 500 hands, rebuys and AI passed');

// Personalities survive hands and only the rebuying computer gets a new one.
const personalities = createTable(mulberry32(42));
const original = personalities.players.map(p => p.personality);
assert.equal(original[0], undefined);
assert.deepEqual(original, createTable(mulberry32(42)).players.map(p => p.personality));
startHand(personalities, mulberry32(1));
original.forEach((p, i) => assert.equal(personalities.players[i].personality, p));
personalities.phase = 'result';
personalities.players[2].stack = 0;
startHand(personalities, mulberry32(2));
original.forEach((p, i) => {
    if (i === 2) assert.notEqual(personalities.players[i].personality, p);
    else assert.equal(personalities.players[i].personality, p);
});
personalities.actor = 1;
const observed = observation(personalities);
observed.personality.bluff = 99;
assert.notEqual(personalities.players[1].personality.bluff, 99);
// A guaranteed winning hand still follows the personality's aggression.
const winning = { ...tie, hole: cards('As Ks'), board: cards('Qs Js Ts 2h 3h'),
    currentBet: 10, pot: 100, legal: { call: 10, raise: true, min: 20, max: 1000 } };
const passive = { bluff: 0, aggression: 0, tolerance: 0, thresholdOffset: 0, betRatio: 0.5, strongBetRatio: 0.8 };
assert.equal(decide({ ...winning, personality: passive }, mulberry32(1), 10).type, 'call');
assert.equal(decide({ ...winning, personality: { ...passive, aggression: 1 } }, mulberry32(1), 10).type, 'raise');
