import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, verify, applyMove, applyReverseMove, validate, metrics, difficulty, constructionMetrics } from './freecell-generate.mjs';
import { rank, suit, clone, auto, solved } from '../js/cmd/cardgames/freecell/engine.js';
const v7Hashes = {
    0: 'efbd2bb7a65108e9267fabbd07865e73e0ed44a1e2af1e50cc7ec8b97cba96ae',
    1: '9c55235b0cc315239f73332f375e9db8ef6a1edb56329679a0882ede0f05196a',
    42: '5160e6b638c8614a27a41941e7a29d6f73264c36ce56a01006b2f0c766fe8f86',
    123456: '9f908fb91d43307820b84546054d457a7fddf041fd31eb5e786d43f2cb7dcc13',
    2147483647: '3f6811e4ec658fd9c5468ef5113d5e9c29a17c441935cf9310d089e66fadad60',
};
for (const seed of [0, 1, 42, 123456, 2147483647]) {
    const result = generate(seed);
    assert.equal(result.version, 7);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), v7Hashes[seed]);
    assert.deepEqual(generate(seed), result);
    assert.equal(result.selection.attempts, 16);
    assert.equal(result.selection.valid, 16);
    assert.equal(result.selection.effectiveMoves, result.solution.length - 52);
    assert.ok(result.selection.doubleMiddleColumns >= 1 && result.selection.doubleMiddleColumns <= 3);
    assert.equal(result.selection.doubleMiddleColumns, result.solution.length - 60);
    assert.equal(result.metrics.automaticCards, 0);
    assert.deepEqual(result.construction,
        { parkedCards: 4, releasedCards: 4, earlyEmptyColumns: 0, peakOccupiedCells: 4 });
    assert.throws(() => verify(result.board, result.solution.slice(1)));
}
function fixture(name) {
    const data = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
    const location = i => ({ zone: i < 8 ? 'column' : i < 12 ? 'cell' : 'foundation', index: i < 8 ? i : i < 12 ? i - 8 : i - 12 });
    return { board: data.board, solution: data.moves.map(([from, to]) => ({ from: location(from), to: location(to) })) };
}
function roundTrip({ board, solution }) {
    assert.equal(verify(board, solution), true);
    const replay = structuredClone(board), states = [structuredClone(board)];
    for (const move of solution) {
        applyMove(replay, move);
        states.push(structuredClone(replay));
    }
    for (let i = solution.length - 1; i >= 0; i--) {
        const { from, to } = solution[i];
        applyReverseMove(replay, { from: to, to: from });
        validate(replay);
        assert.deepEqual(replay, states[i], `Reverse step ${solution.length - i} restores its exact predecessor`);
    }
    assert.deepEqual(replay, board);
    return states;
}
const microsoft = fixture('freecell-ms1'), legacy = fixture('freecell-v3');
const msStates = roundTrip(microsoft);
assert.equal(microsoft.solution.length, 161);
assert.equal(Math.max(...msStates.flatMap(s => s.columns.map(col => col.length))), 12);
// Fifth column: reverse free-cell return 6C -> 8H and tableau return 8H -> 4H.
// Neither reverse destination is a legal forward tableau placement.
assert.deepEqual(msStates[0].columns[4], [30, 26, 10, 16, 20, 44]);
roundTrip(legacy);
// The collect-only policy that defeated v5: park Kings, then take any legal
// foundation card. A v7 board must not be solvable this way.
function greedySolves(board) {
    const state = clone(board);
    for (let step = 0; step < 1000; step++) {
        auto(state);
        if (solved(state)) return true;
        let moved = false;
        for (let column = 0; column < 8; column++) {
            const card = state.columns[column].at(-1);
            if (card != null && rank(card) === 13) {
                const cell = state.cells.indexOf(null);
                if (cell >= 0) {
                    applyMove(state, { from: { zone: 'column', index: column }, to: { zone: 'cell', index: cell } });
                    moved = true;
                    break;
                }
            }
        }
        if (moved) continue;
        let collected = false;
        for (const zone of ['column', 'cell']) {
            const count = zone === 'column' ? 8 : 4;
            for (let i = 0; i < count; i++) {
                const card = zone === 'column' ? state.columns[i].at(-1) : state.cells[i];
                if (card == null) continue;
                if (rank(card) === state.foundations[suit(card)] + 1) {
                    applyMove(state, { from: { zone, index: i }, to: { zone: 'foundation', index: suit(card) } });
                    collected = true;
                    break;
                }
            }
            if (collected) break;
        }
        if (collected) continue;
        return false;
    }
    return false;
}
let totalMoves = 0, totalBlockers = 0, totalBuilt = 0, totalHard = 0, totalAuto = 0, totalT = 0;
const bottomPatterns = new Set();
for (let seed = 0; seed < 1000; seed++) {
    const result = generate(seed);
    validate(result.board, true);
    assert.equal(verify(result.board, result.solution), true);
    assert.equal(result.selection.valid, 16);
    assert.equal(result.selection.effectiveMoves, result.solution.length - 52);
    assert.equal(result.selection.peakColumnLength, 7);
    assert.equal(greedySolves(result.board), false, `Seed ${seed} must not be collect-only`);
    const t = result.selection.doubleMiddleColumns;
    assert.ok(t >= 1 && t <= 3);
    assert.equal(result.solution.length, 60 + t, 'Certificate has one extra move per second middle');
    let doubles = 0;
    for (let column = 0; column < 4; column++) {
        const cards = result.board.columns[column];
        assert.equal(cards.length, 7);
        assert.equal(rank(cards[6]), 13);
        const ace = cards.findIndex(card => rank(card) === 1);
        assert.ok(ace === 3 || ace === 4, 'Ace column holds one or two middles above the Ace');
        if (ace === 3) doubles++;
        const base = cards.slice(0, ace);
        assert.deepEqual(base, [...base].sort((a, b) => rank(b) - rank(a) || a - b), 'Base must stay descending');
    }
    assert.equal(doubles, t, 'doubleMiddleColumns must match the board');
    const bottoms = [];
    for (let column = 4; column < 8; column++) {
        const cards = result.board.columns[column];
        assert.equal(cards.length, 6);
        const top = cards.slice(0, 5);
        assert.deepEqual(top, [...top].sort((a, b) => rank(b) - rank(a) || a - b), 'Normal top must stay descending');
        assert.ok(rank(cards[5]) >= 3 && rank(cards[5]) <= 7);
        bottoms.push(rank(cards[5]));
    }
    assert.ok(new Set(bottoms).size > 1, `Seed ${seed} must not repeat the uniform bottom rank`);
    bottomPatterns.add([...bottoms].sort((a, b) => a - b).join(','));
    const shape = difficulty(result.board);
    totalMoves += result.solution.length;
    totalT += t;
    totalBlockers += shape.blockers;
    totalBuilt += shape.builtPairs;
    totalHard += shape.sameSuitHard;
    totalAuto += result.metrics.automaticCards;
    if (seed < 10) roundTrip(result);
}
// The v7 certificate is four king placements, 4+t middle placements, the Ace
// collections, 44 ordinary collections and four king collections.
assert.equal(totalMoves, 60000 + totalT, 'Every v7 deal has the same certificate shape plus its second middles');
assert.equal(totalT, 1999, 't must be uniform across the first 1000 seeds');
assert.ok(bottomPatterns.size >= 30, 'Bottom ranks must vary widely');
assert.equal(totalAuto, 0, 'No v7 opening may expose a safe card');
// Aggregate difficulty regression, not a per-deal quality gate or solver claim.
assert.ok(totalBlockers / 1000 > 42, 'V7 must retain substantial blockers');
assert.ok(totalHard / 1000 > 11.5, 'V7 must retain same-suit inversions');
assert.ok(totalBuilt / 1000 < 7, 'V7 must not expose long easy descending runs');
console.log(`FreeCell: 1000 verified seeds, ${bottomPatterns.size} bottom patterns, mean ${(totalMoves / 1000).toFixed(2)} moves, ${(totalBlockers / 1000).toFixed(1)} blockers, greedy solve rate 0; MS #1 and v3 round trips passed`);

