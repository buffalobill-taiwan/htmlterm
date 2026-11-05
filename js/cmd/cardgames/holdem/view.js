import { VirtualBuffer, _blankCell } from '../../../util/VirtualBuffer.js';
import { bufWidth } from '../../../util/display-width.js';
import { term } from '../../../system/sys.js';
import { cardBuffer } from '../cards.js';
import { STREETS, potSize } from './rules.js';
import { handName } from './evaluate.js';
export const seatName = (s, id) => id === 0 ? '你' : '電腦 ' + s.players[id].number;
export const DECK = { x: 73, y: 14 };
const RESET = '\x1B[0m';
function deckStackBuffer() {
    const back = cardBuffer(null), vb = new VirtualBuffer(5, 6);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) vb.setCell(r, c, back.getCell(r, c));
    // Cards below the top one show only their bottom border.
    for (let i = 1; i <= 3; i++) for (let c = 0; c < 5; c++) vb.setCell(2 + i, c, back.getCell(2, c));
    return vb;
}
const foldedCards = new WeakMap();
function foldedCardBuffer(base) {
    if (!foldedCards.has(base)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++)
            vb.setCell(y, x, { ...base.getCell(y, x), bg: 8 });
        foldedCards.set(base, vb);
    }
    return foldedCards.get(base);
}
export class HoldemView {
    constructor() {
        this.root = new VirtualBuffer(80, 25);
        this.rows = Array.from({ length: 25 }, () => new VirtualBuffer(80, 1));
        this.text = Array(25).fill(null);
        this.output = new VirtualBuffer(80, 1);
        this.seatRows = Array.from({ length: 4 }, () => new VirtualBuffer(80, 1));
        this.dirty = new Set();
        this.rows.forEach((vb, y) => { const slot = this.root.addChildSlot(); Object.assign(slot, { vb, x: 0, y, active: true }); });
        this.cards = Array.from({ length: 18 }, () => {
            const slot = this.root.addChildSlot(); slot.active = false; return slot;
        });
        // Slot 17 is the deck, which stays put while cards fly out of it.
        Object.assign(this.cards[17], { vb: deckStackBuffer(), x: DECK.x, y: DECK.y, active: true });
        for (let y = 0; y < 25; y++) this.row(y, '');
        term.writeVB(this.root);
    }
    row(y, text) {
        if (this.text[y] === text) return;
        this.text[y] = text;
        for (let x = 0; x < 80; x++) this.rows[y].setCell(0, x, _blankCell);
        this.rows[y].writeStr(0, 0, text);
        this.dirty.add(y);
    }
    centered(y, text) {
        this.row(y, ' '.repeat(Math.max(0, Math.floor((80 - bufWidth(text)) / 2))) + text);
    }
    card(index, card, x, y, active = true, folded = false) {
        const base = cardBuffer(card);
        const slot = this.cards[index], vb = folded ? foldedCardBuffer(base) : base;
        if (slot.vb === vb && slot.active === active && slot.x === x && slot.y === y) return;
        if (slot.active) for (let r = slot.y; r < slot.y + 3; r++) this.dirty.add(r);
        Object.assign(slot, { vb, x, y, active });
        if (active) for (let r = y; r < y + 3; r++) this.dirty.add(r);
    }
    draw(game) {
        const s = game.state, actor = game.effect?.seat ?? s.actor;
        this.centered(0, '\x1B[1;36mTexas Hold’em — 德州撲克' + RESET);
        this.row(1, ` 第 ${s.hand} 手 / ${STREETS[s.street]}                                  小盲 5 / 大盲 10`);
        const lines = this.seatRows;
        for (const row of lines) row.clearCells();
        // Seat text has fixed cell bounds so large stacks never spill into a neighbour.
        for (let id = 1; id < 6; id++) {
            const p = s.players[id], x = 1 + (id - 1) * 16;
            const badge = id === s.button ? ' D' : id === s.sb ? ' SB' : id === s.bb ? ' BB' : '';
            const color = actor === id ? '\x1B[1;33m' : p.folded ? '\x1B[2m' : '\x1B[36m';
            lines[0].writeStr(0, x, color + seatName(s, id) + badge + RESET, x + 15);
            lines[1].writeStr(0, x, '籌碼 ' + p.stack, x + 15);
            lines[2].writeStr(0, x, actor === id && !game.failed && !game.effect && !game.dealing ? '思考中…' : p.action, x + 15);
            // Keep the award hidden until the showdown has revealed every hand.
            lines[3].writeStr(0, x, p.won && !game.showdownRevealing ? '\x1B[32m贏得 ' + p.won + RESET : '投入 ' + p.bet, x + 15);
            // Opponents stay face down until the showdown reaches their seat.
            const shown = s.showdown && !p.folded &&
                (!game.showdownShown || game.showdownShown.has(id));
            for (let n = 0; n < 2; n++) {
                const active = Boolean(p.hole[n] && (!game.dealtHole || game.dealtHole.has(id * 2 + n)));
                this.card((id - 1) * 2 + n, shown ? p.hole[n] : null, x + n * 6 + 1, 5, active, p.folded);
            }
        }
        [3, 4, 8, 9].forEach((y, i) => {
            // Compare cells and retain old immutable rows on unchanged seat updates.
            const cells = lines[i]; let changed = false;
            for (let x = 0; x < 80; x++) {
                const a = this.rows[y].getCell(0, x), b = cells.getCell(0, x) || _blankCell;
                if (a.ch !== b.ch || a.fg !== b.fg || a.bg !== b.bg || a.bold !== b.bold || a.dim !== b.dim || a.width !== b.width) changed = true;
            }
            if (changed) {
                for (let x = 0; x < 80; x++) this.rows[y].setCell(0, x, cells.getCell(0, x) || _blankCell);
                this.dirty.add(y);
            }
        });
        this.row(10, '                         公共牌    底池 ' + potSize(s));
        const deckCount = s.deck ? s.deck.length + (game.dealingHole && game.dealtHole ? (12 - game.dealtHole.size) : 0) : 0;
        this.row(12, ' '.repeat(DECK.x - 1) + '牌堆 ' + deckCount);
        const revealed = game.revealed;
        for (let i = 0; i < 5; i++) this.card(10 + i, s.board[i] || null, 25 + i * 6, 11,
            i < s.board.length && (!revealed || revealed[i]));
        const you = s.players[0], badge = s.button === 0 ? ' [D]' : s.sb === 0 ? ' [SB]' : s.bb === 0 ? ' [BB]' : '';
        this.row(15, '                                  ' + (actor === 0 ? '\x1B[1;33m' : '\x1B[36m') + '你' + badge + RESET);
        const active0 = Boolean(you.hole[0] && (!game.dealtHole || game.dealtHole.has(0)));
        const active1 = Boolean(you.hole[1] && (!game.dealtHole || game.dealtHole.has(1)));
        this.card(15, you.hole[0], 34, 16, active0, you.folded);
        this.card(16, you.hole[1], 40, 16, active1, you.folded);
        this.row(19, `               籌碼 ${you.stack}    本輪投入 ${you.bet}    ${you.action}`);
        this.centered(20, game.status || (s.phase === 'between' ? '準備發下一輪公共牌…' : ''));
        this.centered(21, game.actions.map((a, i) => (i === game.choice ? '\x1B[7m' : '') + ' ' + a.label + ' ' + RESET).join('   '));
        this.row(22, game.effect || game.dealing ? '' : s.phase === 'result' ? '                   Enter 下一手    R 查看結算' : actor === 0 ? '                     ← → 選擇    Enter 確認' : '');
        this.row(23, ' N 遊戲選單                                                  Q / Esc 離開');
        // Recompose only changed rows, including any card slots on those rows.
        for (const y of this.dirty) {
            const row = this.output;
            for (let x = 0; x < 80; x++) row.setCell(0, x, this.rows[y].getCell(0, x));
            for (const slot of this.cards) if (slot.active && y >= slot.y && y < slot.y + slot.vb.height)
                for (let x = 0; x < slot.vb.width; x++)
                    row.setCell(0, slot.x + x, slot.vb.getCell(y - slot.y, x));
            term.writeVB(row, 0, y);
        }
        this.dirty.clear();
    }
}
export function resultText(s) {
    const lines = s.pots.map((pot, i) => `${i ? '邊池 ' + i : '主池'} ${pot.amount}：` +
        pot.awards.map(a => `${seatName(s, a.seat)} +${a.amount}`).join('、') +
        (s.showdown ? '（' + handName(pot.value) + '）' : '（其他玩家棄牌）'));
    for (const refund of s.refunds) lines.push(`${seatName(s, refund.seat)} 退回未被跟注的 ${refund.amount}`);
    return lines.join('\n');
}
