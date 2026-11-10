#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDeck, createRound, isWinning, chiChoices, actor, legalActions, applyAction, publicView, SUPPLY } from '../js/cmd/cchess/mahjong/rules.js';
import { chooseAction } from '../js/cmd/cchess/mahjong/ai.js';
import { BACK, BACK_CONT, dealOrder, discardPosition, handPosition, tilePositions, wallPosition } from '../js/cmd/cchess/mahjong/layout.js';
import { mahjongRenderMethods } from '../js/cmd/cchess/mahjong/render.js';
import { renderMethods } from '../js/cmd/cchess/render.js';
import { Renderer } from '../js/terminal/Renderer.js';
import { startRoundResetAnimation } from '../js/cmd/cchess/mahjong/animation.js';
import { setSystem } from '../js/system/sys.js';
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

test('mahjong deal queue and animation positions cover every tile', () => {
    const state = createRound({ dealer: 2, human: 1, deck: newDeck(mulberry32(42)) });
    const queue = dealOrder(state);
    assert.equal(queue.length, 17);
    assert.deepEqual(queue.reduce((counts, item) => {
        counts[item.seat]++;
        return counts;
    }, [0,0,0,0]), [4,4,5,4]);
    assert.equal(queue.at(-1).tile.id, state.drawn);
    assert.equal(new Set(queue.map(item => item.tile.id)).size, 17);
    assert.ok(queue.every(item => handPosition(state, item.seat, item.tile.id)));

    const positions = tilePositions(state);
    assert.equal(positions.length, 32);
    assert.equal(new Set(positions.map(item => item.tile.id)).size, 32);
    assert.equal(discardPosition(0).y, 13);
    assert.equal(wallPosition(31).y, 9);
});

test('draws consume the last tile at the wall tail', () => {
    const state = createRound({ deck: newDeck(mulberry32(84)) });
    state.turn = (state.dealer + 1) % 4;
    state.phase = 'draw';
    const wallLength = state.wall.length;
    const last = state.wall[wallLength - 1];
    assert.deepEqual(wallPosition(wallLength - 1), { x: 33, y: 7 });

    applyAction(state, { type: 'draw' });
    assert.equal(state.players[state.turn].hand.at(-1).id, last.id);
    assert.equal(state.wall.length, wallLength - 1);
    assert.ok(!state.wall.some(tile => tile.id === last.id));
});

test('mahjong renderer draws discards in the shifted pool', () => {
    let rendered;
    setSystem({ term: { writeVB: vb => { rendered = vb.render(); } } });
    try {
        const cmd = Object.assign({
            _mahjong: createRound({ deck: newDeck(mulberry32(77)) }),
            _mahjongDifficulty: 'medium',
            _mahjongCursor: 0,
        }, renderMethods, mahjongRenderMethods);
        cmd._initVBs();
        const state = cmd._mahjong;
        applyAction(state, { type: 'pass' });
        const tile = state.players[state.turn].hand[0];
        applyAction(state, { type: 'discard', id: tile.id });
        cmd._renderMahjong();
        assert.equal(rendered[13][15].width, 2);
        cmd._mahjongTransition = { mode: 'pause' };
        cmd._renderMahjong();
        for (let i = 0; i < 32; i++) {
            const position = wallPosition(i);
            assert.equal(rendered[position.y][position.x].width, 2);
        }
    } finally {
        setSystem(null);
    }
});

test('terminal overlay compositor clips overlapping wide mahjong backs', () => {
    assert.equal(BACK.width, 2);
    assert.equal(BACK_CONT.width, 0);
    const cells = [BACK, BACK_CONT];
    const overlays = [10, 11].map(x => ({
        x, y: 0, w: 2, h: 1, getCell: (row, col) => row === 0 ? cells[col] ?? null : null,
    }));
    const renderer = { screen: { overlays }, _blendRow: null };
    const baseRow = Array.from({ length: 80 }, () => ({ ch: ' ', width: 1 }));
    const blended = Renderer.prototype._blendOverlays.call(renderer, 0, baseRow);
    assert.equal(blended[10]._clipRight, true);
    assert.equal(blended[11]._clipRight, true);
    assert.equal(blended[12]._clipLeft, true);
    assert.equal(baseRow[10].width, 1);
});

