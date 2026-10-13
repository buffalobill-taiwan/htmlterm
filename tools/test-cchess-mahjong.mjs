#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDeck, createRound, isWinning, chiChoices, actor, legalActions, applyAction, publicView, SUPPLY } from '../js/cmd/cchess/mahjong/rules.js';
import { chooseAction } from '../js/cmd/cchess/mahjong/ai.js';
import { mulberry32 } from '../js/util/random.js';

const tiles = kinds => kinds.map((kind, id) => ({ kind, id }));

function fixture(hands, { turn = 0, phase = 'discard', dealer = 0 } = {}) {
    const pool = newDeck(mulberry32(1));
    const take = kind => {
        const i = pool.findIndex(t => t.kind === kind);
        assert.notEqual(i, -1, `fixture exceeds supply for ${kind}`);
        return pool.splice(i, 1)[0];
    };
    const state = createRound();
    state.players = hands.map(hand => ({ hand: hand.map(take), melds: [], discards: [] }));
    state.wall = pool;
    Object.assign(state, { turn, phase, dealer, drawn: null });
    return state;
}

function discard(state, kind) {
    applyAction(state, { type: 'discard', id: state.players[state.turn].hand.find(t => t.kind === kind).id });
}

function conservation(state) {
    const all = [...state.wall, ...state.players.flatMap(p => [...p.hand, ...p.melds.flat(), ...p.discards])];
    assert.equal(all.length, 32);
    assert.equal(new Set(all.map(t => t.id)).size, 32);
    assert.deepEqual(SUPPLY.map((_, k) => all.filter(t => t.kind === k).length), SUPPLY);
    assert.deepEqual(state.discards.map(t => t.id).sort((a,b) => a-b),
        state.players.flatMap(p => p.discards.map(t => t.id)).sort((a,b) => a-b));
}

test('deck, four seats, initial dealer and round snapshots', () => {
    for (let human = 0; human < 4; human++) {
        const state = createRound({ human, deck: newDeck(mulberry32(42)) });
        assert.equal(state.human, human);
        assert.equal(state.dealer, 0);
        assert.equal(state.turn, 0);
        assert.deepEqual(state.players.map(p => p.hand.length), [5, 4, 4, 4]);
        assert.equal(state.wall.length, 15);
        conservation(state);
        const snapshot = structuredClone(state);
        if (legalActions(state)[0].type === 'win') applyAction(state, { type: 'pass' });
        else applyAction(state, legalActions(state)[0]);
        discard(state, state.players[0].hand[0].kind);
        assert.notDeepEqual(state, snapshot);
        conservation(state);
    }
});

test('all sequences, soldiers, mixed king pair and five soldiers', () => {
    for (const hand of [[0,1,2,3,3], [3,4,5,8,8], [7,8,9,4,4], [10,11,12,2,2],
        [6,6,6,0,7], [13,13,13,1,1], [6,6,6,6,6], [13,13,13,13,13]]) {
        assert.ok(isWinning(tiles(hand)), String(hand));
        assert.ok(isWinning(tiles(hand.reverse())), 'order does not matter');
    }
    for (const hand of [[0,1,9,3,3], [3,4,12,8,8], [6,6,13,0,7], [0,1,2,3,10], [1,2,3,6,6], [0,1,2,3]]) {
        assert.equal(isWinning(tiles(hand)), false, String(hand));
    }
    assert.ok(isWinning(tiles([0,7]), [tiles([3,4,5])]));
    assert.equal(isWinning(tiles([0,7]), [tiles([3,4,12])]), false);
    assert.equal(isWinning(tiles([1,1,1]), [tiles([3,4,5])]), false);
});

test('chi only uses a same-color sequence, once per hand', () => {
    const hand = tiles([4,5,1,1]);
    assert.deepEqual(chiChoices(hand, [], { kind: 3 }), [[0,1]]);
    assert.deepEqual(chiChoices(hand, [tiles([7,8,9])], { kind: 3 }), []);
    assert.deepEqual(chiChoices(tiles([6,6,1,1]), [], { kind: 6 }), []);
    assert.deepEqual(chiChoices(hand, [], { kind: 10 }), []);
});

function contested() {
    return fixture([[3,6,9,11,13], [4,5,1,1], [4,5,8,8], [0,2,7,12]]);
}

test('nearest winner gets first refusal; all wins precede chi', () => {
    const state = contested();
    discard(state, 3);
    assert.equal(actor(state), 1);
    assert.equal(legalActions(state)[0].type, 'win');
    applyAction(state, { type: 'pass' });
    assert.equal(actor(state), 2);
    assert.equal(legalActions(state)[0].type, 'win');
    applyAction(state, { type: 'win' });
    assert.equal(state.phase, 'done');
    assert.deepEqual(state.scores, [-1,0,1,0]);
    assert.equal(state.result.nextDealer, 1);
    assert.equal(state.result.source, 0);
    conservation(state);
    assert.throws(() => applyAction(state, { type: 'win' }), /非法/);
});

