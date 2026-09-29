import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import { DIFFICULTY } from './constants.js';
import { bold, cyan, red, yellow, gray } from '../../util/sgr.js';

const NUM_COLORS = [
    '',                         // 0 — unused
    '\x1B[94m',                // 1 — bright blue
    '\x1B[32m',                // 2 — green
    '\x1B[33m',                // 3 — yellow
    '\x1B[38;5;80m',           // 4 — turquoise
    '\x1B[95m',                // 5 — bright magenta
    '\x1B[36m',                // 6 — cyan
    '\x1B[38;5;214m',          // 7 — orange
    '\x1B[90m',                // 8 — gray
];

const CELL_HIDDEN = '▒▒';  // unopened cell
const CELL_EMPTY  = '　';  // fullwidth space (revealed empty, 0 neighbors)
const CELL_FLAG   = 'Ｆ';  // Ｆ
const CELL_MINE   = '＊';  // ＊
const CELL_WRONG  = 'Ｘ';  // Ｘ

function _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

const renderMethods = {
    _initVBs() {
        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._rootSlotBoard = this._rootVB.addChildSlot();
            this._rootSlotBoard.y = 2;
            this._rootSlotBoard.active = true;
        }

        const boardW = 1 + this._cols * 2 + 1;
        const boardH = this._rows + 2;
        this._rootSlotBoard.x = Math.max(0, Math.floor((term.cols - boardW) / 2));
        if (!this._boardVB || this._boardVB.width !== boardW || this._boardVB.height !== boardH) {
            this._boardVB = new VirtualBuffer(boardW, boardH);
            this._rootSlotBoard.vb = this._boardVB;
        }
    },

    _clearRootBuffer() {
        const blank = '\x1B[0m' + ' '.repeat(this._rootVB.width);
        for (let r = 0; r < this._rootVB.height; r++)
            this._rootVB.writeStr(r, 0, blank);
    },

    _clearRootRow(row) {
        this._rootVB.writeStr(row, 0, '\x1B[0m' + ' '.repeat(this._rootVB.width));
    },

    _flush() {
        term.writeVB(this._rootVB);
        term.curX = this._rootSlotBoard.x + this._cursorCol * 2 + 2;
        term.curY = this._cursorRow + 3;
    },

    _drawHeader() {
        const cfg = DIFFICULTY[this._difficulty];
        const mines = this._completed ? 0 : this._mineCount - this._flagsPlaced;
        const t = _formatTime(this._timer);
        const pad = Math.max(0, 48 - cfg.label.length);
        this._clearRootRow(0);
        this._rootVB.writeStr(0, 0, bold(cyan('  Minesweeper [' + cfg.label + ']')) +
            ' '.repeat(Math.max(0, pad)) +
            bold(red(String(mines).padStart(3))) + ' mines  ' +
            yellow(t));
        const start = this._startCell;
        this._rootVB.writeStr(0, 30, gray('start: ' + (start ? start.row + ',' + start.col : 'pending')));
    },

    _footerRow() {
        return 6 + this._rows;
    },

    _drawFooter() {
        this._clearRootRow(1);
        this._rootVB.writeStr(1, 0, gray('  ←↑↓→ Move   Enter Reveal   Space Flag   [n]ew [q]uit'));
        this._rootVB.writeStr(1, 55, gray('seed: ' + this._seed));
    },

    _drawBoard() {
        const { _cols: cols, _rows: rows } = this;
        const lineW = 1 + cols * 2 + 1;
        this._boardVB.writeStr(0, 0, '╔' + '═'.repeat(lineW - 2) + '╗');
        for (let r = 0; r < rows; r++) {
            let s = '║';
            for (let c = 0; c < cols; c++)
                s += this._cellStr(r, c);
            s += '║';
            this._boardVB.writeStr(r + 1, 0, s);
        }
        this._boardVB.writeStr(rows + 1, 0, '╚' + '═'.repeat(lineW - 2) + '╝');
    },

    _drawRow(r) {
        const { _cols: cols } = this;
        let s = '║';
        for (let c = 0; c < cols; c++)
            s += this._cellStr(r, c);
        s += '║';
        this._boardVB.writeStr(r + 1, 0, s);
    },

    _cellStr(r, c) {
        const isCur = r === this._cursorRow && c === this._cursorCol && !this._completed;

        if (this._board[r][c] === -1 && this._revealed[r][c]) {
            const cell = CELL_MINE;
            return isCur ? '\x1B[7m' + red(bold(cell)) + '\x1B[0m' : red(bold(cell));
        }
        if (this._flags[r][c]) {
            if (this._completed && !this._revealed[r][c] && this._board[r][c] !== -1) {
                return isCur ? '\x1B[7m' + red(bold(CELL_WRONG)) + '\x1B[0m' : red(bold(CELL_WRONG));
            }
            return isCur ? '\x1B[7m' + red(bold(CELL_FLAG)) + '\x1B[0m' : red(bold(CELL_FLAG));
        }
        if (!this._revealed[r][c]) {
            return isCur ? '\x1B[7;37;40m' + CELL_HIDDEN + '\x1B[0m' : gray(CELL_HIDDEN);
        }
        const n = this._board[r][c];
        if (n === 0) return isCur ? '\x1B[7m' + CELL_EMPTY + '\x1B[0m' : CELL_EMPTY;
        const cell = String.fromCharCode(0xFF10 + n);
        const color = NUM_COLORS[n];
        return isCur ? '\x1B[7m' + bold(color + cell) + '\x1B[0m' : bold(color + cell);
    },

    _render() {
        this._drawHeader();
        this._drawBoard();
        this._drawFooter();
        this._flush();
    },
};

export { _formatTime, renderMethods };
