import { VirtualBuffer, _blankCell } from '../../../util/VirtualBuffer.js';
import { displayWidth } from '../../../util/display-width.js';
import { term } from '../../../system/sys.js';
import { overlayFlash } from '../../../util/flash-helper.js';
import { startBufferAnimation } from '../../../system/RAFAnimationHelper.js';
import { makeCell } from '../../../util/sgr.js';
import { cardBuffer } from '../cards.js';
import { needsRescue, preview, value } from './rules.js';

const BLANK_ROW = ' '.repeat(80);

// Each entry is a self-contained region: its buffer is drawn in local
// coordinates and composited at (x, y) by initView(). Tweak a region by
// changing this table only; keep regions non-overlapping.
export const LAYOUT = {
    title:    { x: 29, y: 0,  w: 49, h: 1 },
    enemy:    { x: 9,  y: 1,  w: 20, h: 13 },
    jesters:  { x: 37, y: 3,  w: 12, h: 5 },
    roster:   { x: 37, y: 9,  w: 12, h: 4 },
    used:     { x: 51, y: 3,  w: 9,  h: 8 },
    discard:  { x: 61, y: 3,  w: 9,  h: 8 },
    deck:     { x: 71, y: 3,  w: 9,  h: 8 },
    status:   { x: 2,  y: 16, w: 76, h: 1 },
    hand:     { x: 3,  y: 18, w: 69, h: 4 },
    preview:  { x: 2,  y: 22, w: 76, h: 1 },
    controls: { x: 2,  y: 23, w: 76, h: 1 },
};

export const PILE_CARD = { x: 2, y: 2 };
export const HAND_STEP = 9;
export const JESTER_STEP = 7;

export const DECK = { x: LAYOUT.deck.x + PILE_CARD.x, y: LAYOUT.deck.y + PILE_CARD.y };
export const USED = { x: LAYOUT.used.x + PILE_CARD.x, y: LAYOUT.used.y + PILE_CARD.y };
export const DISCARD = { x: LAYOUT.discard.x + PILE_CARD.x, y: LAYOUT.discard.y + PILE_CARD.y };
// Top-left for a card entering the bottom of the deck: its bottom row lines up
// with the deepest stack edge drawn by drawPile() for that deck size.
export function deckBottom(count) {
    const edges = Math.min(3, Math.max(0, count - 1));
    return { x: DECK.x, y: DECK.y + edges };
}
export const handPosition = index => ({ x: LAYOUT.hand.x + index * HAND_STEP, y: LAYOUT.hand.y });

// Centre the first attack card between the second and third hand slots.
export const attackPosition = index => ({
    x: Math.round((handPosition(1).x + handPosition(2).x) / 2) + index * HAND_STEP,
    y: LAYOUT.hand.y - 4,
});

export function createAttackStage(cmd, cards) {
    const origin = attackPosition(0);
    const vb = new VirtualBuffer((cards.length - 1) * HAND_STEP + 5, 3);
    const faces = cards.map(cardBuffer);
    const overlay = { ...origin, w: vb.width, h: vb.height, owner: cmd,
        getCell: (r, c) => vb.getCell(r, c) };
    let closed = false, removeCleanup;
    const close = () => {
        if (closed) return;
        closed = true;
        term.removeOverlay(overlay);
        removeCleanup?.();
    };
    term.addOverlay(overlay);
    removeCleanup = cmd.addCleanup(close);
    return {
        close,
        setVisible(index, visible) {
            if (closed) return;
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 5; c++)
                    vb.setCell(r, index * HAND_STEP + c, visible ? faces[index].getCell(r, c) : null);
                term.markRowDirty(origin.y + r);
            }
        },
    };
}

// Retained hand cards keep their order but close the gaps left by the cards
// that were played. Return each card's old and new horizontal offsets.
export function handCompaction(oldHand, selected) {
    const moves = [];
    let to = 0;
    for (let from = 0; from < oldHand.length; from++) {
        if (selected.has(from)) continue;
        moves.push({ card: oldHand[from], fromX: from * HAND_STEP, toX: to * HAND_STEP });
        to++;
    }
    return moves;
}

