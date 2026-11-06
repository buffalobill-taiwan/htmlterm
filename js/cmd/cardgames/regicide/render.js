import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { displayWidth } from '../../../util/display-width.js';
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
    roster:   { x: 37, y: 9,  w: 12, h: 4 },
    used:     { x: 51, y: 3,  w: 9,  h: 8 },
    discard:  { x: 61, y: 3,  w: 9,  h: 8 },
    deck:     { x: 71, y: 3,  w: 9,  h: 8 },
    status:   { x: 2,  y: 14, w: 76, h: 1 },
    hand:     { x: 3,  y: 16, w: 69, h: 5 },
    preview:  { x: 2,  y: 21, w: 76, h: 1 },
    controls: { x: 2,  y: 22, w: 76, h: 1 },
};

export const PILE_CARD = { x: 2, y: 2 };
export const HAND_STEP = 9;
export const JESTER_STEP = 7;

export const DECK = { x: LAYOUT.deck.x + PILE_CARD.x, y: LAYOUT.deck.y + PILE_CARD.y };
export const USED = { x: LAYOUT.used.x + PILE_CARD.x, y: LAYOUT.used.y + PILE_CARD.y };
export const DISCARD = { x: LAYOUT.discard.x + PILE_CARD.x, y: LAYOUT.discard.y + PILE_CARD.y };
export const handPosition = index => ({ x: LAYOUT.hand.x + index * HAND_STEP, y: LAYOUT.hand.y });

const SUITS = '♠♥♦♣';
const RANK_LABELS = ['', '', '', '', '', '', '', '', '', '', '', 'J', 'Q', 'K'];
export const enemyName = card => SUITS[card.suit] + RANK_LABELS[card.rank];

const JESTER_CARDS = [{ suit: 0, rank: 0 }, { suit: 1, rank: 0 }];
const ROSTER_RANKS = [11, 12, 13];

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
    const text = 'Regicide 弒君者';
    vb.writeStr(0, vb.width - displayWidth(text), text);
}

function drawEnemy(game) {
    const { vb } = game.areas.enemy;
    vb.clearCells();
    const s = game.state, enemy = game.displayEnemy || s.enemy;
    vb.writeStr(0, 0, '敵人 ' + enemyName(enemy) +
        '   生命 ' + (game.displayHp ?? (game.displayEnemy ? 0 : Math.max(0, s.hp))) +
        '   攻擊 ' + Math.max(0, value(s.enemy) - s.shield));
    vb.writeStr(2, 0, '免疫：' + SUITS[enemy.suit] + '   已擊敗：' + s.defeated + '/12');
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

function drawRoster(game) {
    const { vb } = game.areas.roster;
    vb.clearCells();
    vb.writeStr(0, 0, '剩餘敵人');
    const s = game.state;
    const active = game.displayEnemy || (s.phase === 'win' ? null : s.enemy);
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
    const s = game.state, enemy = game.displayEnemy || s.enemy;
    s.hand.forEach((c, i) => {
        if (game.hidden.has(i)) return;
        const base = cardBuffer(c);
        // Same-suit cards mute the suit glyph; the defence tint waits for effects to finish.
        let face = !game.dealing && enemy && c.suit === enemy.suit ? immuneFace(base) : base;
        if (!game.dealing && s.phase === 'defend') face = defenceFace(face);
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
    const status = game.eventOverlay ? '' : game.flashing ? '攻擊中…' : game.collecting ? '收牌中…' : game.recovering ? '回收中…' : game.dealing ? '發牌中…' : s.phase === 'win' ? ['銅', '銀', '金'][s.jesters] + '牌勝利！Enter 新局' :
        s.phase === 'loss' ? (s.lossReason || '挑戰失敗') + '。Enter 新局' : s.phase === 'attack' ? '選牌攻擊' : '選牌抵傷（不觸發花色能力）';
    const hint = !game.dealing && needsRescue(s) ? '手牌不足，需使用小丑換手：按 Enter 或 J' : '';
    const text = status && hint ? status + '   ' + hint : hint || status;
    if (text) vb.writeStr(0, 0, text);
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
    vb.writeStr(0, 0, '←→ 移動  Space 選牌  Enter 確認  J 小丑  H 規則  N 選單  Q/Esc 離開');
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