test('passing all wins allows downstream chi, no draw; one physical copy', () => {
    const state = contested();
    discard(state, 3);
    applyAction(state, { type: 'pass' });
    applyAction(state, { type: 'pass' });
    assert.equal(actor(state), 1);
    assert.equal(legalActions(state)[0].type, 'chi');
    const wall = state.wall.length;
    applyAction(state, legalActions(state)[0]);
    assert.equal(state.phase, 'discard');
    assert.equal(state.turn, 1);
    assert.equal(state.wall.length, wall);
    assert.equal(state.players[0].discards.length, 0);
    assert.equal(state.players[1].hand.length, 2);
    assert.equal(state.players[1].melds.length, 1);
    assert.throws(() => applyAction(state, { type: 'draw' }), /非法/);
    conservation(state);
});

test('other seats cannot chi, illegal discards do not mutate state', () => {
    const state = fixture([[3,6,9,11,13], [0,2,7,12], [4,5,8,1], [2,6,10,13]]);
    const before = structuredClone(state);
    assert.throws(() => applyAction(state, { type: 'discard', id: -1 }), /非法/);
    assert.deepEqual(state, before);
    discard(state, 3);
    assert.equal(state.phase, 'draw');
    assert.equal(state.turn, 1);
});

test('self draw, opening win, dealer retention and score reset on replay', () => {
    const state = fixture([[0,1,2,3,3], [4,5,6,7], [8,9,10,11], [12,13,13,13]], { phase: 'self' });
    const initial = structuredClone(state);
    applyAction(state, { type: 'win' });
    assert.deepEqual(state.scores, [3,-1,-1,-1]);
    assert.equal(state.result.nextDealer, 0);
    const replay = structuredClone(initial);
    applyAction(replay, { type: 'win' });
    assert.deepEqual(replay.scores, state.scores);
    const next = createRound({ dealer: state.result.nextDealer, scores: state.scores, round: 2 });
    assert.deepEqual(next.scores, state.scores);
    assert.equal(next.round, 2);
    conservation(next);
});

test('last discard can win or chi before wall exhaustion becomes a draw', () => {
    const winner = contested(); winner.wall = [];
    discard(winner, 3);
    applyAction(winner, { type: 'win' });
    assert.equal(winner.result.winner, 1);
    const state = contested(); state.wall = [];
    discard(state, 3);
    applyAction(state, { type: 'pass' }); applyAction(state, { type: 'pass' });
    applyAction(state, legalActions(state)[0]);
    discard(state, 1);
    while (state.phase === 'response') applyAction(state, { type: 'pass' });
    assert.equal(state.phase, 'draw');
    applyAction(state, { type: 'draw' });
    assert.equal(state.result.winner, null);
    assert.equal(state.result.nextDealer, 0);
    assert.deepEqual(state.scores, [0,0,0,0]);
});

test('public projection and AI do not depend on hidden opponents or wall order', () => {
    const state = createRound({ deck: newDeck(mulberry32(90)) });
    applyAction(state, { type: 'pass' });
    const view = publicView(state, 0), actions = legalActions(state);
    const original = chooseAction(view, actions, () => 0.2);
    state.wall.reverse();
    [state.players[1].hand, state.players[3].hand] = [state.players[3].hand, state.players[1].hand];
    assert.deepEqual(publicView(state, 0), view);
    assert.equal('wall' in view, false);
    for (const difficulty of ['easy', 'medium', 'hard']) {
        state.difficulty = difficulty;
        assert.deepEqual(chooseAction(publicView(state, 0), actions, () => 0.2), original);
    }
});

test('seeded complete games terminate, conserve tiles and keep scores zero-sum', () => {
    let wins = 0, draws = 0;
    for (let seed = 1; seed <= 100; seed++) {
        const random = mulberry32(seed), state = createRound({ deck: newDeck(random), dealer: seed % 4, human: seed % 4 });
        const discardOrder = [];
        let steps = 0;
        while (state.phase !== 'done') {
            assert.ok(++steps < 150, `game ${seed} did not terminate`);
            const actions = legalActions(state);
            const action = chooseAction(publicView(state, actor(state)), actions, random);
            assert.ok(action);
            if (action.type === 'discard') discardOrder.push(action.id);
            if (action.type === 'chi') discardOrder.pop();
            applyAction(state, action);
            assert.deepEqual(state.discards.map(t => t.id), discardOrder);
            conservation(state);
            for (const player of state.players) assert.ok(player.melds.length <= 1);
        }
        assert.equal(state.scores.reduce((a,b) => a+b), 0);
        state.result.winner === null ? draws++ : wins++;
    }
    assert.ok(wins > 0 && draws > 0);
});