const SUITS = '♠♥♦♣';
const RANK_LABELS = ['', '', '', '', '', '', '', '', '', '', '', 'J', 'Q', 'K'];
export const enemyName = card => SUITS[card.suit] + RANK_LABELS[card.rank];

const JESTER_CARDS = [{ suit: 0, rank: 0 }, { suit: 1, rank: 0 }];
const ROSTER_RANKS = [11, 12, 13];

const greyFaces = new WeakMap();
function greyFace(base) {
    if (!greyFaces.has(base)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++)
            vb.setCell(y, x, { ...base.getCell(y, x), bg: 8 });
        greyFaces.set(base, vb);
    }
    return greyFaces.get(base);
}

// Same-suit hand cards: the suit glyph becomes dim white instead of black/red.
const DIM_WHITE = 250;
const immuneFaces = new WeakMap();
function immuneFace(base) {
    if (!immuneFaces.has(base)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++)
            vb.setCell(y, x, base.getCell(y, x));
        // The suit glyph sits in the middle row right after the left border.
        vb.setCell(1, 1, { ...base.getCell(1, 1), fg: DIM_WHITE });
        immuneFaces.set(base, vb);
    }
    return immuneFaces.get(base);
}

export function initView(game) {
    game.vb = new VirtualBuffer(80, 24);
    game.areas = {};
    for (const [name, rect] of Object.entries(LAYOUT)) {
        const vb = new VirtualBuffer(rect.w, rect.h);
        const slot = game.vb.addChildSlot();
        slot.vb = vb;
        slot.x = rect.x;
        slot.y = rect.y;
        slot.active = true;
        game.areas[name] = { vb, slot };
    }
}

function drawTitle(game) {
    const { vb } = game.areas.title;
    vb.clearCells();
    const text = 'Regicide 弒君者';
    vb.writeStr(0, vb.width - displayWidth(text), text);
}

const enemyFaces = new WeakMap();
function enemyView(card) {
    const base = cardBuffer(card);
    if (!enemyFaces.has(base)) {
        const scale = card.rank - 9;
        const vb = new VirtualBuffer(base.width * scale, base.height * scale);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
            const cell = base.getCell(y, x);
            // Expand wide glyphs from their lead cell, skipping the continuation.
            if (!cell || cell.width === 0) continue;
            for (let r = 0; r < scale; r++) for (let c = 0; c < cell.width * scale; c++) {
                vb.setCell(y * scale + r, x * scale + c, {
                    ...cell, width: 1, clip: true, clipScale: scale,
                    clipOffX: -c, clipOffY: -r,
                });
            }
        }
        enemyFaces.set(base, {
            face: vb,
            x: Math.floor((LAYOUT.enemy.w - vb.width) / 2),
            // Reserve the last row of the enemy region for health and attack.
            y: Math.floor((LAYOUT.enemy.h - 1 - vb.height) / 2),
        });
    }
    return enemyFaces.get(base);
}

// Top-left of a 1x (5x3) card centered on the enemy's scaled face.
export function enemyCardOrigin(card) {
    const { face, x: offsetX, y: offsetY } = enemyView(card);
    const base = cardBuffer(card);
    return {
        x: LAYOUT.enemy.x + offsetX + Math.floor((face.width - base.width) / 2),
        y: LAYOUT.enemy.y + offsetY + Math.floor((face.height - base.height) / 2),
    };
}

const hitFaces = new WeakMap();
const BLACK_CELL = makeCell(' ', 0, 0, false);

export function dissolveEnemy(game, onComplete) {
    const { face, x: offsetX, y: offsetY } = enemyView(game.displayEnemy || game.state.enemy);
    const count = face.width * face.height;
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    const cells = Array(count).fill(null);
    const screen = term.screen;
    const started = performance.now();
    let filled = 0, complete = false;
    const animation = startBufferAnimation(game.cmd,
        (y, x) => cells[y * face.width + x], ts => {
            const target = Math.min(count, Math.floor((ts - started) * count / 1500));
            while (filled < target) {
                const index = order[filled++];
                cells[index] = BLACK_CELL;
                screen.markRowDirty(LAYOUT.enemy.y + offsetY + Math.floor(index / face.width));
            }
            if (filled === count) {
                complete = true;
                return true;
            }
            return false;
        }, {
            x: LAYOUT.enemy.x + offsetX, y: LAYOUT.enemy.y + offsetY, w: face.width, h: face.height,
            hideCursor: false, holdBusy: false,
            onCleanup: () => { if (complete) onComplete(); },
        });
    return () => animation.stop();
}

