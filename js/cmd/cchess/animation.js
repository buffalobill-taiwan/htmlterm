import { BLINK_MS, STEP_MS, BOARD_X, BOARD_Y, BOARD_W, BOARD_H, boardX, boardY } from './constants.js';
import { RAFAnimationManager } from '../../system/RAFAnimationHelper.js';
import { term } from '../../system/sys.js';

// Pure timeline: each frame remains visible for `ms`, then advances.
export function movementFrames(piece, move, blink = true) {
    const { from, to } = move;
    const frames = [];
    for (let i = 0; blink && i < 2; i++) {
        frames.push({ ...from, hidden: true, ms: BLINK_MS });
        frames.push({ ...from, hidden: false, ms: BLINK_MS });
    }
    const dr = to.row - from.row, dc = to.col - from.col;
    if (piece.type === 'chariot' || (piece.type === 'cannon' && !move.captured)) {
        const distance = Math.max(Math.abs(dr), Math.abs(dc));
        for (let step = 1; step <= distance; step++) {
            frames.push({ row: from.row + Math.sign(dr) * step,
                col: from.col + Math.sign(dc) * step, hidden: false, ms: STEP_MS });
        }
    } else if (piece.type === 'horse') {
        frames.push({ row: from.row + (Math.abs(dr) === 2 ? Math.sign(dr) : 0),
            col: from.col + (Math.abs(dc) === 2 ? Math.sign(dc) : 0), hidden: false, ms: STEP_MS });
    } else if (piece.type === 'elephant') {
        frames.push({ row: from.row + dr / 2, col: from.col + dc / 2, hidden: false, ms: STEP_MS });
    }
    // The committed board supplies the final target; no extra landing delay.
    return frames;
}

export function animateMove(cmd, piece, move) {
    const frames = movementFrames(piece, move, piece.color !== cmd._human);
    if (!frames.length) return Promise.resolve(true);
    const vb = cmd._animationVB;
    let index = 0, until = null, previousRow = null, completed = false;
    const originY = boardY(move.from.row), originX = boardX(move.from.col);
    return new Promise(resolve => {
        const manager = new RAFAnimationManager(cmd, {
            x: BOARD_X, y: BOARD_Y, w: BOARD_W, h: BOARD_H,
            hideCursor: false, holdBusy: false, frameDuration: 1,
        });
        manager.initOverlay((row, col) => vb.getCell(row, col));
        const finish = () => {
            vb.clearCells();
            if (cmd._cancelAnimation === cancel) cmd._cancelAnimation = null;
            resolve(completed);
        };
        const cancel = () => manager.stop(finish);
        cmd._cancelAnimation = cancel;
        manager.start(ts => {
            if (until !== null && ts < until) return false;
            if (index === frames.length) { completed = true; return true; }
            const frame = frames[index++];
            vb.clearCells();
            // Mask only the origin with the retained empty-board cells.
            vb.setCell(originY, originX, cmd._gridVB.getCell(originY, originX));
            vb.setCell(originY, originX + 1, cmd._gridVB.getCell(originY, originX + 1));
            const y = boardY(frame.row);
            if (!frame.hidden) cmd._putPiece(vb, y, boardX(frame.col), piece, 3);
            term.markRowDirty(BOARD_Y + originY);
            if (previousRow !== null) term.markRowDirty(BOARD_Y + previousRow);
            term.markRowDirty(BOARD_Y + y);
            previousRow = y;
            until = ts + frame.ms;
            return false;
        }, finish);
    });
}
