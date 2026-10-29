import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const v3Hashes = {
    "0": "857cf0a24694e6e7d48a59d07ae1c0bc2184d4210b8ccd711ce1dadae8f78890",
    "1": "1179cfa77bb779210b84524cf5ecb6c4bffd83db0f127d2c34058042f811d1bb",
    "42": "009caeeb7243c90794d5e7a261044ef1f8c02d165f0bdd80a65d2ebb1b46a4f7",
    "123456": "a7cd3c443789545aa2956344c4ab6c51cb72cada279bdd1587a6274eebde1972",
    "2147483647": "a58f3eba688e7a4c6cda07249942827ae61b7209a22c36aea9e365e139cc2f4d"
};
import { generate, verify, applyMove, validate, metrics, constructionMetrics } from './freecell-solve.mjs';
for (const seed of [0,1,42,123456,2147483647]) {
    const result = generate(seed);
    assert.equal(result.version, 3);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), v3Hashes[seed]);
    validate(result.board, true);
    assert.equal(verify(result.board,result.solution),true);
    assert.deepEqual(generate(seed),result);
    assert.ok(result.metrics.automaticCards <= 8);
    assert.ok(result.metrics.buriedLow >= 24);
    assert.ok(result.metrics.blockers >= 40);
    assert.throws(()=>verify(result.board,result.solution.slice(1)));
    console.log(`seed ${seed}: verified ${result.solution.length} reverse moves`);
}
// Pin v3 output across both ends of the public candidate-count range.
for (const [seed, count, hash] of [
    [0, 1, '6dc251f46415e3b060c9758a499352f6d51624738b8908993080b8268e1c7342'],
    [0, 8, '46a0194b13ca66718e526cfbefd9d6bc69e2cf6bce918d2d068a282ec66c873b'],
    [0, 128, '53e35b687fa08b6efb5bb4e23cab4e5cba65e1189f7d23465675fdda3f693f91'],
    [42, 4096, 'dc4623aabffde2ffe0bf46a380ef26412d2f4b6cc9098fefbe25c929ac0e66c1'],
]) {
    const result = generate(seed, count);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), hash);
    assert.equal(verify(result.board, result.solution), true);
}
assert.throws(() => generate(13, 1), /No candidate passed/);
// Distribution and certificate-resource regression checks, not human difficulty.
let closeTotal = 0, spanTotal = 0, parkedTotal = 0, peakTotal = 0;
for (let seed = 0; seed < 100; seed++) {
    const result = generate(seed);
    let close = 0, span = 0;
    for (const col of result.board.columns) {
        const ranks = col.map(c => c % 13);
        span += Math.max(...ranks) - Math.min(...ranks);
    }
    for (const col of result.board.columns) for (let i = 1; i < col.length; i++) {
        const gap = Math.abs(col[i] % 13 - col[i - 1] % 13);
        if (gap <= 2) close++;
    }
    assert.equal(result.metrics.closePairs, close);
    assert.equal(result.metrics.rankSpan, span);
    assert.equal(verify(result.board, result.solution), true);
    // Independently count distinct blocked cards and peak reserve occupancy.
    const replay = structuredClone(result.board), parked = new Set();
    let peak = 0;
    for (const move of result.solution) {
        if (move.to.zone === 'cell') {
            const c = replay.columns[move.from.index].at(-1);
            if (c % 13 > replay.foundations[Math.floor(c / 13)]) parked.add(c);
        }
        applyMove(replay, move);
        peak = Math.max(peak, 4 - replay.cells.filter(c => c === null).length);
    }
    assert.equal(result.construction.parkedCards, parked.size);
    assert.equal(result.construction.peakOccupiedCells, peak);
    spanTotal += span; parkedTotal += parked.size; peakTotal += peak;
    closeTotal += close;
}
assert.ok(closeTotal / 100 < 22, 'Nearby ranks should not dominate the board');
assert.ok(spanTotal / 800 > 7.5, 'Columns should not concentrate in narrow rank bands');
assert.ok(parkedTotal / 100 > 12, 'Certificates should park unresolved blockers');
assert.ok(peakTotal / 100 >= 3.5, 'Certificates should use the four reserves together');
// Equal ranks and gaps of two count in both directions, regardless of suit;
// A/K and gaps of three do not. These partial columns isolate the metric.
assert.equal(metrics({ columns: [[0,13],[1,16],[6,17],[12,26],[8,24],[],[],[]],
    cells: [null,null,null,null], foundations: [0,0,0,0] }).closePairs, 3);
console.log(`FreeCell rank distribution: ${(closeTotal / 100).toFixed(2)} close pairs per deal`);
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
    [new URL('./freecell-solve.mjs',import.meta.url).pathname,...args], {encoding:'utf8'}));
assert.equal(Object.hasOwn(cli(['42','--json']),'search'),false);
assert.equal(cli(['42','--json','--search','--nodes','1']).search.status,'unknown');
const empty=()=>({columns:Array.from({length:8},()=>[]),cells:[null,null,null,null],foundations:[0,0,0,0]});
const move=(a,b)=>({from:{zone:'column',index:a},to:{zone:'column',index:b}});
let s=empty();s.columns[0]=[5];s.columns[1]=[6];assert.throws(()=>applyMove(s,move(0,1)));
s=empty();s.columns[0]=[5];s.columns[1]=[19];applyMove(s,move(0,1));assert.equal(s.columns[1].at(-1),5);
s=empty();s.columns[0]=[1];assert.throws(()=>applyMove(s,{from:{zone:'column',index:0},to:{zone:'foundation',index:0}}));
s=empty();s.columns[0]=[0];applyMove(s,{from:{zone:'column',index:0},to:{zone:'foundation',index:0}});assert.equal(s.foundations[0],1);
assert.throws(()=>generate(-1));assert.throws(()=>generate(0,0));
console.log('FreeCell generation, independent replay, rule rejection and determinism passed');

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
