import { RAFAnimationManager } from '../../system/RAFAnimationHelper.js';
import { term } from '../../system/sys.js';
import { cardBuffer, cardFlipFrames } from './cards.js';

// Run one deal/fly animation per item, launching the next while the current
// card is still in the air. `start(index, { onStep, onLand })` must pass both
// callbacks to dealCard and return its cancel function. `land` runs before the
// next launch so pile snapshots and targets are up to date; `done` runs once
// every card has landed.
export function staggerFlights(anims, {
    count, isActive = () => true, nextAt = (_step, ratio) => ratio >= 0.45,
    start, land = () => {}, done = () => {},
}) {
    let next = 0, landed = 0;
    const launch = () => {
        if (!isActive() || next >= count) return;
        const index = next++;
        let advanced = false;
        const advance = () => { if (!advanced) { advanced = true; launch(); } };
        let cancel;
        cancel = start(index, {
            onStep: (step, ratio) => { if (nextAt(step, ratio)) advance(); },
            onLand: () => {
                anims.delete(cancel);
                land(index);
                advance();
                if (++landed === count) done();
            },
        });
        anims.add(cancel);
    };
    launch();
}

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

// Deal animation: the card back flies from the deck to its hand slot at
// 20ms per 2-column step, then flips open on arrival. A faceDown card
// (the dealer's hole card) lands unflipped and is revealed in place later.
// The card is pushed into the hand only after this animation lands, so the
// destination stays empty while flying. onStep(step) lets a caller launch
// the next card while this one is still in the air. Returns a cancel function.
export function dealCard(cmd, card, from, to, { faceDown = false, faceUp = false, onStep, duration, flipDuration } = {}, done) {
    const back = cardBuffer(faceUp ? card : null);
    const frames = faceDown || faceUp ? null : cardFlipFrames(card);
    const steps = Math.max(1, Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    const manager = new RAFAnimationManager(cmd, { x: from.x, y: from.y, w: 5, h: 3, hideCursor: false, holdBusy: false });
    const active = cmd.executionGuard();
    let mode = 'fly', step = 0, flipStart = null, progress = 0, start = null;
    let complete = false, cancelled = false;
    manager.initOverlay((r, c) => (mode === 'fly' ? back : frames[progress]).getCell(r, c));
    const dirtyAt = () => {
        for (let r = manager.overlay.y; r < manager.overlay.y + 3; r++) term.markRowDirty(r);
    };
    const finish = () => { if (complete && !cancelled && active()) done(); };
    const cancel = () => { cancelled = true; manager.stop(finish); };
    manager.start(ts => {
        if (start === null) start = ts;
        if (mode === 'fly') {
            const next = duration ?
                Math.min(steps, Math.round(Math.min(1, (ts - start) / duration) * steps)) :
                Math.min(steps, Math.floor((ts - start) / 20) * 2);
            if (next !== step) {
                dirtyAt();
                step = next;
                manager.overlay.x = from.x + Math.round((to.x - from.x) * step / steps);
                manager.overlay.y = from.y + Math.round((to.y - from.y) * step / steps);
                dirtyAt();
                const ratio = duration ? Math.min(1, (ts - start) / duration) : step / steps;
                onStep?.(step, ratio);
            }
            if (step === steps) {
                if (faceDown || faceUp) { complete = true; return true; }
                mode = 'flip';
                flipStart = ts;
                dirtyAt();
            }
        } else {
            const flipMs = flipDuration ?? 240;
            const next = Math.min(5, Math.floor((ts - flipStart) / (flipMs / 6)));
            if (next !== progress) {
                progress = next;
                dirtyAt();
            }
            if (ts - flipStart >= flipMs) { complete = true; return true; }
        }
        return false;
    }, finish);
    return cancel;
}