// Equal ranks and gaps of two count in both directions, regardless of suit;
// A/K and gaps of three do not. These partial columns isolate the metric.
assert.equal(metrics({ columns: [[0,13],[1,16],[6,17],[12,26],[8,24],[],[],[]],
    cells: [null,null,null,null], foundations: [0,0,0,0] }).closePairs, 3);
const resourceBoard = { columns: [[2],[1],[13],[16],[],
    Array.from({length:52},(_,i)=>i).filter(c=>![2,1,13,16].includes(c)),[],[]],
    cells: [null,null,null,null], foundations: [0,0,0,0] };
validate(resourceBoard);
const resourceBefore = structuredClone(resourceBoard);
const ref = (zone,index) => ({zone,index});
const transfer = (from,to) => ({from,to});
const resourceMoves = [
    transfer(ref('column',0),ref('cell',0)), transfer(ref('column',1),ref('cell',1)),
    transfer(ref('column',2),ref('foundation',1)), transfer(ref('cell',0),ref('column',3)),
    transfer(ref('column',3),ref('cell',0)), transfer(ref('cell',0),ref('column',3)),
    transfer(ref('cell',1),ref('column',4)),
];
assert.deepEqual(constructionMetrics(resourceBoard,resourceMoves),
    {parkedCards:2,releasedCards:2,earlyEmptyColumns:1,peakOccupiedCells:2});
