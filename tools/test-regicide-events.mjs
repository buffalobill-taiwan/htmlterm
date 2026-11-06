import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let source = await readFile(new URL('../js/cmd/cardgames/regicide/RegicideGame.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;$/gm, '').replace('export class', 'class');
let timer, visible = 0, completed = 0;
const term = {addOverlay: o => {visible++; assert.equal(o.x, 35); assert.equal(o.y, 10);},
    removeOverlay: () => visible--};
const Game = new Function('VirtualBuffer', 'term', 'buildCallEffectBuffer', 'makeOverlayGetCell',
    'setTimeout', 'clearTimeout', source + '\nreturn RegicideGame;')(
    class {}, term, () => Array.from({length: 4}, () => Array(10).fill({})), () => () => null,
    (fn, ms) => {assert.equal(ms, 800); timer = fn; return 1;}, () => {timer = null;});
const game = new Game({executionGuard: () => () => true, addCleanup: () => () => {}});
game.draw = () => {};
game.showEvent('♥J的攻擊', () => completed++);
assert.equal(game.dealing, true); assert.equal(visible, 1); assert.equal(completed, 0);
timer();
assert.equal(game.dealing, false); assert.equal(visible, 0); assert.equal(completed, 1);
game.showEvent('♥J來襲！', () => completed++);
const stale = timer;
game.dispose();
assert.equal(visible, 0); assert.equal(timer, null);
stale(); assert.equal(completed, 1);
console.log('Regicide event timing and cleanup passed');
