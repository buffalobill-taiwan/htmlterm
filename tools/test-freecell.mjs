import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, verify, applyMove, applyReverseMove, validate, metrics, constructionMetrics } from './freecell-generate.mjs';
const v4Hashes = {
    0: 'b7dfad9f4402f137b020c5e525d3e33c8d8a3a5d20e78e48aab5157e2717a6f0',
    1: '4736ca3e1cbabb40fe6b533e676677a48ebb0043edc783dafa71b7fa9fc20e7e',
    42: '7f77f6f33351d353d072e596e05a453d8d7a01849d5a9c03f68c7ac739c5e566',
    123456: 'd00fbbfbc3063276f2b16e5cc222d8b2412aa83deafff6e2a3997bbe998742d3',
    2147483647: '95a7cae5478225aa036e7c24c696868d06d41c6c2cddf6abfa18f1376b265be3',
};
for (const seed of [0, 1, 42, 123456, 2147483647]) {
    const result = generate(seed);
    assert.equal(result.version, 4);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), v4Hashes[seed]);
    assert.deepEqual(generate(seed), result);
    assert.equal(Object.hasOwn(result, 'candidates'), false);
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
let totalMoves = 0, overflowDeals = 0;
for (let seed = 0; seed < 1000; seed++) {
    const result = generate(seed);
    validate(result.board, true);
    assert.equal(verify(result.board, result.solution), true);
    assert.ok(result.shuffle.transitionChecks <= 100000);
    assert.equal(result.shuffle.effectiveMoves, result.solution.length - 52);
    totalMoves += result.solution.length;
    if (result.shuffle.peakColumnLength > 7) overflowDeals++;
    if (seed < 10) roundTrip(result);
}
// Aggregate mixing regression, not a per-deal difficulty gate or shortest solution claim.
assert.ok(totalMoves / 1000 > 150, 'The reverse walk should retain substantially more moves than v3');
assert.ok(overflowDeals > 0, 'Intermediate columns must be allowed beyond their opening sizes');
console.log(`FreeCell: 1000 verified seeds, mean ${(totalMoves / 1000).toFixed(2)} moves; MS #1 and v3 round trips passed`);

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
const { auto, clone, solved } = await import('../js/cmd/cardgames/freecell/engine.js');
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
