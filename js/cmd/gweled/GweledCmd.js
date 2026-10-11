import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE } from '../../util/sgr.js';
import { FieldPickerDialog } from '../../dialog/FieldPickerDialog.js';
import {
    DIFFICULTY, COLS, ROWS, SWAP_BACK_MS, AUTO_DELAY_MS, FLASH_CYCLES, FLASH_STEP_MS, FALL_STEP_MS,
    FALL_DELAY, DIRS, BOARD_Y, BOARD_H,
} from './constants.js';
import {
    _createBoard, _findMatches, _hasAnyMove, _swapCreatesMatch, _calcChainScore, _fallOneStep,
} from './board.js';
import { renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.gweled;

class GweledCmd extends CmdBase {
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
        this._clearTimers();
        this._completed = false;
        this._difficulty = null;
        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._difficultyDialog = this.openDialog(FieldPickerDialog, 'gweled-diff', {
            title: 'Gweled',
            fields: [{ key: 'difficulty', label: '難度',
                options: [['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']] }],
            onConfirm: ({ difficulty }) => {
                this._difficultyDialog = null;
                this._startGame(difficulty);
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
        this._score = 0;
        this._maxChain = 0;
        this._completed = false;
        this._paused = false;
        this._resolving = false;
        this._reverting = false;
        this._chain = 0;
        this._lastChainScore = 0;
        this._popping = null;
        this._popFlashCount = 0;
        this._chainTimer = null;
        this._fallTimer = null;
        this._swapBackTimer = null;
        this._noMovesTimer = null;
        this._noMovesMsg = false;
        this._auto = false;
        this._autoTimer = null;
        this._difficultyDialog = null;
        this._colorPool = [1, 2, 3, 4, 5, 6, 7].slice(0, cfg.colors);
        this._owedGems = new Array(COLS).fill(0);

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._initVBs();
        this._board = this._genBoard();
        this._cursor = { r: 3, c: 3 };
        this._selected = null;
        this._render();
    }

    _genBoard() {
        const pool = this._colorPool;
        const n = pool.length;
        for (let tries = 0; tries < 200; tries++) {
            const board = _createBoard();
            for (let r = 0; r < ROWS; r++)
                for (let c = 0; c < COLS; c++)
                    board[r][c] = pool[Math.floor(Math.random() * n)];
            if (_findMatches(board).groups.length === 0 && _hasAnyMove(board)) {
                return board;
            }
        }
        return this._genBoard();
    }

    // During the fall animation each column refills from the top: one new gem
    // per tick is dropped into any column whose top cell is empty and that
    // still owes gems from the last pop, so the new gems descend together
    // with the existing ones instead of appearing after the fall settles.
    _injectTopGems() {
        const pool = this._colorPool;
        const n = pool.length;
        let injected = false;
        for (let c = 0; c < COLS; c++) {
            if (this._owedGems[c] > 0 && this._board[0][c] === 0) {
                this._board[0][c] = pool[Math.floor(Math.random() * n)];
                this._owedGems[c]--;
                injected = true;
            }
        }
        return injected;
    }

    _swapCells(r1, c1, r2, c2) {
        const t = this._board[r1][c1];
        this._board[r1][c1] = this._board[r2][c2];
        this._board[r2][c2] = t;
    }

    _trySwap(dir) {
        if (!this._selected || this._resolving || this._reverting) return;
        const { r, c } = this._selected;
        const nr = r + dir.dr, nc = c + dir.dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;

        this._swapCells(r, c, nr, nc);
        if (_findMatches(this._board).groups.length > 0) {
            this._cursor = { r: nr, c: nc };
            this._selected = null;
            this._resolving = true;
            this._chain = 0;
            this._lastChainScore = 0;
            this._render();
            this._chainTimer = setTimeout(() => this._chainStep(), 150);
        } else {
            this._reverting = true;
            this._render();
            this._swapBackTimer = setTimeout(() => {
                this._swapCells(r, c, nr, nc);
                this._reverting = false;
                this._render();
                this._scheduleAutoMove();
            }, SWAP_BACK_MS);
        }
    }

    _toggleAuto() {
        this._auto = !this._auto;
        this._selected = null;
        if (this._auto) {
            if (!this._paused) this._scheduleAutoMove();
        } else {
            this._clearAutoTimer();
        }
        this._render();
    }

    _scheduleAutoMove() {
        if (!this._auto) return;
        this._clearAutoTimer();
        this._autoTimer = setTimeout(() => this._autoStep(), AUTO_DELAY_MS);
    }

    _clearAutoTimer() {
        if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; }
    }

    _autoStep() {
        if (this._completed) return;
        if (!this._auto || this._paused || this._resolving || this._reverting || this._noMovesMsg) return;
        const moves = [];
        const board = this._board;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (c + 1 < COLS && _swapCreatesMatch(board, r, c, r, c + 1))
                    moves.push({ r, c, dr: 0, dc: 1 });
                if (r + 1 < ROWS && _swapCreatesMatch(board, r, c, r + 1, c))
                    moves.push({ r, c, dr: 1, dc: 0 });
            }
        }
        if (moves.length === 0) {
            this._checkNoMoves();
            return;
        }
        const m = moves[Math.floor(Math.random() * moves.length)];
        this._selected = { r: m.r, c: m.c };
        this._trySwap({ dr: m.dr, dc: m.dc });
    }

    _chainStep() {
        if (this._completed) return;
        const { groups, popped } = _findMatches(this._board);
        if (groups.length === 0) {
            this._resolving = false;
            this._popping = null;
            this._chain = 0;
            if (_hasAnyMove(this._board)) this._scheduleAutoMove();
            this._checkNoMoves();
            this._render();
            return;
        }
        this._chain++;
        if (this._chain > this._maxChain) this._maxChain = this._chain;

        const colors = new Set();
        for (let i = 0; i < groups.length; i++)
            for (let j = 0; j < groups[i].cells.length; j++)
                colors.add(this._board[groups[i].cells[j][0]][groups[i].cells[j][1]]);
        this._lastChainScore = _calcChainScore(this._chain, popped.size, groups.length, colors.size);
        this._score += this._lastChainScore;
        this._popping = popped;

        this._popFlashCount = 0;
        this._flashPop();
    }

    _flashPop() {
        if (this._completed) return;
        if (this._popFlashCount >= FLASH_CYCLES) {
            this._popAndFall();
            return;
        }
        this._popFlashCount++;
        this._render();
        this._chainTimer = setTimeout(() => this._flashPop(), FLASH_STEP_MS);
    }

    _popAndFall() {
        if (this._completed) return;
        for (const k of this._popping) {
            this._board[Math.floor(k / COLS)][k % COLS] = 0;
        }
        this._popping = null;
        for (let c = 0; c < COLS; c++) {
            let holes = 0;
            for (let r = 0; r < ROWS; r++) if (this._board[r][c] === 0) holes++;
            this._owedGems[c] = holes;
        }
        this._render();
        this._fallTimer = setTimeout(() => this._fallStep(), FALL_STEP_MS);
    }

    // Animate the natural fall: step gravity one row at a time while new gems
    // stream in from the top of each column, then check for chains.
    _fallStep() {
        if (this._completed) return;
        const moved = _fallOneStep(this._board);
        const injected = this._injectTopGems();
        this._render();
        if (moved || injected) {
            this._fallTimer = setTimeout(() => this._fallStep(), FALL_STEP_MS);
        } else {
            this._fallTimer = null;
            this._chainTimer = setTimeout(() => this._chainStep(), FALL_DELAY);
        }
    }

    _checkNoMoves() {
        if (_hasAnyMove(this._board)) return;
        this._board = this._genBoard();
        this._noMovesMsg = true;
        this._render();
        this._noMovesTimer = setTimeout(() => {
            this._noMovesMsg = false;
            this._render();
            if (this._auto) this._scheduleAutoMove();
        }, 1200);
    }

    _clearTimers() {
        if (this._chainTimer) { clearTimeout(this._chainTimer); this._chainTimer = null; }
        if (this._fallTimer) { clearTimeout(this._fallTimer); this._fallTimer = null; }
        if (this._swapBackTimer) { clearTimeout(this._swapBackTimer); this._swapBackTimer = null; }
        if (this._noMovesTimer) { clearTimeout(this._noMovesTimer); this._noMovesTimer = null; }
        if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; }
    }

    _pause() {
        if (this._completed || this._resolving || this._reverting) return;
        this._paused = !this._paused;
        if (this._paused) this._clearTimers();
        else if (this._auto) this._scheduleAutoMove();
        this._render();
    }

    _moveCursor(dr, dc) {
        const nr = this._cursor.r + dr, nc = this._cursor.c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return;
        this._cursor.r = nr;
        this._cursor.c = nc;
        this._render();
    }

    _onKey(data) {

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (this._paused) {
            if (code === 0x1B) {
                const s = typeof data === 'string' ? data : '';
                if (s === '\x1B[A') return;
                if (s === '\x1B[B') return;
                if (s === '\x1B[C') return;
                if (s === '\x1B[D') return;
                if (s === '\x1B[3~') return;
                if (s === '\x1B[2~') return;
                if (s === '\x1B[H') return;
                if (s === '\x1B[F') return;
                if (s === '\x1B[5~') return;
                if (s === '\x1B[6~') return;
                if (s === '\x1B' || data === 0x1B) this._quit();
                return;
            }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'a') { this._toggleAuto(); return; }
                if (ch === 'p') { this._pause(); return; }
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

        if (this._resolving || this._reverting) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'a') { this._toggleAuto(); return; }
                if (ch === 'q') { this._quit(); return; }
            }
            return;
        }

        if (this._auto) {
            if (code === 0x03) { this._quit(); return; }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'a') { this._toggleAuto(); return; }
                if (ch === 'p') { this._pause(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
                if (ch === 'q') { this._quit(); return; }
            }
            return;
        }

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._selected ? this._trySwap(DIRS[0]) : this._moveCursor(-1, 0); return; }
            if (s === '\x1B[B') { this._selected ? this._trySwap(DIRS[1]) : this._moveCursor(1, 0); return; }
            if (s === '\x1B[D') { this._selected ? this._trySwap(DIRS[2]) : this._moveCursor(0, -1); return; }
            if (s === '\x1B[C') { this._selected ? this._trySwap(DIRS[3]) : this._moveCursor(0, 1); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
        }

        if (code === 0x20) {
            const { r, c } = this._cursor;
            if (this._selected && this._selected.r === r && this._selected.c === c) {
                this._selected = null;
            } else {
                this._selected = { r, c };
            }
            this._render();
            return;
        }

        if (code === 0x08 || code === 0x7F) return;

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'a') { this._toggleAuto(); return; }
            if (ch === 'p') { this._pause(); return; }
            if (ch === 'n') { this._pickDifficulty(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._clearTimers();
        this.placeShellCursor(BOARD_Y + BOARD_H);
        this.close();
    }

    onCancel() {
        this._quit();
    }


    static get commandName() { return META.commandName; }
    static get help() { return META.help; }
    static get menu() { return META.menu; }
    static get usage() { return META.usage; }
}

// Keep the command as the state owner and preserve class-method descriptors.
for (const methods of [renderMethods]) {
    for (const [name, value] of Object.entries(methods)) {
        Object.defineProperty(GweledCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { GweledCmd };
