import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE, yellow, bold, green, red, gray } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { DIFFICULTY } from './constants.js';
import { _create2D, _isSolvable } from './solver.js';
import { _formatTime, renderMethods } from './render.js';

class MinesweeperCmd extends CmdBase {
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
        this._difficultyDialog = this.openDialog(SelectDialog, 'minesweeper-diff', {
            title: 'Minesweeper',
            message: yellow('Select difficulty'),
            options: opts,
            footer: '← → Move  ↩ Confirm  ESC Quit',
            onSelect: (idx) => {
                this._difficultyDialog = null;
                this._startGame(opts[idx].toLowerCase());
            },
            onCancel: () => {
                this._difficultyDialog = null;
                this._quit();
            },
        });
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
        this._initVBs();
        this._clearRootBuffer();
        this._render();

        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerInterval = setInterval(() => {
            if (this._completed || this._firstClick) return;
            this._timer++;
            this._drawHeader();
            this._flush();
        }, 1000);
    }

    _generateMines(safeR, safeC) {
        const { _cols: cols, _rows: rows, _mineCount: mineCount } = this;
        for (let attempt = 0; attempt < 200; attempt++) {
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
            if (_isSolvable(this._board, rows, cols, safeR, safeC)) return;
        }
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
        this._flush();
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
        this._drawHeader();
        this._drawBoard();
        const timeStr = _formatTime(this._timer);
        const fRow = this._footerRow();
        const msg = won
            ? bold(green('  Congratulations!')) + '  ' + yellow('Time: ' + timeStr)
            : bold(red('  Boom! Game Over')) + '  ' + yellow('Time: ' + timeStr);
        this._clearRootRow(fRow - 2);
        this._rootVB.writeStr(fRow - 2, 0, msg);
        this._clearRootRow(fRow - 1);
        this._rootVB.writeStr(fRow - 1, 0, gray('  Press [n]ew game or [q]uit'));
        this._flush();
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
        this._flush();
    }

    _toggleFlag() {
        if (this._completed) return;
        const r = this._cursorRow, c = this._cursorCol;
        if (this._revealed[r][c]) return;
        this._flags[r][c] = !this._flags[r][c];
        this._flagsPlaced += this._flags[r][c] ? 1 : -1;
        this._drawRow(r);
        this._drawHeader();
        this._flush();
    }

    _onKey(data) {

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
            if (s === '\x1B' || data === 0x1B) this._quit();
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

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        if (this._rootVB && this._rows) {
            // Place the shell prompt on the line immediately after the footer.
            this.placeShellCursor(this._footerRow());
        }
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'minesw'; }

    static get help() { return 'Play Minesweeper'; }

    static get menu() { return 'Minesweeper'; }

    static get usage() { return 'minesw [--easy|--medium|--hard]'; }
}

// Keep the command as the state owner and preserve class-method descriptors.
for (const methods of [renderMethods]) {
    for (const [name, value] of Object.entries(methods)) {
        Object.defineProperty(MinesweeperCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { MinesweeperCmd };
