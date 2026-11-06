import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { term } from '../../../system/sys.js';
import { cardBuffer } from '../cards.js';
import { needsRescue, preview, value } from './rules.js';

const BLANK_ROW = ' '.repeat(80);

// Each entry is a self-contained region: its buffer is drawn in local
// coordinates and composited at (x, y) by initView(). Tweak a region by
// changing this table only; keep regions non-overlapping.
export const LAYOUT = {
    title:    { x: 2,  y: 0,  w: 76, h: 1 },
    enemy:    { x: 2,  y: 2,  w: 34, h: 5 },
    jesters:  { x: 37, y: 3,  w: 12, h: 5 },
    used:     { x: 51, y: 3,  w: 9,  h: 8 },
    discard:  { x: 61, y: 3,  w: 9,  h: 8 },
    deck:     { x: 71, y: 3,  w: 9,  h: 8 },
    status:   { x: 2,  y: 8,  w: 49, h: 3 },
    hand:     { x: 3,  y: 12, w: 69, h: 5 },
    preview:  { x: 2,  y: 18, w: 76, h: 1 },
    controls: { x: 2,  y: 20, w: 76, h: 3 },
};

export const PILE_CARD = { x: 2, y: 2 };
export const HAND_STEP = 9;
export const JESTER_STEP = 7;

export const DECK = { x: LAYOUT.deck.x + PILE_CARD.x, y: LAYOUT.deck.y + PILE_CARD.y };
export const USED = { x: LAYOUT.used.x + PILE_CARD.x, y: LAYOUT.used.y + PILE_CARD.y };
export const DISCARD = { x: LAYOUT.discard.x + PILE_CARD.x, y: LAYOUT.discard.y + PILE_CARD.y };
export const handPosition = index => ({ x: LAYOUT.hand.x + index * HAND_STEP, y: LAYOUT.hand.y });

const RANK_LABELS = ['', '', '', '', '', '', '', '', '', '', '', 'J', 'Q', 'K'];
export const enemyName = card => '♠♥♦♣'[card.suit] + RANK_LABELS[card.rank];

const JESTER_CARDS = [{ suit: 0, rank: 0 }, { suit: 1, rank: 0 }];

const defenceFaces = new WeakMap();
function defenceFace(base) {
    if (!defenceFaces.has(base)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++)
            vb.setCell(y, x, { ...base.getCell(y, x), bg: 8 });
        defenceFaces.set(base, vb);
    }
    return defenceFaces.get(base);
}

const immuneFaces = new WeakMap();
function immuneFace(base) {
    if (!immuneFaces.has(base)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++) {
            const cell = base.getCell(y, x);
            const border = y === 0 || y === base.height - 1 || x === 0 || x === base.width - 1;
            vb.setCell(y, x, border ? { ...cell, fg: cell.bg === 8 ? 7 : 8 } : cell);
        }
        immuneFaces.set(base, vb);
    }
    return immuneFaces.get(base);
}

export function initView(game) {
    game.vb = new VirtualBuffer(80, 23);
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
    vb.writeStr(0, 0, 'Regicide 弒君者 — 單人');
}

function drawEnemy(game) {
    const { vb } = game.areas.enemy;
    vb.clearCells();
    const s = game.state, enemy = game.displayEnemy || s.enemy;
    vb.writeStr(0, 0, '敵人 ' + enemyName(enemy) +
        '   生命 ' + (game.displayHp ?? (game.displayEnemy ? 0 : Math.max(0, s.hp))) +
        '   攻擊 ' + Math.max(0, value(s.enemy) - s.shield));
    vb.writeStr(2, 0, '免疫：' + '♠♥♦♣'[enemy.suit] + '   已擊敗：' + s.defeated + '/12');
}

function drawJesters(game) {
    const { vb } = game.areas.jesters;
    vb.clearCells();
    vb.writeStr(0, 0, '小丑');
    for (let i = 0; i < game.state.jesters; i++) {
        const face = cardBuffer(JESTER_CARDS[i]);
        const x = i * JESTER_STEP;
        for (let y = 0; y < 3; y++) for (let k = 0; k < 5; k++)
            vb.setCell(2 + y, x + k, face.getCell(y, k));
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
    const s = game.state, enemy = game.displayEnemy || s.enemy;
    s.hand.forEach((c, i) => {
        if (game.hidden.has(i)) return;
        const base = cardBuffer(c);
        // Rule settlement is synchronous; show defence only after all visual effects finish.
        const styled = !game.dealing && s.phase === 'defend' ? defenceFace(base) : base;
        const face = c.suit === enemy.suit ? immuneFace(styled) : styled;
        const x = i * HAND_STEP;
        for (let y = 0; y < 3; y++) for (let k = 0; k < 5; k++)
            vb.setCell(y, x + k, face.getCell(y, k));
        vb.writeStr(4, x, (i === game.cursor ? '>' : ' ') + (game.selected.has(i) ? '[X]' : '[ ]'));
    });
}

function drawStatus(game) {
    const { vb } = game.areas.status;
    vb.clearCells();
    const s = game.state;
    vb.writeStr(0, 0, game.eventOverlay ? '' : game.flashing ? '攻擊中…' : game.collecting ? '收牌中…' : game.recovering ? '回收中…' : game.dealing ? '發牌中…' : s.phase === 'win' ? ['銅', '銀', '金'][s.jesters] + '牌勝利！Enter 新局' :
        s.phase === 'loss' ? (s.lossReason || '挑戰失敗') + '。Enter 新局' : s.phase === 'attack' ? '選牌攻擊' : '選牌抵傷（不觸發花色能力）');
    if (!game.dealing && needsRescue(s)) vb.writeStr(2, 0, '手牌不足，需使用小丑換手：按 Enter 或 J');
}

function drawPreview(game) {
    const { vb } = game.areas.preview;
    vb.clearCells();
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
    vb.writeStr(0, 0, '←→ 移動  Space 選牌  Enter 確認  J 小丑  H 規則');
    vb.writeStr(2, 0, 'N 選單  Q/Esc 離開');
}

export function draw(game) {
    const root = game.vb;
    for (let r = 0; r < root.height; r++) root.writeStr(r, 0, BLANK_ROW);

    drawTitle(game);
    drawEnemy(game);
    drawJesters(game);

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
