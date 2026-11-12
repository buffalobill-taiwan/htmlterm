import { term } from '../../../system/sys.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { displayWidth, isWide } from '../../../util/display-width.js';
import { makeCell } from '../../../util/sgr.js';
import { cardBuffer, drawCardStack, stampCard } from '../cards.js';

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
const ACTION_OPTION_X = [8, 30, 52];
const ACTION_OPTION_Y = 18;
const ACTION_OPTION_WIDTH = 20;
export const deckBottom = (pile, count) => ({
    x: pile.x,
    y: pile.y + Math.min(3, Math.max(0, count - 1)),
});

const BANNER_SCALE = 2;
const bannerCache = new Map();
const bannerAttr = {
    fg: 6, bg: 0, bold: true, dim: false, italic: false, underline: false,
    blink: false, inverse: false, conceal: false, crossedOut: false,
};

function bannerBuffer(text) {
    if (bannerCache.has(text)) return bannerCache.get(text);
    let width = 0;
    for (const ch of text) width += (isWide(ch) ? 2 : 1) * BANNER_SCALE;
    const vb = new VirtualBuffer(width, BANNER_SCALE);
    let x = 0;
    for (const ch of text) {
        const glyphWidth = (isWide(ch) ? 2 : 1) * BANNER_SCALE;
        for (let col = 0; col < glyphWidth; col++) {
            for (let row = 0; row < BANNER_SCALE; row++) {
                const cell = makeCell(ch, bannerAttr, 1);
                cell.clip = true;
                cell.clipScale = BANNER_SCALE;
                cell.clipOffX = -col;
                cell.clipOffY = -row;
                vb.setCell(row, x + col, Object.freeze(cell));
            }
        }
        x += glyphWidth;
    }
    bannerCache.set(text, vb);
    return vb;
}

function drawActionOptions(vb, selectedIndex) {
    const innerWidth = ACTION_OPTION_WIDTH - 2;
    for (let index = 0; index < ACTION_OPTIONS.length; index++) {
        const { label, description } = ACTION_OPTIONS[index];
        const x = ACTION_OPTION_X[index];
        const selected = index === selectedIndex;
        const style = selected ? '\x1B[38;5;15;48;5;24m' : '';
        const reset = selected ? '\x1B[0m' : '';
        const center = text => {
            const padding = Math.max(0, innerWidth - displayWidth(text));
            const left = Math.floor(padding / 2);
            return ' '.repeat(left) + text + ' '.repeat(padding - left);
        };
        vb.writeStr(ACTION_OPTION_Y, x, style + '╔' + '═'.repeat(innerWidth) + '╗' + reset);
        vb.writeStr(ACTION_OPTION_Y + 1, x, style + '║' + center(label) + '║' + reset);
        vb.writeStr(ACTION_OPTION_Y + 2, x, style + '║' + center(description) + '║' + reset);
        vb.writeStr(ACTION_OPTION_Y + 3, x, style + '╚' + '═'.repeat(innerWidth) + '╝' + reset);
    }
}

export function drawBanner(vb, text, x = Math.floor((vb.width - bannerBuffer(text).width) / 2), y = 9) {
    const banner = bannerBuffer(text);
    for (let row = 0; row < banner.height; row++)
        for (let col = 0; col < banner.width; col++)
            vb.setCell(y + row, x + col, banner.getCell(row, col));
}

export class CaptureView {
    constructor() {
        this.vb = new VirtualBuffer(80, 24);
    }

    draw(game) {
        const vb = this.vb;
        const state = game.visualState || game.state;
        for (let row = 0; row < vb.height; row++) vb.writeStr(row, 0, ' '.repeat(vb.width));

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

        if (game.phase === 'actionOptions') drawActionOptions(vb, game.actionCursor);
        vb.writeStr(8, 0, '='.repeat(80));
        vb.writeStr(11, 0, '='.repeat(80));
        if (game.bannerText) drawBanner(vb, game.bannerText);
        vb.centerRow(22, game.instructions());
        const controls = game.phase === 'actionOptions' || game.phase === 'result'
            ? 'R 重玩　N 選單　Q 離開'
            : '←→ 移動　Space 標記牌　Enter 確認　R 重玩　N 選單　Q 離開';
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
