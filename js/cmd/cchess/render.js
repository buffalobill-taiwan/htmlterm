import { VirtualBuffer, _blankCell } from '../../util/VirtualBuffer.js';
import { makeCell, fg, bold, cyan, yellow } from '../../util/sgr.js';
import { term } from '../../system/sys.js';
import { isWide, bufWidth } from '../../util/display-width.js';
import { CHARS } from './engine/constants.js';
import { isInCheck } from './engine/rules.js';
import { BOARD_X, BOARD_Y, BOARD_W, BOARD_H, SIDE_X, SIDE_W, boardX, boardY } from './constants.js';

function clip(text, width) {
    let result = '', used = 0;
    for (const ch of text) {
        const size = isWide(ch) ? 2 : 1;
        if (used + size > width) break;
        result += ch; used += size;
    }
    return result;
}

export const renderMethods = {
    _initVBs() {
        if (this._rootVB) return;
        this._rootVB = new VirtualBuffer(80, 25);
        this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._gridVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._animationVB = new VirtualBuffer(BOARD_W, BOARD_H);
        const slot = this._rootVB.addChildSlot();
        Object.assign(slot, { vb: this._boardVB, x: BOARD_X, y: BOARD_Y, active: true });
        this._pieceCells = new Map();
        this._pointCells = new Map();
        const backgrounds = [0, 3, 22, 24, 60, 236];
        for (const bg of backgrounds) {
            for (const color of ['red', 'black']) {
                for (const [type, ch] of Object.entries(CHARS[color])) {
                    this._pieceCells.set(`${color}:${type}:${bg}`, [
                        makeCell(ch, color === 'red' ? 9 : 15, bg, true, 2),
                        makeCell(' ', color === 'red' ? 9 : 15, bg, true, 0),
                    ]);
                }
            }
        }
        const grid = this._gridVB;
        for (const row of grid._buffer) row.fill(_blankCell);
        const nums = ['１','２','３','４','５','６','７','８','９'];
        const redNums = ['九','八','七','六','五','四','三','二','一'];
        for (let c = 0; c < 9; c++) {
            grid.writeStr(0, boardX(c), fg(244)(nums[c]));
            grid.writeStr(20, boardX(c), fg(244)(redNums[c]));
        }
        for (let r = 0; r < 10; r++) {
            let line = '';
            for (let c = 0; c < 9; c++) {
                const point = r === 0 ? (c === 0 ? '┌' : c === 8 ? '┐' : '┬') :
                    r === 9 ? (c === 0 ? '└' : c === 8 ? '┘' : '┴') :
                    c === 0 ? '├' : c === 8 ? '┤' : r === 4 ? '┴' : r === 5 ? '┬' : '┼';
                line += point + (c < 8 ? '───' : ' ');
            }
            grid.writeStr(boardY(r), 2, fg(244)(line));
            if (r < 9) {
                for (let c = 0; c < 9; c++) {
                    if (r !== 4 || c === 0 || c === 8) grid.writeStr(boardY(r) + 1, boardX(c), fg(244)('│'));
                }
            }
        }
        grid.writeStr(10, 10, fg(244)('楚河         漢界'));
        for (const base of [0, 7]) {
            grid.writeStr(boardY(base)+1, boardX(3)+2, fg(244)('╲'));
            grid.writeStr(boardY(base)+1, boardX(4)+2, fg(244)('╱'));
            grid.writeStr(boardY(base)+3, boardX(3)+2, fg(244)('╱'));
            grid.writeStr(boardY(base)+3, boardX(4)+2, fg(244)('╲'));
        }
        for (const bg of backgrounds) {
            const points = [];
            for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
                points.push([
                    { ...grid.getCell(boardY(r), boardX(c)), bg },
                    { ...grid.getCell(boardY(r), boardX(c)+1), bg },
                ]);
            }
            this._pointCells.set(bg, points);
        }
    },

    _putPiece(vb, y, x, piece, bg) {
        const cells = this._pieceCells.get(`${piece.color}:${piece.type}:${bg}`);
        vb.setCell(y, x, cells[0]);
        vb.setCell(y, x+1, cells[1]);
    },

    _render() {
        const root = this._rootVB, vb = this._boardVB;
        for (const row of root._buffer) row.fill(_blankCell);
        for (let r = 0; r < BOARD_H; r++) {
            for (let c = 0; c < BOARD_W; c++) vb.setCell(r, c, this._gridVB.getCell(r, c));
        }
        if (this._board) {
            for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
                const piece = this._board[r][c];
                const active = !this._busy && !this._completed;
                let bg = this._lastMove && [this._lastMove.from, this._lastMove.to].some(p => p.row === r && p.col === c) ? 236 : 0;
                if (active && this._destinations?.has(r*9+c)) bg = 22;
                if (active && this._cursorR === r && this._cursorC === c) bg = 24;
                if (active && this._selected?.row === r && this._selected?.col === c) bg = 60;
                if (piece) this._putPiece(vb, boardY(r), boardX(c), piece, bg);
                else if (bg) {
                    const cells = this._pointCells.get(bg)[r*9+c];
                    vb.setCell(boardY(r), boardX(c), cells[0]);
                    vb.setCell(boardY(r), boardX(c)+1, cells[1]);
                }
            }
        }
        root.writeStr(0, SIDE_X, bold(cyan('中國象棋')));
        const label = this._mode === 'endgame' ? this._puzzle?.meta.name ?? '' : this._difficulty ? this._difficulty.toUpperCase() : '';
        root.writeStr(2, SIDE_X, bold(yellow(clip(label, SIDE_W))));
        const side = this._human === 'black' ? '黑' : '紅';
        root.writeStr(4, SIDE_X, `玩家：${side}方`);
        if (this._puzzle && this._mode === 'endgame') root.writeStr(6, SIDE_X, `最短紅勝：${this._puzzle.meta.step} 步`);
        root.writeStr(7, SIDE_X, `玩家已走：${this._humanSteps ?? 0} 步`);
        let status = this._result || this._message || (this._busy ? '電腦思考中…' : this._board ? '輪到玩家走棋' : '請選擇遊戲設定');
        if (this._board && !this._busy && !this._completed && isInCheck(this._board, this._turn)) status = '將軍！請應將';
        root.writeStr(9, SIDE_X, yellow(clip(status, SIDE_W)));
        root.writeStr(11, SIDE_X, fg(244)('最近棋譜'));
        const log = this._log ?? [], start = Math.max(0, log.length - 10);
        for (let i = start; i < log.length; i++) root.writeStr(12+i-start, SIDE_X, clip(log[i], SIDE_W));
        const footer = '←↑↓→ 移動  Enter 選棋/落子  Space 取消  [r]重來 [n]換局 [q]退出';
        root.writeStr(23, Math.max(0, Math.floor((80-bufWidth(footer))/2)), fg(244)(footer));
        term.writeVB(root);
    },
};
