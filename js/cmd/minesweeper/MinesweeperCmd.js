import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE, yellow, bold, green, red, gray } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { DIFFICULTY } from './constants.js';
import { _create2D, generatePuzzle, parseStart, revealCells } from './solver.js';
import { parseSeed, SEED_MAX } from '../../util/random.js';
import { _formatTime, renderMethods } from './render.js';

class MinesweeperCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {
            flags: { '--easy': Boolean, '--medium': Boolean, '--hard': Boolean, '--seed': String, '--start': String },
        });
        if (p.hasHelp) return this.showHelp();
        const flagSeed = p.flag('--seed');
        const posSeed = p.rest.length ? parseSeed(p.rest[0]) : undefined;
        const unknownFlag = args.some(arg => arg.startsWith('-') &&
            !['--easy', '--medium', '--hard', '--seed', '--start'].includes(arg.split('=')[0]));
        if (unknownFlag || p.rest.length > 1 || posSeed === null ||
            (flagSeed !== null && parseSeed(flagSeed) === null)) {
            this.error('invalid arguments: seed must be an integer from 0 to 2147483647');
            return this.showHelp();
        }
        const seed = flagSeed !== null ? parseSeed(flagSeed) : posSeed;
        let diff = null;
        if (p.flag('--easy'))   diff = 'easy';
        if (p.flag('--medium')) diff = 'medium';
        if (p.flag('--hard'))   diff = 'hard';
        const startArg = p.flag('--start');
        const start = startArg !== null ? parseStart(startArg, diff || 'medium') : null;
        if (startArg !== null && !start) {
            this.error('invalid start: use zero-based row,col within the board');
            return this.showHelp();
        }
        if (diff || seed !== undefined || start) {
            this._startGame(diff || 'medium', seed, start);
        } else {
            this._pickDifficulty();
        }
    }

    _pickDifficulty() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        this._completed = false;
        this._timer = 0;
        this._difficulty = null;
        this._seed = null;
        this._startCell = null;

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

    _startGame(diff, seed = Math.floor(Math.random() * (SEED_MAX + 1)), start = null) {
        const cfg = DIFFICULTY[diff];
        this._difficulty = diff;
        this._seed = seed;
        this._startCell = null;
        this._cols = cfg.cols;
        this._rows = cfg.rows;
        this._mineCount = cfg.mines;
        this._board = _create2D(cfg.cols, cfg.rows, -1);
        this._flags = _create2D(cfg.cols, cfg.rows, false);
        this._revealed = _create2D(cfg.cols, cfg.rows, false);
        this._firstClick = true;
        this._completed = false;
        this._won = false;
        this._cursorRow = start?.row ?? Math.floor(cfg.rows / 2);
        this._cursorCol = start?.col ?? Math.floor(cfg.cols / 2);
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
        const puzzle = generatePuzzle(this._difficulty, this._seed, { row: safeR, col: safeC });
        this._board = puzzle.board;
        this._startCell = puzzle.start;
        this._drawHeader();
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
        revealCells(this._board, this._revealed, r, c, this._flags);
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

    static get usage() {
        return 'minesw [seed] [--easy|--medium|--hard] [--seed N] [--start R,C]\n' +
            '         Seed: 0–2147483647; seed alone defaults to Medium.\n' +
            '         Start: zero-based row,col; press Enter there to replay.';
    }
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
