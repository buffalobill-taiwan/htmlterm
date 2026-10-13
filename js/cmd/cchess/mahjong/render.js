import { _blankCell } from '../../../util/VirtualBuffer.js';
import { bold, cyan, yellow, fg, makeCell } from '../../../util/sgr.js';
import { bufWidth } from '../../../util/display-width.js';
import { wrapDialogText } from '../../../dialog/text.js';
import { term } from '../../../system/sys.js';
import { WINDS, actor } from './rules.js';

const BACK = makeCell('⬤', 10, 0, false, 2);
const BACK_CONT = makeCell(' ', 10, 0, false, 0);
const TABLE_W = 54, SEAT_W = 24, INFO_X = 56, INFO_W = 24;
const HAND_X = 4, DRAWN_X = 13;
const DISCARD_X = 15, DISCARD_Y = 11, DISCARD_COLS = 8;
const WALL_Y = 6;
const DIVIDER = makeCell('│', 244, 0, false, 1);
const POSITIONS = [
    { x: 28, y: 17, label: '玩家' }, { x: 28, y: 2, label: '下家' },
    { x: 2, y: 2, label: '對家' }, { x: 2, y: 17, label: '上家' },
];

function clip(text, width) {
    let result = '', used = 0;
    for (const ch of text) {
        const size = bufWidth(ch);
        if (used + size > width) break;
        result += ch; used += size;
    }
    return result;
}

function info(vb, row, text, paint = fg(244)) {
    vb.writeStr(row, INFO_X, paint(clip(text, INFO_W)));
}

export const mahjongRenderMethods = {
    _renderMahjong() {
        const vb = this._rootVB, state = this._mahjong;
        for (const row of vb._buffer) row.fill(_blankCell);
        for (let y = 0; y < 22; y++) vb.setCell(y, TABLE_W, DIVIDER);
        info(vb, 0, '象棋麻將', text => bold(cyan(text)));
        info(vb, 2, `強度 ${(this._mahjongDifficulty || 'medium').toUpperCase()}`);
        if (!state) {
            vb.writeStr(2, 2, '請選擇電腦強度與座位');
            term.writeVB(vb); return;
        }
        info(vb, 4, `第 ${state.round} 局`);
        info(vb, 5, `莊家：${WINDS[state.dealer]}`);
        info(vb, 8, '四家積分', cyan);
        const done = state.phase === 'done';
        for (let seat = 0; seat < 4; seat++) {
            const delta = done ? state.result.delta[seat] : 0;
            const change = delta ? ` (${delta > 0 ? '+' : ''}${delta})` : '';
            info(vb, 10 + seat, `${WINDS[seat]} ${seat === state.human ? '玩家' : '電腦'} ${state.scores[seat]}${change}`,
                done && seat === state.result.winner ? yellow : cyan);
        }
        for (let relative = 0; relative < 4; relative++) {
            const seat = (state.human + relative) % 4, p = state.players[seat];
            const { x, y, label } = POSITIONS[relative];
            const active = !done && actor(state) === seat;
            const title = clip(`${active ? '→ ' : ''}${WINDS[seat]} ${label}${seat === state.dealer ? ' 莊' : ''}${done && seat === state.result.winner ? ' 勝' : ''}`, SEAT_W);
            vb.writeStr(y, x + Math.floor((SEAT_W - bufWidth(title)) / 2), active ? bold(yellow(title)) : cyan(title));
            // Reserve four hand slots and a separate draw slot, even with an open meld.
            let handIndex = 0;
            p.hand.forEach((tile, i) => {
                const slot = tile.id === state.drawn ? DRAWN_X : handIndex++ * 3;
                const offset = x + HAND_X + slot;
                if (relative === 0 || done) {
                    const selected = relative === 0 && state.phase === 'discard' && state.turn === state.human && i === this._mahjongCursor;
                    this._putPiece(vb, y + 1, offset, tile, selected ? 24 : done && tile.id === state.result.tile ? 22 : 0);
                } else {
                    vb.setCell(y + 1, offset, BACK); vb.setCell(y + 1, offset + 1, BACK_CONT);
                }
            });
            if (p.melds.length) {
                const meldX = x + Math.floor((SEAT_W - (3 + p.melds[0].length * 3 - 1)) / 2);
                vb.writeStr(y + 2, meldX, fg(244)('吃'));
                p.melds[0].forEach((tile, i) => this._putPiece(vb, y + 2, meldX + 3 + i * 3, tile, 0));
            }
        }
        vb.writeStr(5, Math.floor((TABLE_W - bufWidth('餘牌')) / 2), fg(244)('餘牌'));
        for (let i = 0; i < state.wall.length; i++) {
            const row = WALL_Y + Math.floor(i / DISCARD_COLS), col = DISCARD_X + (i % DISCARD_COLS) * 3;
            vb.setCell(row, col, BACK);
            vb.setCell(row, col + 1, BACK_CONT);
        }
        vb.writeStr(9, Math.floor((TABLE_W - bufWidth('棄牌')) / 2), fg(244)('棄牌'));
        state.discards.forEach((tile, i) => this._putPiece(vb, DISCARD_Y + Math.floor(i / DISCARD_COLS), DISCARD_X + (i % DISCARD_COLS) * 3,
            tile, tile.id === state.pending?.tile.id ? 22 : 0));
        let message = state.last;
        if (done) {
            const result = state.result;
            message = result.winner === null ? '牌堆已空，流局' : `${WINDS[result.winner]}家${result.source === null ? '自摸' : '胡牌，' + WINDS[result.source] + '家放槍'}`;
            message += `\n下一局：${WINDS[result.nextDealer]}家做莊\nEnter 開始下一局`;
        } else if (state.phase === 'discard' && state.turn === state.human) message += '\n← → 選牌，Enter 打出';
        else message += `\n${WINDS[actor(state)]}家${actor(state) === state.human ? '請選擇動作' : '思考中…'}`;
        info(vb, 15, '對局狀態', cyan);
        wrapDialogText(this._mahjongError || message, INFO_W).slice(0, 6)
            .forEach((line, i) => info(vb, 16 + i, line, yellow));
        const footer = `${done ? 'Enter 下一局' : '← → 選牌 Enter 出牌'}  [h]規則 [r]重玩 [n]重新設定 [q]退出`;
        vb.writeStr(23, Math.max(0, Math.floor((80 - bufWidth(footer)) / 2)), fg(244)(footer));
        term.writeVB(vb);
    },
};