assert.deepEqual(resourceBoard,resourceBefore, 'Certificate analysis is read-only');
const cli = args => JSON.parse(execFileSync(process.execPath,
    [new URL('./freecell-generate.mjs',import.meta.url).pathname,...args], {encoding:'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
assert.equal(Object.hasOwn(cli(['42','--json']),'search'),false);
for (const flag of ['--candidates', '--search', '--solve', '--nodes']) {
    assert.throws(() => cli(['42', flag, '1']), /Unknown option/);
}
assert.throws(() => cli(['2147483647', '--batch', '2']), /Batch exceeds/);
assert.throws(() => cli(['0', '--batch', '0']), /Invalid --batch/);
const directory = mkdtempSync(join(tmpdir(), 'htmlterm-freecell-'));
try {
    const file = join(directory, 'certificate.json');
    writeFileSync(file, JSON.stringify(legacy));
    assert.deepEqual(cli(['--verify', file]), { verified: true });
    writeFileSync(file, JSON.stringify({ ...legacy, solution: legacy.solution.slice(1) }));
    assert.throws(() => cli(['--verify', file]));
} finally { rmSync(directory, { recursive: true, force: true }); }
const empty=()=>({columns:Array.from({length:8},()=>[]),cells:[null,null,null,null],foundations:[0,0,0,0]});
const move=(a,b)=>({from:{zone:'column',index:a},to:{zone:'column',index:b}});
let s=empty();s.columns[0]=[5];s.columns[1]=[6];assert.throws(()=>applyMove(s,move(0,1)));
s=empty();s.columns[0]=[5];s.columns[1]=[19];applyMove(s,move(0,1));assert.equal(s.columns[1].at(-1),5);
s=empty();s.columns[0]=[1];assert.throws(()=>applyMove(s,{from:{zone:'column',index:0},to:{zone:'foundation',index:0}}));
s=empty();s.columns[0]=[0];applyMove(s,{from:{zone:'column',index:0},to:{zone:'foundation',index:0}});assert.equal(s.foundations[0],1);
for (const seed of [-1, 2147483648, 1.5, NaN, 'bad']) assert.throws(() => generate(seed));
console.log('FreeCell generation, independent replay, rule rejection and determinism passed');

// Reverse rules check the source, not the tableau destination; rejects are atomic.
s=empty(); s.columns[0]=[7,19]; s.columns[1]=[0];
let reverseBefore=structuredClone(s);
applyReverseMove(s,move(0,1)); assert.deepEqual(s.columns[1],[0,19]);
applyMove(s,move(1,0)); assert.deepEqual(s,reverseBefore);
s=empty(); s.columns[0]=[7,6]; reverseBefore=structuredClone(s);
assert.throws(()=>applyReverseMove(s,move(0,1)), /return card/); assert.deepEqual(s,reverseBefore);
s=empty(); s.cells=[0,1,null,null]; reverseBefore=structuredClone(s);
assert.throws(()=>applyReverseMove(s,{from:{zone:'cell',index:0},to:{zone:'cell',index:1}}), /Occupied/);
assert.deepEqual(s,reverseBefore);
assert.throws(()=>applyReverseMove(s,{from:{zone:'foundation',index:0},to:{zone:'column',index:0}}), /Empty/);
assert.throws(()=>applyReverseMove(s,{from:{zone:'cell',index:0},to:{zone:'foundation',index:0}}), /destination/);
assert.throws(()=>applyReverseMove(s,{from:{zone:'column',index:8},to:{zone:'cell',index:0}}), /location/);

// Runtime multi-card rules, transactional errors and conservative foundations.
const { moveCards, selectedCards, capacity } = await import('../js/cmd/cardgames/freecell/rules.js');
const { stackCardBuffer } = await import('../js/cmd/cardgames/cards.js');
const from = { zone:'column', index:0, card:0 }, dest = { zone:'column', index:1 };
s=empty();s.columns=[[7,19,5],[21],[30],[31],[32],[33],[34],[35]];s.cells=[40,41,null,null];
assert.equal(capacity(s,dest),3);
assert.equal(selectedCards(s,from).length,3);
let before=clone(s), next=moveCards(s,from,dest);
assert.deepEqual(s,before);assert.deepEqual(next.columns[1],[21,7,19,5]);
s.cells[2]=42;before=clone(s);assert.throws(()=>moveCards(s,from,dest));assert.deepEqual(s,before);
// Empty destination is not a temporary spare column; emptied source does not count.
s.columns[1]=[];assert.equal(capacity(s,dest),2);assert.throws(()=>moveCards(s,from,dest));
s.columns[2]=[];assert.equal(capacity(s,dest),4);assert.deepEqual(moveCards(s,from,dest).columns[1],[7,19,5]);
assert.throws(()=>moveCards(s,from,{zone:'cell',index:3}));
s.columns[0]=[7,6];assert.equal(selectedCards(s,from).length,0);
assert.throws(()=>moveCards(s,{zone:'foundation',index:0},dest));
s=empty();s.columns[0]=[2];s.foundations=[2,1,2,0];auto(s);assert.deepEqual(s.columns[0],[2]);
s.foundations[1]=2;auto(s);assert.equal(s.foundations[0],3);
s=empty();s.columns[0]=[0];next=moveCards(s,from,{zone:'cell',index:0});
assert.equal(next.cells[0],null);assert.equal(next.foundations[0],1);assert.deepEqual(s.columns[0],[0]);
s={columns:[[12],[],[],[],[],[],[],[]],cells:[null,null,null,null],foundations:[12,13,13,13]};
next=moveCards(s,from,{zone:'foundation',index:0});validate(next);assert.equal(solved(next),true);
for(let id=0;id<52;id++)for(const header of [false,true])for(const style of [0,1,2]){
 const vb=stackCardBuffer(id,header,style);
 assert.equal(vb.width,5);assert.equal(vb.height,header?1:3);
 assert.equal(vb.getCell(0,0).ch,'┌');assert.equal(vb.getCell(0,4).ch,'┐');
 assert.equal(stackCardBuffer(id,header,style),vb);
}
console.log('FreeCell supermove capacity, immutable moves, safe foundations, win and cached stacked cards passed');