test('wide overlays preserve the exposed half of static wide glyphs', () => {
    const cells = [BACK, BACK_CONT];
    for (const [overlayX, baseX, clippedX, clippedSide] of [
        [11, 10, 10, '_clipRight'],
        [10, 11, 12, '_clipLeft'],
    ]) {
        const row = Array.from({ length: 80 }, () => ({ ch: ' ', width: 1 }));
        row[baseX] = BACK;
        row[baseX + 1] = BACK_CONT;
        const renderer = {
            screen: { overlays: [{
                x: overlayX, y: 0, w: 2, h: 1,
                getCell: (r, c) => r === 0 ? cells[c] ?? null : null,
            }] },
            _blendRow: null,
        };
        const result = Renderer.prototype._blendOverlays.call(renderer, 0, row);
        assert.equal(result[clippedX][clippedSide], true);
    }
});

test('mahjong round reset collects, shuffles and settles 32 independent tile overlays', () => {
    const rafDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    const random = Math.random;
    const scheduled = new Map(), overlays = [];
    const cleanups = new Set();
    let rafId = 0, timestamp = 0, firstFrameAt = null, completedAt = null, cancel;
    const phases = [], phasePositions = {};
    globalThis.requestAnimationFrame = callback => {
        const id = ++rafId;
        scheduled.set(id, callback);
        return id;
    };
    globalThis.cancelAnimationFrame = id => scheduled.delete(id);
    Math.random = mulberry32(123);
    setSystem({ term: {
        addOverlay: overlay => overlays.push(overlay),
        removeOverlay: overlay => overlays.splice(overlays.indexOf(overlay), 1),
        markRowDirty() {},
    } });
    try {
        const cmd = {
            executionGuard: () => () => true,
            addCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); },
        };
        const state = createRound({ deck: newDeck(mulberry32(91)) });
        cancel = startRoundResetAnimation(cmd, tilePositions(state), mode => {
            phases.push({ mode, at: timestamp });
            phasePositions[mode] = overlays.map(({ x, y }) => [x, y]);
        }, () => { completedAt = timestamp; });
        assert.equal(overlays.length, 32);
        assert.ok(overlays.every(overlay => overlay.w === 2 && overlay.h === 1));
        const overlayRefs = [...overlays];
        for (let frame = 0; scheduled.size && frame < 200; frame++) {
            const [id, callback] = scheduled.entries().next().value;
            scheduled.delete(id);
            callback(timestamp += 16);
            if (firstFrameAt === null) firstFrameAt = timestamp;
        }
        assert.deepEqual(phases.map(({ mode }) => mode), ['shuffle', 'settle']);
        assert.ok(phases[0].at - firstFrameAt >= 1000 && phases[0].at - firstFrameAt < 1020);
        assert.ok(phases[1].at - firstFrameAt >= 2000 && phases[1].at - firstFrameAt < 2020);
        assert.ok(completedAt - firstFrameAt >= 2500 && completedAt - firstFrameAt < 2520);
        assert.ok(phasePositions.shuffle.every(([x, y]) => x >= 15 && x <= 36 && y >= 6 && y <= 9));
        assert.ok(phasePositions.settle.some(([x, y], i) =>
            x !== phasePositions.shuffle[i][0] || y !== phasePositions.shuffle[i][1]));
        assert.ok(overlayRefs.every((overlay, i) => {
            const target = wallPosition(i);
            return overlay.x === target.x && overlay.y === target.y;
        }));
        assert.equal(overlays.length, 0);
    } finally {
        cancel?.();
        setSystem(null);
        Math.random = random;
        if (rafDescriptor) Object.defineProperty(globalThis, 'requestAnimationFrame', rafDescriptor);
        else delete globalThis.requestAnimationFrame;
        if (cancelDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelDescriptor);
        else delete globalThis.cancelAnimationFrame;
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
    assert.equal(tilePositions(state).length, 32);
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
        const positions = tilePositions(state);
        assert.equal(positions.length, 32);
        assert.equal(new Set(positions.map(item => item.tile.id)).size, 32);
        assert.ok(positions.every(({ from }) => from && from.x >= 0 && from.x < 54 && from.y >= 0 && from.y < 22));
        state.result.winner === null ? draws++ : wins++;
    }
    assert.ok(wins > 0 && draws > 0);
});
