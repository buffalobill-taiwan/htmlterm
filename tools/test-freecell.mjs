import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const v1Hashes = {
    "0": "50049b9c815db7d820c23561ce7f29503206d23b07b8f3386e2dcbaf37529786",
    "1": "6e31ecdc33fd15dfb9530d0d092f0b01711dd3b82ef109d71b53c2bd6d695c8a",
    "42": "749b4d35a5c513da7ce6762451da9a60742220beaeabac6d955fde67ee630881",
    "123456": "d80fc283716b498f0837ae9432b857d5a10fe499ac3a01f924c604890740c61d",
    "2147483647": "1045c5a4b7f995577e6ee58bb5c53fcad83257df7208622874d12b203f51048e"
};
import { generate, verify, solve, applyMove, validate } from './freecell-solve.mjs';
for (const seed of [0,1,42,123456,2147483647]) {
    const result = generate(seed);
    assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), v1Hashes[seed]);
    validate(result.board, true);
    assert.equal(verify(result.board,result.solution),true);
    assert.deepEqual(generate(seed),result);
    assert.ok(result.metrics.automaticCards <= 8);
    assert.ok(result.metrics.buriedLow >= 24);
    assert.ok(result.metrics.blockers >= 40);
    const search=solve(result.board,1000);
    assert.notEqual(search.status,'unsolvable');
    if(search.solution)verify(result.board,search.solution);
    assert.throws(()=>verify(result.board,result.solution.slice(1)));
    console.log(`seed ${seed}: verified ${result.solution.length} moves, probe ${search.status}`);
}
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
