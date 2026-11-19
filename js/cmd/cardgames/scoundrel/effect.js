import { startBufferAnimation } from '../../../system/RAFAnimationHelper.js';
import { bufWidth } from '../../../util/display-width.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';

const EFFECT_MS = 500;
const EFFECT_Y = 16;
const cache = new Map();

function effectBuffer(text) {
    if (cache.has(text)) return cache.get(text);
    const width = Math.max(16, bufWidth(text) + 4);
    const vb = new VirtualBuffer(width, 3);
    const pad = width - 2 - bufWidth(text);
    const left = Math.floor(pad / 2);
    vb.writeStr(0, 0, '\x1B[1;36m┌' + '─'.repeat(width - 2) + '┐\x1B[0m');
    vb.writeStr(1, 0, '\x1B[1;36m│\x1B[0m' + ' '.repeat(left) + text +
        ' '.repeat(pad - left) + '\x1B[1;36m│\x1B[0m');
    vb.writeStr(2, 0, '\x1B[1;36m└' + '─'.repeat(width - 2) + '┘\x1B[0m');
    cache.set(text, vb);
    return vb;
}

// A short-lived bordered box drawn as its own overlay. The caller owns the
// returned cancel function; natural completion invokes `done` once.
export function showEffect(cmd, text, done) {
    const vb = effectBuffer(text);
    const x = Math.floor((80 - vb.width) / 2);
    let start = null, complete = false;
    const manager = startBufferAnimation(cmd,
        (row, col) => vb.getCell(row, col),
        ts => {
            if (start === null) start = ts;
            if (ts - start >= EFFECT_MS) { complete = true; return true; }
            return false;
        }, {
            x, y: EFFECT_Y, w: vb.width, h: 3,
            hideCursor: false, holdBusy: false,
            onCleanup: () => { if (complete) done?.(); },
        });
    return () => manager.stop();
}