// Enemy arrival: slide the scaled face down from above the enemy region, one
// row per step, until it reaches its centred position.
export function walkInEnemy(game, onComplete) {
    const { face, x: offsetX, y: targetY } = enemyView(game.displayEnemy || game.state.enemy);
    const startY = -face.height;
    const stepMs = 50;
    let currentY = startY, start = null, complete = false;
    const mark = (from, to) => {
        const top = Math.max(0, from), bottom = Math.min(LAYOUT.enemy.h - 1, to);
        for (let r = top; r <= bottom; r++) term.markRowDirty(LAYOUT.enemy.y + r);
    };
    const animation = startBufferAnimation(game.cmd,
        (r, c) => {
            const y = r - currentY, x = c - offsetX;
            return y >= 0 && y < face.height && x >= 0 && x < face.width ? face.getCell(y, x) : null;
        }, ts => {
            if (start === null) start = ts;
            const next = Math.min(targetY, startY + Math.floor((ts - start) / stepMs));
            if (next !== currentY) {
                mark(Math.min(currentY, next), Math.max(currentY, next) + face.height - 1);
                currentY = next;
            }
            if (currentY === targetY) { complete = true; return true; }
            return false;
        }, {
            x: LAYOUT.enemy.x, y: LAYOUT.enemy.y, w: LAYOUT.enemy.w, h: LAYOUT.enemy.h,
            hideCursor: false, holdBusy: false,
            onCleanup: () => { if (complete) onComplete(); },
        });
    return () => animation.stop();
}

export function flashEnemy(game, count, onComplete) {
    const { face, x: offsetX, y: offsetY } = enemyView(game.displayEnemy || game.state.enemy);
    if (!hitFaces.has(face)) {
        const vb = new VirtualBuffer(face.width, face.height);
        for (let y = 0; y < face.height; y++) for (let x = 0; x < face.width; x++)
            vb.setCell(y, x, { ...face.getCell(y, x), bg: 52 });
        hitFaces.set(face, vb);
    }
    const hit = hitFaces.get(face);
    const overlay = {
        x: LAYOUT.enemy.x + offsetX, y: LAYOUT.enemy.y + offsetY, w: hit.width, h: hit.height,
        owner: game.cmd, getCell: (y, x) => hit.getCell(y, x),
    };
    return overlayFlash(game.cmd, term, overlay, count, { holdBusy: false, onComplete });
}

const HAND_SLIDE_MS = 180;
// Slide the retained hand cards left into their compacted slots. The overlay
// covers the whole hand region so the pre-compaction layout underneath is
// hidden while the cards move.
export function slideHand(game, moves, onComplete) {
    const scratch = new VirtualBuffer(LAYOUT.hand.w, LAYOUT.hand.h);
    let start = null, complete = false, lastKey = null;
    const build = progress => {
        const xs = moves.map(m => Math.round(m.fromX + (m.toX - m.fromX) * progress));
        const key = xs.join(',');
        if (key === lastKey) return;
        lastKey = key;
        scratch.clearCells();
        moves.forEach((move, i) => {
            const face = cardBuffer(move.card);
            for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++)
                scratch.setCell(y, xs[i] + x, face.getCell(y, x));
        });
        for (let r = 0; r < LAYOUT.hand.h; r++) term.markRowDirty(LAYOUT.hand.y + r);
    };
    // Seed the scratch buffer before the overlay is added, so the first
    // composited frame already shows the cards at their old positions.
    build(0);
    const animation = startBufferAnimation(game.cmd,
        (r, c) => scratch.getCell(r, c) || _blankCell,
        ts => {
            if (start === null) start = ts;
            const t = Math.min(1, (ts - start) / HAND_SLIDE_MS);
            build(1 - (1 - t) ** 3);
            if (t >= 1) { complete = true; return true; }
            return false;
        }, {
            x: LAYOUT.hand.x, y: LAYOUT.hand.y, w: LAYOUT.hand.w, h: LAYOUT.hand.h,
            hideCursor: false, holdBusy: false,
            onCleanup: () => { if (complete) onComplete(); },
        });
    return () => animation.stop();
}

