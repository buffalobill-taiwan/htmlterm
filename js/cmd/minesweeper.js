import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, green, yellow, cyan, gray, CURSOR_HIDE } from '../util/sgr.js';

const DIFFICULTY = {
    easy:   { cols: 8,  rows: 8,  mines: 10, label: 'Easy' },
    medium: { cols: 16, rows: 12, mines: 32, label: 'Medium' },
    hard:   { cols: 32, rows: 16, mines: 90, label: 'Hard' },
};

const NUM_COLORS = [
    '',               // 0 — unused
    '\x1B[94m',       // 1 — bright blue
    '\x1B[32m',       // 2 — green
    '\x1B[35m',       // 3 — magenta
    '\x1B[34m',       // 4 — blue
    '\x1B[35m',       // 5 — magenta
    '\x1B[36m',       // 6 — cyan
    '\x1B[37m',       // 7 — white
    '\x1B[90m',       // 8 — gray
];

const CELL_HIDDEN = '\u30FB';  // ・ katakana middle dot (hidden cell)
const CELL_EMPTY  = '\u3000';  // fullwidth space (revealed empty, 0 neighbors)
const CELL_FLAG   = '\uFF26';  // Ｆ
const CELL_MINE   = '\uFF0A';  // ＊
const CELL_WRONG  = '\uFF38';  // Ｘ

function _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _create2D(cols, rows, val) {
    return Array.from({ length: rows }, () => Array(cols).fill(val));
}

