import { RAFAnimationManager } from '../../../system/RAFAnimationHelper.js';
import { term } from '../../../system/sys.js';
import { stackCardBuffer } from '../cards.js';

// One terminal-grid step per 20ms along a straight, eight-direction path.
export function flyCard(cmd, card, from, to, done) {
    const face = stackCardBuffer(card);
    const dx = to.x - from.x, dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const manager = new RAFAnimationManager(cmd, {
        x: from.x, y: from.y, w: 5, h: 3, hideCursor: false, holdBusy: false,
    });
    manager.initOverlay((r, c) => face.getCell(r, c));
    const active = cmd.executionGuard();
    let start = null, progress = 0, complete = false, cancelled = false;
    const dirty = () => {
        for (let r = manager.overlay.y; r < manager.overlay.y + 3; r++) term.markRowDirty(r);
    };
    const finish = () => { if (complete && !cancelled && active()) done(); };
    manager.start(ts => {
        if (start === null) start = ts;
        const next = Math.min(steps, Math.floor((ts - start) / 20));
        if (next !== progress) {
            dirty();
            progress = next;
            manager.overlay.x = from.x + Math.round(dx * next / steps);
            manager.overlay.y = from.y + Math.round(dy * next / steps);
            dirty();
        }
        if (next === steps) { complete = true; return true; }
        return false;
    }, finish);
    return () => { cancelled = true; manager.stop(finish); };
}
