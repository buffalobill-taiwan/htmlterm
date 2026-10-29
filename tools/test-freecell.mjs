import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const v2Hashes = {
    "0": "c68092ac47f7e8c49e723217c66a125d78f9e86b0bb4cd01e2edbfc7c5bff0dd",
    "1": "81572fd5856cbb81b74ca8449d8819d8daa1e0a8e3bc7bcabdb42fb6680ab41f",
    "42": "fdaab5018a718e0b810a049cc16d8ab4f5a9a82b3baeb4e5a976c89ee5f4d476",
    "123456": "479dc7c4202d43a49c88c72d43492b4d71974dc4d54b634e7bc963dca63c1d06",
    "2147483647": "0997c02b2184a731b4a78fb85b97d6b74abfed9eedca783a26862241f4df76c6"
};
import { generate, verify, solve, applyMove, validate, metrics } from './freecell-solve.mjs';
for (const seed of [0,1,42,123456,2147483647]) {
    const result = generate(seed);
    assert.equal(result.version, 2);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), v2Hashes[seed]);
    validate(result.board, true);
    assert.equal(verify(result.board,result.solution),true);
    assert.deepEqual(generate(seed),result);
    assert.ok(result.metrics.automaticCards <= 8);
    assert.ok(result.metrics.buriedLow >= 24);
    assert.ok(result.metrics.blockers >= 40);
    assert.ok(result.metrics.closePairs <= 22);
    const search=solve(result.board,1000);
    assert.notEqual(search.status,'unsolvable');
    if(search.solution)verify(result.board,search.solution);
    assert.throws(()=>verify(result.board,result.solution.slice(1)));
    console.log(`seed ${seed}: verified ${result.solution.length} moves, probe ${search.status}`);
}
// Pin v2 output across both ends of the public candidate-count range.
for (const [seed, count, hash] of [
    [1, 1, 'bff69d3e72418b3a891c280da10688b6fa58ee8a4fd2636a964eac7a77f36e34'],
    [0, 8, '3b697cb975db9352e773d521b9236ea6fe599950682a7e54f29a80fce37503a0'],
    [0, 128, 'b0c9ce32930136b08d7a9df7a80b37089e8e92400c55d022aeaa97ac75fa6cbe'],
    [42, 4096, 'c09ff3e762f293509edb61f68b499de3b85eda3a8380b4507222aad6b9699bed'],
]) {
    const result = generate(seed, count);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), hash);
    assert.equal(verify(result.board, result.solution), true);
}
assert.throws(() => generate(2147483647, 1), /No candidate passed/);
assert.throws(() => generate(0, 1), /No candidate passed/);
// Count proximity independently of the generator metric. v1 averaged 30.49
// close pairs over these seeds; guard against returning to layered rank bands.
let closeTotal = 0, gapTotal = 0;
for (let seed = 0; seed < 100; seed++) {
    const result = generate(seed);
    let close = 0;
    for (const col of result.board.columns) for (let i = 1; i < col.length; i++) {
        const gap = Math.abs(col[i] % 13 - col[i - 1] % 13);
        if (gap <= 2) close++;
        gapTotal += gap;
    }
    assert.equal(result.metrics.closePairs, close);
    assert.ok(close <= 22);
    assert.equal(verify(result.board, result.solution), true);
    closeTotal += close;
}
assert.ok(closeTotal / 100 < 18, 'Nearby ranks should not dominate the board');
assert.ok(gapTotal / 4400 > 3, 'Adjacent ranks should span a wider range');
// Equal ranks and gaps of two count in both directions, regardless of suit;
// A/K and gaps of three do not. These partial columns isolate the metric.
assert.equal(metrics({ columns: [[0,13],[1,16],[6,17],[12,26],[8,24],[],[],[]],
    cells: [null,null,null,null], foundations: [0,0,0,0] }).closePairs, 3);
console.log(`FreeCell rank distribution: ${(closeTotal / 100).toFixed(2)} close pairs per deal`);
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
