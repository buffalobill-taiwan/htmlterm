import { RAFAnimationManager } from '../../../system/RAFAnimationHelper.js';
import { term } from '../../../system/sys.js';
import { markDirtyRows } from '../../../util/drag.js';
import { BACK, BACK_CONT, wallPosition } from './layout.js';

const TABLE_H = 22;
const FLIGHT_MS = 180;
const COLLECT_MS = 1000;
const SHUFFLE_MS = 1000;
const SETTLE_MS = 500;
const WALL_MIN_X = 15, WALL_MAX_X = 36, WALL_MIN_Y = 6, WALL_MAX_Y = 9;
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

function randomWallPoint() {
    return {
        x: WALL_MIN_X + Math.random() * (WALL_MAX_X - WALL_MIN_X),
        y: WALL_MIN_Y + Math.random() * (WALL_MAX_Y - WALL_MIN_Y),
    };
}

function isInWall(point) {
    return point.x >= WALL_MIN_X && point.x <= WALL_MAX_X &&
        point.y >= WALL_MIN_Y && point.y <= WALL_MAX_Y;
}

function moveInWall(position) {
    position.x += position.vx;
    position.y += position.vy;
    if (position.x < WALL_MIN_X || position.x > WALL_MAX_X) {
        position.x = Math.max(WALL_MIN_X, Math.min(WALL_MAX_X, position.x));
        position.vx = -position.vx;
    }
    if (position.y < WALL_MIN_Y || position.y > WALL_MAX_Y) {
        position.y = Math.max(WALL_MIN_Y, Math.min(WALL_MAX_Y, position.y));
        position.vy = -position.vy;
    }
}

export function startRoundResetAnimation(cmd, pieces, onPhase, onComplete) {
    const positions = pieces.map((piece, index) => {
        const from = piece.from, collectTo = randomWallPoint(), settled = wallPosition(index);
        const distance = Math.max(Math.abs(collectTo.x - from.x), Math.abs(collectTo.y - from.y));
        const arrived = isInWall(from);
        return {
            x: from.x, y: from.y, fromX: from.x, fromY: from.y,
            collectX: collectTo.x, collectY: collectTo.y,
            collectMs: arrived ? 0 : Math.max(240, distance * 20),
            arrived, vx: (Math.random() - 0.5) * 0.36, vy: (Math.random() - 0.5) * 0.2,
            settleX: from.x, settleY: from.y, settledX: settled.x, settledY: settled.y,
        };
    });
    const manager = new RAFAnimationManager(cmd, {
        x: positions[0].x, y: positions[0].y, w: 2, h: 1, hideCursor: false, holdBusy: false,
    });
    manager.initOverlay(getBackCell);
    // Keep every wide glyph on its own overlay so overlaps are clipped by Renderer.
    const overlays = positions.map((position, index) => index === 0 ? manager.overlay : ({
        x: position.x, y: position.y, w: 2, h: 1, owner: null, getCell: getBackCell,
    }));

    let start = null, phase = 0, nextHop = 0, completed = false, cancelled = false;
    const finish = () => { if (completed && !cancelled) onComplete(); };
    const cleanup = () => {
        for (let index = 1; index < overlays.length; index++) term.removeOverlay(overlays[index]);
        markDirtyRows(term, 0, TABLE_H);
        finish();
    };
    manager.start(ts => {
        if (start === null) start = ts;
        const elapsed = ts - start;
        if (phase === 0 && elapsed >= COLLECT_MS) {
            phase = 1;
            nextHop = ts;
            onPhase('shuffle');
        }
        if (phase === 1 && elapsed >= COLLECT_MS + SHUFFLE_MS) {
            phase = 2;
            for (const position of positions) {
                position.settleX = position.x;
                position.settleY = position.y;
            }
            onPhase('settle');
        }
        if (phase < 2 && ts >= nextHop) {
            const maxX = phase === 0 ? 0.22 : 0.45;
            const maxY = phase === 0 ? 0.12 : 0.22;
            for (const position of positions) {
                position.vx = Math.max(-maxX, Math.min(maxX, position.vx + (Math.random() - 0.5) * maxX));
                position.vy = Math.max(-maxY, Math.min(maxY, position.vy + (Math.random() - 0.5) * maxY));
            }
            nextHop = ts + 180;
        }
        const settleProgress = Math.min(1, Math.max(0, (elapsed - COLLECT_MS - SHUFFLE_MS) / SETTLE_MS));
        for (let index = 0; index < positions.length; index++) {
            const position = positions[index];
            if (phase === 0 && !position.arrived) {
                const progress = Math.min(1, elapsed / position.collectMs);
                position.x = position.fromX + (position.collectX - position.fromX) * progress;
                position.y = position.fromY + (position.collectY - position.fromY) * progress;
                if (progress === 1) position.arrived = true;
            }
            if (position.arrived && phase < 2) {
                moveInWall(position);
            } else if (phase === 2) {
                position.x = position.settleX + (position.settledX - position.settleX) * settleProgress;
                position.y = position.settleY + (position.settledY - position.settleY) * settleProgress;
            }
        }
        if (elapsed >= COLLECT_MS + SHUFFLE_MS + SETTLE_MS) {
            for (let index = 0; index < positions.length; index++) {
                positions[index].x = positions[index].settledX;
                positions[index].y = positions[index].settledY;
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
