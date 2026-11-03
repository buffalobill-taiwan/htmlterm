import { RAFAnimationManager } from '../../../system/RAFAnimationHelper.js';
import { term } from '../../../system/sys.js';
import { stackCardBuffer } from '../cards.js';
import { CURSOR_HIDE, CURSOR_SHOW } from '../../../util/sgr.js';

// Update every 20ms, spreading long flights over at most 15 ticks (300ms).
export function flyCard(cmd, card, from, to, done) {
    const face = stackCardBuffer(card);
    const dx = to.x - from.x, dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const ticks = Math.min(steps, 15);
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
        const elapsedTicks = Math.min(ticks, Math.floor((ts - start) / 20));
        const next = ticks ? Math.floor(steps * elapsedTicks / ticks) : 0;
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

// Win celebration: cards launched from the foundations shoot up-left, then
// fall under gravity and rebound off the floor, leaving a persistent trail of
// card images (afterimages). A card is 5x3; its footprint stays within rows
// 0-20 and cols 0-79 so the status/help rows (21-23) stay readable. The title
// (row 0) is fair game for the celebration trails, giving cards room to jump up.
const WIN_BOUNDS = { minX: 0, maxX: 75, minY: 0, maxY: 18 };
const LAUNCH_X = [40, 49, 58, 67]; // foundation slot x per suit: xAt(i+4) = 4+9*(i+4)
const GRAVITY = 0.35;       // cells/frame^2 downward
const MIN_BOUNCE = 1.4;     // lowest rebound speed (small hop)
const BOUNCE_RANGE = 3.0;   // random extra rebound so bounces vary high/low

// All 52 cards, King first cycling suits — matches the visible top of each
// foundation (King on top) so cards appear to peel off in descending order.
export function launchQueue() {
    const q = [];
    for (let r = 13; r >= 1; r--) for (let s = 0; s < 4; s++) q.push(s * 13 + (r - 1));
    return q;
}

// Gravity + floor bounce. Cards launch up-left, fall, and rebound off the
// floor with a random upward speed so successive bounces vary high and low;
// walls and the ceiling reflect. Mutates card {x,y,vx,vy} in place.
export function stepCard(card, bounds = WIN_BOUNDS) {
    card.vy += GRAVITY;
    card.x += card.vx;
    card.y += card.vy;
    if (card.x < bounds.minX) { card.x = bounds.minX; card.vx = -card.vx; }
    else if (card.x > bounds.maxX) { card.x = bounds.maxX; card.vx = -card.vx; }
    if (card.y < bounds.minY) { card.y = bounds.minY; card.vy = Math.abs(card.vy); }
    else if (card.y > bounds.maxY) {
        card.y = bounds.maxY;
        card.vy = -(MIN_BOUNCE + Math.random() * BOUNCE_RANGE);
    }
}

// Stamp a card face into vb at (x,y); positions are rounded and clamped to vb
// bounds so the bouncing card never writes off-screen. Never clears, so
// successive stamps accumulate as an afterimage trail.
export function blitCard(vb, cardId, x, y) {
    const face = stackCardBuffer(cardId);
    const px = Math.round(x), py = Math.round(y);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
        const yy = py + r, xx = px + c;
        if (yy >= 0 && yy < vb.height && xx >= 0 && xx < vb.width)
            vb.setCell(yy, xx, face.getCell(r, c));
    }
}

// ── Win celebration animation ────────────────────────────────────────────
// Cards launch one-by-one from the foundations and bounce around the play
// area, leaving a persistent trail of card images (afterimages). The loop
// runs until cancelWin() stops it (any key/click from the player).
const WIN_FRAME_MS = 33;    // ~30fps throttle
const WIN_LAUNCH_MS = 110;  // interval between successive launches

// `game` is the FreeCellGame instance (uses .cmd, .vb, .rows, .disposed, .winning).
export function startWinAnimation(game) {
    if (game.winning) return;
    game.winning = true;
    game.winCards = [];
    game.winQueue = launchQueue();
    game.winLaunchAt = 0;
    game.winLast = 0;
    game.winRaf = null;
    game.winRemoveCleanup = game.cmd.addCleanup(() => cancelWin(game));
    term.write(CURSOR_HIDE);
    const launch = ts => {
        if (!game.winQueue.length || ts < game.winLaunchAt) return;
        const card = game.winQueue.shift();
        const s = Math.floor(card / 13);
        const vx = -(1.2 + Math.random() * 1.6), vy = -(1.0 + Math.random() * 1.2);
        game.winCards.push({ card, x: LAUNCH_X[s], y: 2, vx, vy });
        game.winLaunchAt = ts + WIN_LAUNCH_MS;
    };
    const loop = ts => {
        if (!game.winning || game.disposed) return;
        if (ts - game.winLast < WIN_FRAME_MS) { game.winRaf = requestAnimationFrame(loop); return; }
        if (!game.winLast) game.winLaunchAt = ts;
        game.winLast = ts;
        launch(ts);
        const touched = new Set();
        for (const c of game.winCards) {
            stepCard(c);
            blitCard(game.vb, c.card, c.x, c.y);
            const py = Math.round(c.y);
            touched.add(py); touched.add(py + 1); touched.add(py + 2);
        }
        if (game.rows) for (const rr of touched) {
            if (rr < 0 || rr >= 25) continue;
            const row = game.rows[rr];
            for (let c = 0; c < 80; c++) row.setCell(0, c, game.vb.getCell(rr, c));
            term.writeVB(row, 0, rr);
        }
        game.winRaf = requestAnimationFrame(loop);
    };
    game.winRaf = requestAnimationFrame(loop);
}

// Stop the celebration. Idempotent: safe from input handlers, teardown and the
// command cleanup. Restores the cursor but leaves board redrawal to the caller.
export function cancelWin(game) {
    if (game.winRaf) { cancelAnimationFrame(game.winRaf); game.winRaf = null; }
    if (game.winRemoveCleanup) { game.winRemoveCleanup(); game.winRemoveCleanup = null; }
    if (game.winning) term.write(CURSOR_SHOW);
    game.winning = false;
    game.winCards = null;
    game.winQueue = null;
}
