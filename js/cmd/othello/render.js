import { makeCell, fg, bold, cyan, yellow } from '../../util/sgr.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import {
    BOARD_W, BOARD_H, GRID_X, GRID_Y, BLACK, N, EMPTY, WHITE, DIFFICULTY, STATUS_Y, FOOTER_Y,
} from './constants.js';
import { discFlips, idx, other, isValid, countPieces } from './board.js';
import { bufWidth } from '../../util/display-width.js';

const renderMethods = {
    _initCells() {
        if (this._cells) return;
        const cont = (bg) => makeCell('', 0, bg, false, 0);
        this._cells = {
            line: makeCell(' ', 0, 0, false),
            sq:   makeCell('　', 240, 0, false, 2),
            sq2:  cont(0),
            hint:  makeCell('・', 250, 0, false, 2),
            hint2: cont(0),
            black:     makeCell('◯', 15, 0, true, 2),
            blackC:    cont(0),
            white:     makeCell('⬤', 15, 0, true, 2),
            whiteC:    cont(0),
            flipBlack:  makeCell('◯', 15, 5, true, 2),
            flipBlackC: cont(5),
            flipWhite:  makeCell('⬤', 15, 5, true, 2),
            flipWhiteC: cont(5),
            curBlack:  makeCell('◯', 15, 13, true, 2),
            curBlackC: cont(13),
            curWhite:  makeCell('⬤', 15, 13, true, 2),
            curWhiteC: cont(13),
            curHint:    makeCell('・', 15, 13, false, 2),
            curHint2:   cont(13),
            curSq:     makeCell('　', 15, 13, false, 2),
            curSq2:    cont(13),
            thinkBlack:  makeCell('◯', 0, 3, true, 2),
            thinkBlackC: cont(3),
            thinkWhite:  makeCell('⬤', 15, 3, true, 2),
            thinkWhiteC: cont(3),
            thinkSq:     makeCell('　', 15, 3, false, 2),
            thinkSq2:    cont(3),
        };
    },

    _initVBs() {
        this._initCells();
        if (this._rootVB) return;
        this._rootVB = new VirtualBuffer(term.cols, term.rows);
        this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._slot = this._rootVB.addChildSlot();
        this._slot.vb = this._boardVB;
        this._slot.x = GRID_X;
        this._slot.y = GRID_Y;
        this._slot.active = true;
    },

    _render() {
        const C = this._cells;
        const root = this._rootVB;
        for (let r = 0; r < root.height; r++) {
            const row = root._buffer[r];
            for (let c = 0; c < row.length; c++) row[c] = C.line;
        }

        const vb = this._boardVB;
        for (let r = 0; r < vb.height; r++) {
            const row = vb._buffer[r];
            for (let c = 0; c < row.length; c++) row[c] = C.line;
        }
        vb.writeStr(0, 0, fg(250)('╔' + '═'.repeat(16) + '╗'));
        for (let r = 1; r <= 8; r++) {
            vb.writeStr(r, 0, fg(250)('║'));
            vb.writeStr(r, 17, fg(250)('║'));
        }
        vb.writeStr(9, 0, fg(250)('╚' + '═'.repeat(16) + '╝'));

        this._cursorFlips = null;
        if (this._flipBusy === false && this._completed === false && this._passMsg === null &&
                this._turn === BLACK) {
            const flips = discFlips(this._board, this._cursorR, this._cursorC, BLACK);
            if (flips) this._cursorFlips = new Set(flips);
        }

        for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++)
                this._drawSquare(vb, r, c);

        this._drawHeader(root);
        this._drawStatus(root);
        this._drawFooter(root);
        term.writeVB(root);
    },

    _drawSquare(vb, r, c) {
        const C = this._cells;
        const x = 1 + c * 2;
        const y = 1 + r;
        const p = this._board[idx(r, c)];
        const isCur = this._flipBusy === false && this._completed === false &&
            this._turn === BLACK && r === this._cursorR && c === this._cursorC;
        const isThink = this._thinkHighlight &&
            this._thinkHighlight[0] === r && this._thinkHighlight[1] === c;

        let shown = p;
        if (p !== EMPTY && this._pendingFlips) {
            const ring = this._pendingFlips.get(idx(r, c));
            if (ring !== undefined && ring > this._waveIndex) shown = other(p);
        }

        let cell, cell2;
        if (shown !== EMPTY && this._cursorFlips && this._cursorFlips.has(idx(r, c))) {
            if (shown === BLACK) { cell = C.flipBlack; cell2 = C.flipBlackC; }
            else { cell = C.flipWhite; cell2 = C.flipWhiteC; }
        } else if (shown === BLACK) {
            if (isThink) { cell = C.thinkBlack; cell2 = C.thinkBlackC; }
            else if (isCur) { cell = C.curBlack; cell2 = C.curBlackC; }
            else { cell = C.black; cell2 = C.blackC; }
        } else if (shown === WHITE) {
            if (isThink) { cell = C.thinkWhite; cell2 = C.thinkWhiteC; }
            else if (isCur) { cell = C.curWhite; cell2 = C.curWhiteC; }
            else { cell = C.white; cell2 = C.whiteC; }
        } else if (isThink) {
            cell = C.thinkSq;
            cell2 = C.thinkSq2;
        } else if (!this._flipBusy && !this._passMsg && !this._completed &&
                this._turn === BLACK && isValid(this._board, r, c, BLACK)) {
            if (isCur) { cell = C.curHint; cell2 = C.curHint2; }
            else { cell = C.hint; cell2 = C.hint2; }
        } else if (isCur) {
            cell = C.curSq;
            cell2 = C.curSq2;
        } else {
            cell = C.sq;
            cell2 = C.sq2;
        }
        vb.setCell(y, x, cell);
        vb.setCell(y, x + 1, cell2);
    },

    _drawHeader(root) {
        const label = DIFFICULTY[this._difficulty].label;
        const b = countPieces(this._board, BLACK);
        const w = countPieces(this._board, WHITE);
        const left = '  ' + bold(cyan('Othello')) + ' [' + label + ']';
        const right = '  ' + fg(240)('◯') + ' ' + b + '   ' + fg(240)('⬤') + ' ' + w + '  ';
        const pad = Math.max(0, root.width - bufWidth(left) - bufWidth(right));
        root.writeStr(0, 0, left + ' '.repeat(pad) + right);
    },

    _drawStatus(root) {
        root.writeStr(STATUS_Y, 1, ' '.repeat(60));
        let msg;
        if (this._completed) {
            msg = this._result || '';
        } else if (this._flipBusy) {
            msg = this._turn === WHITE ? yellow(' AI thinking...') : fg(240)(' Flipping...');
        } else if (this._passMsg) {
            msg = fg(240)(this._passMsg);
        } else if (this._turn === BLACK && this._firstMove) {
            msg = fg(240)(' Your turn — [p] pass, AI moves first');
        } else {
            msg = fg(240)(' Your turn');
        }
        root.writeStr(STATUS_Y, 1, '  ' + msg);
    },

    _drawFooter(root) {
        const pass = this._firstMove ? '   [p]ass' : '';
        root.writeStr(FOOTER_Y, 1, '  ' +
            fg(240)('←↑↓→ Move   Enter Place' + pass + '   [n]ew [q]uit'));
    },
};

export { renderMethods };
