import { RAFAnimationManager } from '../../system/RAFAnimationHelper.js';
import { term } from '../../system/sys.js';
import { cardFlipFrames } from './cards.js';

export function flipCard(cmd, card, x, y, done) {
    const frames = cardFlipFrames(card);
    let progress = 0, start = null, complete = false;
    const active = cmd.executionGuard();
    const manager = new RAFAnimationManager(cmd, { x, y, w: 5, h: 3, hideCursor: false, holdBusy: false });
    manager.initOverlay((r, c) => frames[progress].getCell(r, c));
    const finish = () => {
        if (cmd._cancelFlip !== cancel) return;
        cmd._cancelFlip = null;
        if (complete && active()) done();
    };
    const cancel = () => {
        cmd._cancelFlip = null;
        manager.stop(finish);
    };
    cmd._cancelFlip = cancel;
    manager.start(ts => {
        if (start === null) start = ts;
        const next = Math.min(5, Math.floor((ts - start) / 40));
        if (next !== progress) {
            progress = next;
            for (let r = y; r < y + 3; r++) term.markRowDirty(r);
        }
        if (ts - start >= 240) { complete = true; return true; }
        return false;
    }, finish);
}
