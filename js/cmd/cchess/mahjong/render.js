import { _blankCell } from '../../../util/VirtualBuffer.js';
import { bold, cyan, yellow, fg, makeCell } from '../../../util/sgr.js';
import { bufWidth } from '../../../util/display-width.js';
import { term } from '../../../system/sys.js';
import { WINDS, actor } from './rules.js';

const BACK = makeCell('▓', 240, 22, false, 1);
const POSITIONS = [
    { x: 22, y: 16, label: '玩家' }, { x: 43, y: 8, label: '下家' },
    { x: 22, y: 2, label: '對家' }, { x: 1, y: 8, label: '上家' },
];

export const mahjongRenderMethods = {
    _renderMahjong() {
        const vb = this._rootVB, state = this._mahjong;
        for (const row of vb._buffer) row.fill(_blankCell);
        vb.writeStr(0, 2, bold(cyan(`象棋麻將 ${(this._mahjongDifficulty || 'medium').toUpperCase()}`)));
        if (!state) {
            vb.writeStr(2, 2, '請選擇電腦強度與座位');
            term.writeVB(vb); return;
        }
        vb.writeStr(0, 34, `第 ${state.round} 局  莊家：${WINDS[state.dealer]}  餘牌：${state.wall.length}`);
        const done = state.phase === 'done';
        for (let relative = 0; relative < 4; relative++) {
            const seat = (state.human + relative) % 4, p = state.players[seat];
            const { x, y, label } = POSITIONS[relative];
            const delta = done ? state.result.delta[seat] : 0;
            const score = `${state.scores[seat]}分` + (delta ? ` (${delta > 0 ? '+' : ''}${delta})` : '');
            const title = `${WINDS[seat]} ${label} ${score}${seat === state.dealer ? ' 莊' : ''}${done && seat === state.result.winner ? ' 勝' : ''}`;
            vb.writeStr(y, x, !done && actor(state) === seat ? bold(yellow(title)) : cyan(title));
            vb.writeStr(y + 1, x, fg(244)('手牌'));
            let offset = x + 5;
            p.hand.forEach((tile, i) => {
                if (tile.id === state.drawn) offset++;
                if (relative === 0 || done) {
                    const selected = relative === 0 && state.phase === 'discard' && state.turn === state.human && i === this._mahjongCursor;
                    this._putPiece(vb, y + 1, offset, tile, selected ? 24 : done && tile.id === state.result.tile ? 22 : 0);
                } else {
                    vb.setCell(y + 1, offset, BACK); vb.setCell(y + 1, offset + 1, BACK);
                }
                offset += 3;
            });
            vb.writeStr(y + 2, x, fg(244)('吃牌'));
            p.melds.flat().forEach((tile, i) => this._putPiece(vb, y + 2, x + 5 + i * 3, tile, 0));
            vb.writeStr(y + 3, x, fg(244)('棄牌'));
            p.discards.forEach((tile, i) => this._putPiece(vb, y + 3 + Math.floor(i / 16), x + 5 + (i % 16) * 2,
                tile, tile.id === state.pending?.tile.id ? 22 : 0));
        }
        let message = state.last;
        if (done) {
            const result = state.result;
            message = result.winner === null ? '牌堆已空，流局' : `${WINDS[result.winner]}家${result.source === null ? '自摸' : '胡牌，' + WINDS[result.source] + '家放槍'}`;
            message += `　下一局：${WINDS[result.nextDealer]}家做莊`;
        } else if (state.phase === 'discard' && state.turn === state.human) message += '　← → 選牌，Enter 打出';
        else message += `　${WINDS[actor(state)]}家${actor(state) === state.human ? '請選擇動作' : '思考中…'}`;
        vb.writeStr(14, 2, yellow(this._mahjongError || message));
        vb.writeStr(22, 2, fg(244)('同色帥仕相／將士象／俥傌炮／車馬砲、三兵或三卒 ＋ 一對'));
        vb.writeStr(23, 2, fg(244)('帥將亦可成對；只吃不碰槓。放槍付 1 分，自摸各付 1 分。'));
        const footer = `${done ? 'Enter 下一局' : '← → 選牌  Enter 出牌'}  [r]重玩本局 [n]重新設定 [q]退出`;
        vb.writeStr(24, Math.max(0, Math.floor((80 - bufWidth(footer)) / 2)), fg(244)(footer));
        term.writeVB(vb);
    },
};