export class MinesweeperCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {
            flags: { '--easy': Boolean, '--medium': Boolean, '--hard': Boolean },
        });
        if (p.hasHelp) return this.showHelp();
        let diff = null;
        if (p.flag('--easy'))   diff = 'easy';
        if (p.flag('--medium')) diff = 'medium';
        if (p.flag('--hard'))   diff = 'hard';
        if (diff) {
            this._startGame(diff);
        } else {
            this._pickDifficulty();
        }
    }

    _pickDifficulty() {
        this._completed = false;
        this._timer = 0;
        this._difficulty = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        const opts = ['Easy', 'Medium', 'Hard'];
        const dialog = new SelectDialog(term, {
            title: 'Minesweeper',
            message: yellow('Select difficulty'),
            options: opts,
            footer: '\u2190 \u2192 Move  \u21A9 Confirm  ESC Quit',
            onSelect: (idx) => {
                this._difficultyDialog = null;
                this._startGame(opts[idx].toLowerCase());
            },
            onCancel: () => {
                this._difficultyDialog = null;
                this._quit();
            },
        });
        dialog.open();
        this._difficultyDialog = dialog;
    }

    _startGame(diff) {
        const cfg = DIFFICULTY[diff];
        this._difficulty = diff;
        this._cols = cfg.cols;
        this._rows = cfg.rows;
        this._mineCount = cfg.mines;
        this._board = _create2D(cfg.cols, cfg.rows, -1);
        this._flags = _create2D(cfg.cols, cfg.rows, false);
        this._revealed = _create2D(cfg.cols, cfg.rows, false);
        this._firstClick = true;
        this._completed = false;
        this._won = false;
        this._cursorRow = Math.floor(cfg.rows / 2);
        this._cursorCol = Math.floor(cfg.cols / 2);
        this._flagsPlaced = 0;
        this._timer = 0;
        this._difficultyDialog = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._render();

        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerInterval = setInterval(() => {
            if (this._completed || this._firstClick) return;
            this._timer++;
            this._drawHeader();
        }, 1000);
    }

    _generateMines(safeR, safeC) {
        const { _cols: cols, _rows: rows, _mineCount: mineCount } = this;
        this._board = _create2D(cols, rows, 0);
        let placed = 0;
        while (placed < mineCount) {
            const r = Math.floor(Math.random() * rows);
            const c = Math.floor(Math.random() * cols);
            if (this._board[r][c] === -1) continue;
            if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
            this._board[r][c] = -1;
            placed++;
        }
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                if (this._board[r][c] === -1) continue;
                let n = 0;
                for (let dr = -1; dr <= 1; dr++)
                    for (let dc = -1; dc <= 1; dc++) {
                        const rr = r + dr, cc = c + dc;
                        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && this._board[rr][cc] === -1)
                            n++;
                    }
                this._board[r][c] = n;
            }
    }

    _drawHeader() {
        const cfg = DIFFICULTY[this._difficulty];
        const mines = this._mineCount - this._flagsPlaced;
        const t = _formatTime(this._timer);
        const pad = Math.max(0, 48 - cfg.label.length);
        term.write('\x1B[1;1H' + bold(cyan('  Minesweeper [' + cfg.label + ']')) +
            ' '.repeat(Math.max(0, pad)) +
            bold(red(String(mines).padStart(3))) + ' mines  ' +
            yellow(t));
    }

    _footerRow() {
        return 6 + this._rows;
    }

    _drawFooter() {
        term.write('\x1B[2;1H\x1B[2K' + gray('  \u2190\u2191\u2193\u2192 Move   Enter Reveal   Space Flag   [n]ew [q]uit'));
    }

    _drawBoard() {
        const { _cols: cols, _rows: rows } = this;
        const boardY = 3;
        const lineW = 1 + cols * 2 + 1;
        let s = '\x1B[' + boardY + ';1H';
        s += '\u2554' + '\u2550'.repeat(lineW - 2) + '\u2557';
        for (let r = 0; r < rows; r++) {
            s += '\x1B[' + (boardY + 1 + r) + ';1H';
            s += '\u2551';
            for (let c = 0; c < cols; c++)
                s += this._cellStr(r, c);
            s += '\u2551';
        }
        s += '\x1B[' + (boardY + 1 + rows) + ';1H';
        s += '\u255A' + '\u2550'.repeat(lineW - 2) + '\u255D';
        term.write(s);
    }

    _drawRow(r) {
        const boardY = 3;
        const { _cols: cols } = this;
        let s = '\x1B[' + (boardY + 1 + r) + ';1H\u2551';
        for (let c = 0; c < cols; c++)
            s += this._cellStr(r, c);
        s += '\u2551';
        term.write(s);
    }

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
    }

    _reveal(r, c) {
        if (this._completed || this._revealed[r][c] || this._flags[r][c]) return;
        if (this._firstClick) {
            this._generateMines(r, c);
            this._firstClick = false;
        }
        if (this._board[r][c] === -1) {
            this._gameOver(false);
            return;
        }
        const q = [[r, c]];
        this._revealed[r][c] = true;
        while (q.length) {
            const [cr, cc] = q.pop();
            if (this._board[cr][cc] !== 0) continue;
            for (let dr = -1; dr <= 1; dr++)
                for (let dc = -1; dc <= 1; dc++) {
                    const nr = cr + dr, nc = cc + dc;
                    if (nr >= 0 && nr < this._rows && nc >= 0 && nc < this._cols &&
                        !this._revealed[nr][nc] && !this._flags[nr][nc]) {
                        this._revealed[nr][nc] = true;
                        q.push([nr, nc]);
                    }
                }
        }
        this._drawBoard();
        if (this._checkWin()) this._gameOver(true);
    }

    _checkWin() {
        for (let r = 0; r < this._rows; r++)
            for (let c = 0; c < this._cols; c++)
                if (this._board[r][c] !== -1 && !this._revealed[r][c]) return false;
        return true;
    }

    _gameOver(won) {
        this._completed = true;
        this._won = won;
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        for (let r = 0; r < this._rows; r++)
            for (let c = 0; c < this._cols; c++)
                if (this._board[r][c] === -1) this._revealed[r][c] = true;
        this._drawBoard();
        const timeStr = _formatTime(this._timer);
        const fRow = this._footerRow();
        const msg = won
            ? bold(green('  Congratulations!')) + '  ' + yellow('Time: ' + timeStr)
            : bold(red('  Boom! Game Over')) + '  ' + yellow('Time: ' + timeStr);
        term.write('\x1B[' + (fRow - 1) + ';1H' + msg);
        term.write('\x1B[' + fRow + ';1H' + gray('  Press [n]ew game or [q]uit'));
    }

    _move(dr, dc) {
        const nr = this._cursorRow + dr;
        const nc = this._cursorCol + dc;
        if (nr < 0 || nr >= this._rows || nc < 0 || nc >= this._cols) return;
        const oldR = this._cursorRow;
        const oldC = this._cursorCol;
        this._cursorRow = nr;
        this._cursorCol = nc;
        this._drawRow(oldR);
        this._drawRow(nr);
    }

    _toggleFlag() {
        if (this._completed) return;
        const r = this._cursorRow, c = this._cursorCol;
        if (this._revealed[r][c]) return;
        this._flags[r][c] = !this._flags[r][c];
        this._flagsPlaced += this._flags[r][c] ? 1 : -1;
        this._drawRow(r);
        this._drawHeader();
    }

    _onKey(data) {
        if (this._difficultyDialog) {
            this._difficultyDialog.handleKey(data);
            return;
        }

        if (this._completed) {
            const code = typeof data === 'string' ? data.charCodeAt(0) : data;
            if (code === 0x03) { this._quit(); return; }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._move(-1, 0); return; }
            if (s === '\x1B[B') { this._move(1, 0); return; }
            if (s === '\x1B[D') { this._move(0, -1); return; }
            if (s === '\x1B[C') { this._move(0, 1); return; }
            this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (code === 0x0D || code === 0x0A) {
            this._reveal(this._cursorRow, this._cursorCol);
            return;
        }

        if (code === 0x20) {
            this._toggleFlag();
            return;
        }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'n') { this._pickDifficulty(); return; }
        }
    }

    _render() {
        this._drawHeader();
        this._drawBoard();
        this._drawFooter();
        term.write('\x1B[' + (this._cursorRow + 4) + ';' + (this._cursorCol * 2 + 3) + 'H');
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        term.write('\x1B[' + (this._footerRow() + 1) + ';1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'minesweeper'; }
    static get help() { return 'Play Minesweeper'; }
    static get menu() { return 'Minesweeper'; }
    static get usage() { return 'minesweeper [--easy|--medium|--hard]'; }
}
