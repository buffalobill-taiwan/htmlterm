import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let source = await readFile(new URL('../js/util/flash-helper.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;$/gm, '').replaceAll('export function', 'function');
for (const count of [1, 2, 3]) {
    const timers = new Map(); let id = 0, shown = 0, done = 0, visible = 0;
    const flash = new Function('makeCell', 'markDirtyRows', 'setTimeout', 'clearTimeout',
        source + '\nreturn borderFlash;')(() => ({}), () => {},
        (fn, ms) => { timers.set(++id, {fn, ms}); return id; }, n => timers.delete(n));
    const cmd = {addCleanup: () => () => {}, holdBusy: () => assert.fail(), releaseBusy: () => assert.fail()};
    const term = {cols: 80, rows: 25, addOverlay: () => {shown++; visible++;}, removeOverlay: () => visible--};
    const cancel = flash(cmd, term, count, {holdBusy: false, onComplete: () => done++});
    while (timers.size) {
        const [key, timer] = timers.entries().next().value;
        assert.ok([60, 100].includes(timer.ms));
        timers.delete(key); timer.fn();
    }
    assert.equal(shown, count); assert.equal(done, 1); assert.equal(visible, 0);
    cancel(); assert.equal(done, 1);
    const abort = flash(cmd, term, count, {holdBusy: false, onComplete: () => assert.fail()});
    abort(); assert.equal(timers.size, 0); assert.equal(visible, 0);
}
console.log('Border flash timing and cancellation passed');
