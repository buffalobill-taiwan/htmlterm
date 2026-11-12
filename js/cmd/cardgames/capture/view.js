import { term } from '../../../system/sys.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { displayWidth, isWide } from '../../../util/display-width.js';
import { makeCell } from '../../../util/sgr.js';
import { cardBuffer, drawCardStack, stampCard } from '../cards.js';
import { RANKS, SUITS } from '../deck.js';
import { playerCardZones } from './rules.js';

export const CARD_X = [13, 26, 39, 52];
export const ENEMY_DECK = { x: 2, y: 2 };
export const ENEMY_CAPTURE = { x: 72, y: 2 };
export const PERSONAL_DECK = { x: 2, y: 12 };
export const PERSONAL_DISCARD = { x: 72, y: 12 };
export const enemyPosition = index => ({ x: CARD_X[3 - index], y: 4 });
export const handPosition = index => ({ x: CARD_X[index], y: 14 });
export const ACTION_OPTIONS = [
    { action: 'capture', label: '捕獲', description: '出牌捕獲敵同色牌' },
    { action: 'sacrifice', label: '犧牲', description: '犧牲兩張換任一張' },
    { action: 'yield', label: '投降', description: '一張投降敵最右張' },
];
export const ACTION_OPTION_LAYOUT = Object.freeze({
    x: Object.freeze([8, 30, 52]), y: 18, width: 20, height: 4,
});
export const deckBottom = (pile, count) => ({
    x: pile.x,
    y: pile.y + Math.min(3, Math.max(0, count - 1)),
});

const BANNER_SCALE = 2;
const bannerCache = new Map();
const gameOverCache = new Map();
const bannerAttr = {
    fg: 6, bg: 0, bold: true, dim: false, italic: false, underline: false,
    blink: false, inverse: false, conceal: false, crossedOut: false,
};
const gameOverAttr = { ...bannerAttr, fg: 9, bold: true };

function scaledTextBuffer(text, scale, attr, cache) {
    if (cache.has(text)) return cache.get(text);
    let width = 0;
    for (const ch of text) width += (isWide(ch) ? 2 : 1) * scale;
    const vb = new VirtualBuffer(width, scale);
    let x = 0;
    for (const ch of text) {
        const glyphWidth = (isWide(ch) ? 2 : 1) * scale;
        for (let col = 0; col < glyphWidth; col++) {
            for (let row = 0; row < scale; row++) {
                const cell = makeCell(ch, attr, 1);
                cell.clip = true;
                cell.clipScale = scale;
                cell.clipOffX = -col;
                cell.clipOffY = -row;
                vb.setCell(row, x + col, Object.freeze(cell));
            }
        }
        x += glyphWidth;
    }
    cache.set(text, vb);
    return vb;
}

function bannerBuffer(text) {
    return scaledTextBuffer(text, BANNER_SCALE, bannerAttr, bannerCache);
}

function drawActionOptions(vb, selectedIndex, availability, blackout = false) {
    const { x: positions, y, width, height } = ACTION_OPTION_LAYOUT;
    const innerWidth = width - 2;
    for (let index = 0; index < ACTION_OPTIONS.length; index++) {
        const { label, description } = ACTION_OPTIONS[index];
        const x = positions[index];
        if (blackout) {
            for (let row = 0; row < height; row++)
                vb.writeStr(y + row, x, '\x1B[38;5;0;48;5;0m' + ' '.repeat(width) + '\x1B[0m');
            continue;
        }
        const available = availability[ACTION_OPTIONS[index].action];
        const selected = available && index === selectedIndex;
        const style = !available ? '\x1B[38;5;15;48;5;52m' :
            selected ? '\x1B[38;5;15;48;5;24m' : '';
        const reset = style ? '\x1B[0m' : '';
        const center = text => {
            const padding = Math.max(0, innerWidth - displayWidth(text));
            const left = Math.floor(padding / 2);
            return ' '.repeat(left) + text + ' '.repeat(padding - left);
        };
        vb.writeStr(y, x, style + '╔' + '═'.repeat(innerWidth) + '╗' + reset);
        vb.writeStr(y + 1, x, style + '║' + center(label) + '║' + reset);
        vb.writeStr(y + 2, x, style + '║' + center(description) + '║' + reset);
        vb.writeStr(y + 3, x, style + '╚' + '═'.repeat(innerWidth) + '╝' + reset);
    }
}

function drawGameOver(vb) {
    const banner = scaledTextBuffer('GAME OVER', 4, gameOverAttr, gameOverCache);
    drawBuffer(vb, banner, Math.floor((vb.width - banner.width) / 2),
        Math.floor((vb.height - banner.height) / 2) - 2);
}

function drawBuffer(vb, buffer, x, y) {
    for (let row = 0; row < buffer.height; row++)
        for (let col = 0; col < buffer.width; col++)
            vb.setCell(y + row, x + col, buffer.getCell(row, col));
}

