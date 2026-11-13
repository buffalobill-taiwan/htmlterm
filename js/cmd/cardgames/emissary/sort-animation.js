import { VirtualBuffer, _blankCell } from '../../../util/VirtualBuffer.js';
import { term } from '../../../system/sys.js';
import { startBufferAnimation } from '../../../system/RAFAnimationHelper.js';
import { cardBuffer } from '../cards.js';
import { HAND_X, HAND_Y, HAND_STEP, VISIBLE_HAND } from './view.js';

export function sortHandAnimation(game, sortedHand, targetScroll, onComplete) {
    const x = HAND_X, y = HAND_Y, w = VISIBLE_HAND * HAND_STEP - 1;
    const scratch = new VirtualBuffer(w, 7);
    const moves = game.state.hand.map((card, from) => {
        const to = sortedHand.indexOf(card);
        let face = cardBuffer(card);
        return { face, from: (from - game.handScroll) * HAND_STEP, to: (to - targetScroll) * HAND_STEP,
            lane: Math.sign(to - from) * 2, x: -1, y: -1 };
    });
    const markRowDirty = term.markRowDirty;
    let start = null, complete = false;
    const ease = t => 1 - (1 - t) ** 3;
    const build = elapsed => {
        let changed = false;
        for (const move of moves) {
            const nextX = elapsed < 120 ? move.from : elapsed < 360 ?
                Math.round(move.from + (move.to - move.from) * ease((elapsed - 120) / 240)) : move.to;
            const offset = elapsed < 120 ? move.lane * ease(elapsed / 120) : elapsed < 360 ?
                move.lane : move.lane * (1 - ease(Math.min(1, (elapsed - 360) / 120)));
            const nextY = 2 + Math.round(offset);
            if (nextX !== move.x || nextY !== move.y) {
                for (let row = 0; row < 3; row++) {
                    if (move.y >= 0) markRowDirty(y - 2 + move.y + row);
                    markRowDirty(y - 2 + nextY + row);
                }
                changed = true; move.x = nextX; move.y = nextY;
            }
        }
        if (!changed) return;
        scratch.clearCells();
        for (const move of moves)
            for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++)
                if (move.x + col >= 0 && move.x + col < w)
                    scratch.setCell(move.y + row, move.x + col, move.face.getCell(row, col));
    };
    build(0);
    const animation = startBufferAnimation(game.cmd,
        (r, c) => scratch.getCell(r, c) || _blankCell,
        ts => {
            if (start === null) start = ts;
            const elapsed = ts - start;
            build(elapsed);
            if (elapsed >= 480) { complete = true; return true; }
            return false;
        }, {
            x, y: y - 2, w, h: 7, hideCursor: false, holdBusy: false,
            onCleanup: () => { if (complete) onComplete(); },
        });
    return () => animation.stop();
}
