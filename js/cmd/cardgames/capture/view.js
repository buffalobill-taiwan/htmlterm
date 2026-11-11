import { term } from '../../../system/sys.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { cardBuffer, drawCardStack, stampCard } from '../cards.js';

export const CARD_X = [13, 26, 39, 52];
export const ENEMY_DECK = { x: 2, y: 2 };
export const ENEMY_CAPTURE = { x: 72, y: 2 };
export const PERSONAL_DECK = { x: 2, y: 12 };
export const PERSONAL_DISCARD = { x: 72, y: 12 };
export const enemyPosition = index => ({ x: CARD_X[3 - index], y: 4 });
export const handPosition = index => ({ x: CARD_X[index], y: 14 });
export const deckBottom = (pile, count) => ({
    x: pile.x,
    y: pile.y + Math.min(3, Math.max(0, count - 1)),
});

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

        const statusColor = game.result === 'win' ? '\x1B[32m' : game.result === 'loss' ? '\x1B[31m' : '';
        vb.centerRow(19, statusColor + game.status + '\x1B[0m');
        vb.centerRow(21, game.instructions());
        vb.centerRow(23, '←→ 移動　Space 標記牌　Enter 確認　R 重玩　N 選單　Q 離開');
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