function drawVictorySummary(vb, game) {
    const { state, actionCounts } = game;
    vb.centerRow(1, 'Card Capture — 勝利結算');
    vb.writeStr(4, 4, `回合數：${state.round}`);
    vb.writeStr(6, 4,
        `捕獲次數：${actionCounts.captures}　犧牲次數：${actionCounts.sacrifices}　投降次數：${actionCounts.yields}`);
    vb.writeStr(8, 4, '玩家牌組內容（最終去向）');

    const labels = {
        hand: '手牌',
        deck: '抽牌堆',
        discard: '棄牌堆',
        enemyRemoval: '移入敵方移除堆的玩家牌',
    };
    playerCardZones(state).forEach(({ key, cards }, index) => {
        const row = 10 + index * 3;
        const cardsText = cards.map(card =>
            card.rank === 0 ? '小丑' : `${SUITS[card.suit]}${RANKS[card.rank]}`).join('　');
        vb.writeStr(row, 4, `${labels[key]}（${cards.length}）`);
        vb.writeStr(row + 1, 4, cardsText || '無');
    });
    vb.centerRow(22, 'Enter 新局　N 選單　Q/Esc 離開');
}

export function drawBanner(vb, text, x = Math.floor((vb.width - bannerBuffer(text).width) / 2), y = 9) {
    const banner = bannerBuffer(text);
    drawBuffer(vb, banner, x, y);
}

export class CaptureView {
    constructor() {
        this.vb = new VirtualBuffer(80, 24);
    }

    draw(game) {
        const vb = this.vb;
        const state = game.visualState || game.state;
        for (let row = 0; row < vb.height; row++) vb.writeStr(row, 0, ' '.repeat(vb.width));

        if (game.phase === 'winSummary') {
            drawVictorySummary(vb, game);
            term.writeVB(vb);
            return;
        }

        vb.centerRow(0, '\x1B[1;36mCard Capture\x1B[0m');

        this.drawPile(vb, state.enemyDeck.length, ENEMY_DECK.x, ENEMY_DECK.y);
        for (let i = 0; i < state.enemyRow.length; i++) {
            const card = state.enemyRow[i];
            const { x, y } = enemyPosition(i);
            if (card && !game.hiddenRow.has(i)) stampCard(vb, cardBuffer(card), x, y);
            else this.drawEmpty(vb, x, 4);
            if (card && game.phase === 'capture' && game.focus === 'row' &&
                !game.animating && !game.result) {
                const marker = (game.rowCursor === i ? '>' : ' ') + '[ ]';
                vb.writeStr(y + 3, x, marker);
            }
        }
        this.drawPile(vb, state.enemyCapture.length, ENEMY_CAPTURE.x, ENEMY_CAPTURE.y);

        this.drawPile(vb, state.personalDeck.length, PERSONAL_DECK.x, PERSONAL_DECK.y);
        for (let i = 0; i < state.hand.length; i++) {
            const { x, y } = handPosition(i);
            if (!game.hiddenHand.has(i)) stampCard(vb, cardBuffer(state.hand[i]), x, y);
            else this.drawEmpty(vb, x, y);
            const selectingHand = game.phase === 'discard' ||
                (game.phase === 'capture' && game.focus === 'hand');
            if (selectingHand && !game.animating && !game.result) {
                const selected = game.phase === 'discard' ? game.marked.has(i) : game.selection.has(i);
                const marker = (game.handCursor === i ? '>' : ' ') + `[${selected ? 'X' : ' '}]`;
                vb.writeStr(y + 3, x, marker);
            }
        }
        for (let i = state.hand.length; i < 4; i++) {
            const { x, y } = handPosition(i);
            this.drawEmpty(vb, x, y);
        }
        this.drawPile(vb, state.personalDiscard.length, PERSONAL_DISCARD.x, PERSONAL_DISCARD.y);

        if (game.phase === 'actionOptions' || game.phase === 'gameOver')
            drawActionOptions(vb, game.actionCursor, game.actionAvailability);
        else if (game.phase === 'gameOverPrompt')
            drawActionOptions(vb, -1, game.actionAvailability, true);
        vb.writeStr(8, 0, '='.repeat(80));
        vb.writeStr(11, 0, '='.repeat(80));
        if (game.phase === 'gameOverPrompt') vb.writeStr(11, 0, ' '.repeat(80));
        if (game.bannerText) drawBanner(vb, game.bannerText);
        if (game.phase === 'gameOverPrompt') drawGameOver(vb);
        vb.centerRow(22, game.instructions());
        let controls = '←→ 移動　Space 標記牌　Enter 確認　R 重玩　N 選單　Q 離開';
        if (game.phase === 'gameOver') controls = '';
        else if (game.phase === 'gameOverPrompt') controls = 'Enter 新遊戲　N 選單　Q 離開';
        else if (game.phase === 'actionOptions' || game.phase === 'result')
            controls = 'R 重玩　N 選單　Q 離開';
        vb.centerRow(23, controls);
        term.writeVB(vb);
    }

    drawPile(vb, count, x, y) {
        if (count) drawCardStack(vb, cardBuffer(null), x, y, Math.min(3, count - 1));
        else this.drawEmpty(vb, x, y);
    }

    drawEmpty(vb, x, y) {
        vb.writeStr(y, x, '\x1B[90m┌───┐\x1B[0m');
        vb.writeStr(y + 1, x, '\x1B[90m│   │\x1B[0m');
        vb.writeStr(y + 2, x, '\x1B[90m└───┘\x1B[0m');
    }
}
