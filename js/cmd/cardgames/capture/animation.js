import { VirtualBuffer, _blankCell } from '../../../util/VirtualBuffer.js';
import { startBufferAnimation } from '../../../system/RAFAnimationHelper.js';
import { term } from '../../../system/sys.js';
import { cardBuffer } from '../cards.js';

const SLIDE_DURATION = 200;

export function slideCards(cmd, moves, area, onComplete, duration = SLIDE_DURATION) {
    if (!moves.length) {
        onComplete();
        return () => {};
    }

    const scratch = new VirtualBuffer(area.w, area.h);
    const markRowDirty = term.markRowDirty;
    let start = null, complete = false, lastProgress = -1;
    const build = progress => {
        if (progress === lastProgress) return;
        lastProgress = progress;
        scratch.clearCells();
        for (const move of moves) {
            const x = Math.round(move.fromX + (move.toX - move.fromX) * (1 - (1 - progress) ** 3));
            const face = cardBuffer(move.card);
            for (let row = 0; row < 3; row++)
                for (let col = 0; col < 5; col++) scratch.setCell(row, x + col, face.getCell(row, col));
        }
        for (let row = 0; row < area.h; row++) markRowDirty(area.y + row);
    };

    build(0);
    const animation = startBufferAnimation(cmd,
        (row, col) => scratch.getCell(row, col) || _blankCell,
        ts => {
            if (start === null) start = ts;
            const progress = Math.min(1, (ts - start) / duration);
            build(progress);
            if (progress >= 1) { complete = true; return true; }
            return false;
        }, {
            x: area.x, y: area.y, w: area.w, h: area.h,
            hideCursor: false, holdBusy: false,
            onCleanup: () => { if (complete) onComplete(); },
        });
    return () => animation.stop();
}
