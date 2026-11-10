import { RAFAnimationManager } from '../../../system/RAFAnimationHelper.js';
import { term } from '../../../system/sys.js';
import { markDirtyRows } from '../../../util/drag.js';
import { BACK, BACK_CONT, wallPosition } from './layout.js';

const TABLE_H = 22;
const FLIGHT_MS = 180;
const RECYCLE_MS = 600;
const SHUFFLE_MS = 3000;
const getBackCell = (row, col) => row === 0 ? col === 0 ? BACK : col === 1 ? BACK_CONT : null : null;

export function startTileFlight(cmd, cells, from, to, onComplete, duration = FLIGHT_MS) {
    const manager = new RAFAnimationManager(cmd, {
        x: from.x, y: from.y, w: 2, h: 1, hideCursor: false, holdBusy: false,
    });
    manager.initOverlay((row, col) => row === 0 ? cells[col] ?? null : null);

    let start = null, completed = false, cancelled = false;
    const finish = () => { if (completed && !cancelled) onComplete(); };
    manager.start(ts => {
        if (start === null) start = ts;
        const progress = Math.min(1, (ts - start) / duration);
        const x = Math.round(from.x + (to.x - from.x) * progress);
        const y = Math.round(from.y + (to.y - from.y) * progress);
        if (manager.overlay.x !== x || manager.overlay.y !== y) {
            markDirtyRows(term, manager.overlay.y, 1);
            manager.overlay.x = x;
            manager.overlay.y = y;
            markDirtyRows(term, y, 1);
        }
        if (progress === 1) { completed = true; return true; }
        return false;
    }, finish);

    return () => { cancelled = true; manager.stop(finish); };
}

function wallTarget(index) {
    return wallPosition(index);
}

export function startRecycleAnimation(cmd, pieces, onComplete) {
    return startSwarm(cmd, pieces.map((piece, index) => {
        const target = wallTarget(index);
        return {
            x: piece.from.x, y: piece.from.y,
            fromX: piece.from.x, fromY: piece.from.y,
            toX: target.x, toY: target.y,
        };
    }), RECYCLE_MS, false, onComplete);
}

export function startShuffleAnimation(cmd, onComplete) {
    const positions = Array.from({ length: 32 }, (_, index) => {
        const position = wallTarget(index);
        return {
            x: position.x, y: position.y,
            fromX: position.x, fromY: position.y, toX: position.x, toY: position.y,
        };
    });
    return startSwarm(cmd, positions, SHUFFLE_MS, true, onComplete);
}

function startSwarm(cmd, positions, duration, shuffle, onComplete) {
    const manager = new RAFAnimationManager(cmd, {
        x: positions[0].x, y: positions[0].y, w: 2, h: 1, hideCursor: false, holdBusy: false,
    });
    manager.initOverlay(getBackCell);
    // Keep every wide glyph on its own overlay so overlaps are clipped by Renderer.
    const overlays = positions.map((position, index) => index === 0 ? manager.overlay : ({
        x: position.x, y: position.y, w: 2, h: 1, owner: null, getCell: getBackCell,
    }));

    let start = null, nextHop = 0, completed = false, cancelled = false;
    const finish = () => { if (completed && !cancelled) onComplete(); };
    const cleanup = () => {
        for (let index = 1; index < overlays.length; index++) term.removeOverlay(overlays[index]);
        markDirtyRows(term, 0, TABLE_H);
        finish();
    };
    manager.start(ts => {
        if (start === null) start = ts;
        if (shuffle && ts >= nextHop) {
            for (const position of positions) {
                position.toX = 15 + Math.random() * 21;
                position.toY = 6 + Math.random() * 3;
            }
            nextHop = ts + 90;
        }
        const progress = Math.min(1, (ts - start) / duration);
        for (let index = 0; index < positions.length; index++) {
            const position = positions[index];
            if (shuffle) {
                position.x += (position.toX - position.x) * 0.12;
                position.y += (position.toY - position.y) * 0.12;
            } else {
                position.x = position.fromX + (position.toX - position.fromX) * progress;
                position.y = position.fromY + (position.toY - position.fromY) * progress;
            }
        }
        if (progress === 1) {
            for (let index = 0; index < positions.length; index++) {
                const target = wallTarget(index);
                positions[index].x = target.x;
                positions[index].y = target.y;
                positions[index].toX = target.x;
                positions[index].toY = target.y;
            }
            completed = true;
        }
        for (let index = 0; index < positions.length; index++) {
            overlays[index].x = Math.round(positions[index].x);
            overlays[index].y = Math.round(positions[index].y);
        }
        markDirtyRows(term, 0, TABLE_H);
        return completed;
    }, cleanup);
    for (let index = 1; index < overlays.length; index++) term.addOverlay(overlays[index]);
    markDirtyRows(term, 0, TABLE_H);

    return () => { cancelled = true; manager.stop(cleanup); };
}