// Sorting uses two lanes around the original hand row. All cards share
// phase boundaries; cards that keep their slot remain on the baseline.
export function sortHandAnimation(game, sortedHand, onComplete) {
    const { x, y, w } = LAYOUT.hand;
    const scratch = new VirtualBuffer(w, 7);
    const enemy = game.displayEnemy || game.state.enemy;
    const moves = game.state.hand.map((card, from) => {
        const to = sortedHand.indexOf(card);
        let face = cardBuffer(card);
        if (enemy && card.suit === enemy.suit) face = immuneFace(face);
        if (game.state.phase === 'defend') face = greyFace(face);
        return { face, from: from * HAND_STEP, to: to * HAND_STEP,
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

function drawEnemy(game) {
    const { vb } = game.areas.enemy;
    vb.clearCells();
    // Once the dissolve finishes the whole enemy region is emptied, stats included.
    if (game.enemyCleared) return;
    const s = game.state, enemy = game.displayEnemy || s.enemy;
    const { face, x: offsetX, y: offsetY } = enemyView(enemy);
    for (let y = 0; y < face.height; y++) for (let x = 0; x < face.width; x++)
        vb.setCell(y + offsetY, x + offsetX, face.getCell(y, x));
    vb.centerRow(offsetY + face.height, '生命' + (game.displayHp ?? (game.displayEnemy ? 0 : Math.max(0, s.hp))) +
        '  攻擊' + (game.displayAttack ?? Math.max(0, value(s.enemy) - s.shield)));
}

function drawJesters(game) {
    const { vb } = game.areas.jesters;
    vb.clearCells();
    vb.writeStr(0, 0, '小丑');
    // Used jesters stay visible on a grey background instead of disappearing.
    JESTER_CARDS.forEach((card, i) => {
        const base = cardBuffer(card);
        const face = i < game.state.jesters ? base : greyFace(base);
        const x = i * JESTER_STEP;
        for (let y = 0; y < 3; y++) for (let k = 0; k < 5; k++)
            vb.setCell(2 + y, x + k, face.getCell(y, k));
    });
}

function drawRoster(game) {
    const { vb } = game.areas.roster;
    vb.clearCells();
    vb.writeStr(0, 0, '剩餘敵人');
    const s = game.state;
    // While a defeated enemy is being cleared the next one is not highlighted yet.
    const active = game.rosterHold ? null : (game.displayEnemy || (s.phase === 'win' ? null : s.enemy));
    // Enemies still in the castle or currently faced are not defeated.
    const remaining = new Set();
    if (s.phase !== 'win') {
        if (s.enemy) remaining.add(s.enemy.suit * 13 + s.enemy.rank);
        for (const card of s.castle) remaining.add(card.suit * 13 + card.rank);
    }
    for (let r = 0; r < ROSTER_RANKS.length; r++) {
        const rank = ROSTER_RANKS[r];
        for (let suit = 0; suit < 4; suit++) {
            const text = SUITS[suit] + RANK_LABELS[rank];
            const isActive = active && active.suit === suit && active.rank === rank;
            const defeated = !remaining.has(suit * 13 + rank);
            const style = isActive ? '\x1B[30;42m' : defeated ? '\x1B[90m' : '';
            vb.writeStr(1 + r, suit * 3, style ? style + text + '\x1B[0m' : text);
        }
    }
}

function drawPile(game, name, label, count, face) {
    const { vb } = game.areas[name];
    vb.clearCells();
    vb.writeStr(0, 0, label);
    if (!count) { vb.writeStr(3, PILE_CARD.x, '[空]'); return; }
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++)
        vb.setCell(PILE_CARD.y + y, PILE_CARD.x + x, face.getCell(y, x));
    for (let i = 1; i <= Math.min(3, count - 1); i++)
        for (let x = 0; x < 5; x++)
            vb.setCell(PILE_CARD.y + 2 + i, PILE_CARD.x + x, face.getCell(2, x));
}

function drawHand(game) {
    const { vb } = game.areas.hand;
    vb.clearCells();
    if (game.sorting) return;
    const s = game.state, enemy = game.displayEnemy || s.enemy;
    // While cards are flying to the discard pile the override keeps every
    // other card in its old slot, leaving the played cards' gaps visible.
    const hand = game.handOverride || s.hand;
    hand.forEach((c, i) => {
        if (!c || game.hidden.has(i)) return;
        const base = cardBuffer(c);
        // Same-suit cards mute the suit glyph; the defence tint waits for effects to finish.
        let face = !game.dealing && enemy && c.suit === enemy.suit ? immuneFace(base) : base;
        if (!game.dealing && s.phase === 'defend') face = greyFace(face);
        const x = i * HAND_STEP;
        for (let y = 0; y < 3; y++) for (let k = 0; k < 5; k++)
            vb.setCell(y, x + k, face.getCell(y, k));
        if (!game.discarding && !game.stagedAttack)
            vb.writeStr(3, x, (i === game.cursor ? '>' : ' ') + (game.selected.has(i) ? '[X]' : '[ ]'));
    });
}

function drawStatus(game) {
    const { vb } = game.areas.status;
    vb.clearCells();
    if (game.sorting || game.stagedAttack) return;
    const s = game.state;
    const status = game.eventOverlay || game.bannerOverlay || game.arriving ? '' : game.dissolving ? '敵人被擊倒…' : game.flashing ? '攻擊中…' : game.collecting ? '收牌中…' : game.recovering ? '回收中…' : game.discardText ? game.discardText : game.dealing ? '發牌中…' : s.phase === 'win' ? ['銅', '銀', '金'][s.jesters] + '牌勝利！Enter 新局' :
        s.phase === 'loss' ? (s.lossReason || '挑戰失敗') + '。Enter 新局' : s.phase === 'attack' ? '選牌攻擊' : '選牌抵傷';
    const hint = !game.dealing && needsRescue(s) ? '手牌不足，需使用小丑換手：按 Enter 或 J' : '';
    const text = status && hint ? status + '   ' + hint : hint || status;
    if (text) vb.writeStr(0, 0, text);
}

function drawPreview(game) {
    const { vb } = game.areas.preview;
    vb.clearCells();
    if (game.sorting) return;
    const s = game.state;
    const p = preview(s, [...game.selected]);
    if (!p) return;
    vb.writeStr(0, 0, (p.legal ? '可確認' : '選牌無效') + '   總值 ' + p.total +
        (s.phase === 'attack' ? '   傷害 ' + p.damage + '   反擊 ' + (p.damage >= s.hp ? 0 : p.incoming) +
            '   效果 ' + [...p.suits].map(i => '♠♥♦♣'[i]).join('') :
            '   尚欠 ' + Math.max(0, value(s.enemy) - s.shield - p.total)));
}

function drawControls(game) {
    const { vb } = game.areas.controls;
    vb.clearCells();
    vb.writeStr(0, 0, '←→ 移動  Space 選牌  Enter 確認  S 排序  J 小丑  H 規則  N 選單  Q/Esc 離開');
}

export function draw(game) {
    const root = game.vb;
    for (let r = 0; r < root.height; r++) root.writeStr(r, 0, BLANK_ROW);

    drawTitle(game);
    drawEnemy(game);
    drawJesters(game);
    drawRoster(game);

    const s = game.state;
    const used = game.usedDisplay || s.played;
    const discardCount = game.presentation?.discardCount ?? s.discard.length;
    const deckCount = game.presentation ?
        game.presentation.deckCount - ((game.recovering || game.collecting) ? 0 : game.dealTotal - game.pending) :
        s.deck.length + game.pending;

    drawPile(game, 'used', '已用 ' + used.length, used.length,
        used.length ? cardBuffer(game.collecting ? used[0] : used.at(-1)) : null);
    drawPile(game, 'discard', '棄牌 ' + discardCount, discardCount,
        discardCount ? cardBuffer(game.recovering ? null : (game.presentation ? game.presentation.discardTop : s.discard.at(-1))) : null);
    drawPile(game, 'deck', '牌堆 ' + deckCount, deckCount, deckCount ? cardBuffer(null) : null);
    drawHand(game);
    drawStatus(game);
    drawPreview(game);
    drawControls(game);

    term.writeVB(root);
}
