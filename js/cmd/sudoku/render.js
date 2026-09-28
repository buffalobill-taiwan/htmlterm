import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import {
    BOARD_W, BOARD_H, SIDEBAR_W, BOARD_X, GRID_Y, SIDEBAR_X, DIFFICULTY, SIZE, BOX,
} from './constants.js';
import { term } from '../../system/sys.js';
import { bold, cyan, gray, yellow, red, green } from '../../util/sgr.js';
import { displayWidth } from '../../util/display-width.js';

function _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

const renderMethods = {
    _initVBs() {
        this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);
        this._rootVB = new VirtualBuffer(term.cols, term.rows);
        const board = this._rootVB.addChildSlot();
        Object.assign(board, { vb: this._boardVB, x: BOARD_X, y: GRID_Y, active: true });
        const sidebar = this._rootVB.addChildSlot();
        Object.assign(sidebar, { vb: this._sidebarVB, x: SIDEBAR_X, y: GRID_Y, active: true });
    },

    _drawHeader(vb) {
        if (!this._difficulty) {
            vb.writeStr(0, 0, bold(cyan('  Sudoku')) + '                           ' +
                gray('[n]ew [q]uit'));
        } else {
            const auto = this._autoCheck;
            vb.writeStr(0, 0, bold(cyan('  Sudoku [' + DIFFICULTY[this._difficulty].label + ']')) +
                '    ' + yellow(_formatTime(this._timer)) +
                '    ' + gray('[g]ive up [n]ew [r]estart [c]heck:' + (auto ? 'ON' : 'OFF') + ' [q]uit'));
        }
    },

    _drawBoardBorders(vb) {
        vb.writeStr(0, 0, '  ╔═══╤═══╤═══╦═══╤═══╤═══╦═══╤═══╤═══╗');
        vb.writeStr(2, 0, '  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
        vb.writeStr(4, 0, '  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
        vb.writeStr(6, 0, '  ╠═══╪═══╪═══╬═══╪═══╪═══╬═══╪═══╪═══╣');
        vb.writeStr(8, 0, '  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
        vb.writeStr(10, 0, '  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
        vb.writeStr(12, 0, '  ╠═══╪═══╪═══╬═══╪═══╪═══╬═══╪═══╪═══╣');
        vb.writeStr(14, 0, '  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
        vb.writeStr(16, 0, '  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
        vb.writeStr(18, 0, '  ╚═══╧═══╧═══╩═══╧═══╧═══╩═══╧═══╧═══╝');
    },

    _drawBoardRow(vb, r) {
        const br = this._cursorRow;
        const bc = this._cursorCol;
        const auto = this._autoCheck;
        const y = 1 + r * 2;
        let row = '║';
        for (let c = 0; c < SIZE; c++) {
            row += this._cellStr(r, c, br, bc, auto);
            row += (c % BOX === BOX - 1) ? '║' : '│';
        }
        vb.writeStr(y, 0, '  ' + row);
    },

    _drawSidebarFrame(vb) {
        vb.writeStr(0, 0, '┌─────┐');
        for (let r = 0; r < SIZE; r++) {
            vb.writeStr(2 + r * 2, 0, '│     │');
        }
        vb.writeStr(18, 0, '└─────┘');
    },

    _drawSidebarRow(vb, n) {
        const counts = this._countDigits();
        const y = 1 + (n - 1) * 2;
        const str = this._digitPanelStr(n, counts);
        vb.writeStr(y, 0, '│' + str + '│');
    },

    _updateHeader() {
        this._drawHeader(this._rootVB);
        term.writeVB(this._rootVB);
    },

    _render() {
        this._boardVB.clear();
        this._sidebarVB.clear();
        this._rootVB.clearCells();

        for (let r = 0; r < this._rootVB.height; r++)
            this._rootVB.writeStr(r, 0, ' '.repeat(this._rootVB.width));

        this._drawHeader(this._rootVB);
        this._drawBoardBorders(this._boardVB);
        this._drawSidebarFrame(this._sidebarVB);

        for (let r = 0; r < SIZE; r++) {
            this._drawBoardRow(this._boardVB, r);
            this._drawSidebarRow(this._sidebarVB, r + 1);
        }

        term.writeVB(this._rootVB);
    },

    _hasConflict(r, c) {
        const v = this._board[r][c];
        if (v === 0) return false;
        for (let i = 0; i < SIZE; i++) {
            if (i !== c && this._board[r][i] === v) return true;
            if (i !== r && this._board[i][c] === v) return true;
        }
        const br = Math.floor(r / BOX) * BOX;
        const bc = Math.floor(c / BOX) * BOX;
        for (let dr = 0; dr < BOX; dr++)
            for (let dc = 0; dc < BOX; dc++)
                if ((br + dr !== r || bc + dc !== c) && this._board[br + dr][bc + dc] === v) return true;
        return false;
    },

    _countDigits() {
        const counts = new Array(10).fill(0);
        const total = new Array(10).fill(0);
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++) {
                const v = this._board[r][c];
                if (v > 0) {
                    total[v]++;
                    if (!this._hasConflict(r, c)) counts[v]++;
                }
            }
        return { counts, total };
    },

    _digitPanelStr(n, { counts, total }) {
        const count = counts[n];
        const t = total[n];
        const numStr = String(n);
        let visible, styled;
        if (t > 0 && t > count) {
            visible = numStr + ' ?/9';
            styled = red(bold(visible));
        } else if (count === 9) {
            visible = numStr + ' ✓';
            styled = green(bold(visible));
        } else if (count === 0) {
            visible = numStr + ' ·';
            styled = gray(visible);
        } else {
            visible = numStr + ' ' + count + '/9';
            styled = gray(visible);
        }
        const w = displayWidth(visible);
        return styled + ' '.repeat(Math.max(0, 5 - w));
    },

    _updateDigitRow(n) {
        this._drawSidebarRow(this._sidebarVB, n);
        term.writeVB(this._rootVB);
    },

    _cellStr(r, c, br, bc, auto) {
        const val = this._board[r][c];
        const isGiven = this._given[r][c];
        const isCur = r === br && c === bc;
        const isError = auto && !isGiven && val !== 0 && this._hasConflict(r, c);
        const digit = val !== 0 ? String(val) : ' ';

        if (isCur) {
            if (isError)   return ' \x1B[7m' + red(bold(digit)) + '\x1B[0m ';
            if (isGiven)   return ' \x1B[7m' + cyan(bold(digit)) + '\x1B[0m ';
            if (val !== 0) return ' \x1B[7m' + green(digit) + '\x1B[0m ';
            return ' \x1B[7m \x1B[0m ';
        }
        if (isError)   return ' ' + red(bold(digit)) + ' ';
        if (isGiven)   return ' ' + cyan(bold(digit)) + ' ';
        if (val !== 0) return ' ' + green(digit) + ' ';
        return '   ';
    },

    _renderRow(r) {
        this._drawBoardRow(this._boardVB, r);
        this._drawSidebarRow(this._sidebarVB, r + 1);
        term.writeVB(this._rootVB);
    },
};

export { _formatTime, renderMethods };
