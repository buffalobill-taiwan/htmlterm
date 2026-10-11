import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE } from '../../util/sgr.js';
import { FieldPickerDialog } from '../../dialog/FieldPickerDialog.js';
import {
    DIFFICULTY, COLS, ROWS, TAIL, KICKS, FALL_STEP_MS, FLASH_CYCLES, FLASH_STEP_MS, FALL_DELAY,
    LOCK_DELAY, BOARD_Y, BOARD_H,
} from './constants.js';
import { _createBoard, _findGroups, _calcChainScore, _fallOneStep } from './board.js';
import { renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.puyo;

class PuyoCmd extends CmdBase {
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
        this._difficulty = null;
        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._difficultyDialog = this.openDialog(FieldPickerDialog, 'puyo-diff', {
            title: 'Puyo Puyo',
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
        this._board = _createBoard();
        this._score = 0;
        this._maxChain = 0;
        this._time = 0;
        this._completed = false;
        this._paused = false;
        this._resolving = false;
        this._chain = 0;
        this._lastChainScore = 0;
        this._popping = null;
        this._popFlashCount = 0;
        this._current = null;
        this._lockTimer = null;
        this._chainTimer = null;
        this._fallTimer = null;
        this._timerInterval = null;
        this._gravityInterval = null;
        this._difficultyDialog = null;
        this._colorPool = [1, 2, 3, 4, 5].slice(0, cfg.colors);

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._initVBs();
        this._nextPair = this._genPair();
        this._spawn();
        if (!this._completed) this._startTimers();
    }

    _genPair() {
        const pool = this._colorPool;
        const n = pool.length;
        return [pool[Math.floor(Math.random() * n)], pool[Math.floor(Math.random() * n)]];
    }

    _spawn() {
        this._current = { colors: this._nextPair, rot: 0, x: 2, y: 0 };
        this._nextPair = this._genPair();
        if (!this._fitsAt(2, 0, 0)) {
            this._gameOver();
            return;
        }
        this._render();
    }

    _fitCell(x, y) {
        if (x < 0 || x >= COLS) return false;
        if (y < 0) return true;
        if (y >= ROWS) return false;
        return this._board[y][x] === 0;
    }

    _fitsAt(x, y, rot) {
        if (!this._fitCell(x, y)) return false;
        return this._fitCell(x + TAIL[rot][0], y + TAIL[rot][1]);
    }

    _canMoveDown() {
        const { x, y, rot } = this._current;
        return this._fitsAt(x, y + 1, rot);
    }

    // Final landing positions accounting for post-lock gravity. The pair
    // drops as a rigid unit to its lowest fitting row, but an unsupported
    // puyo keeps falling independently (see _lock / _hasFloatingPuyo), so the
    // two may settle non-adjacent. Simulates on a scratch board and returns
    // the settled [row, col] of each puyo.
    _ghostLanding() {
        const { colors, x, y, rot } = this._current;
        const tailX = x + TAIL[rot][0];
        let gy = y;
        while (this._fitsAt(x, gy + 1, rot)) gy++;
        const tailY = gy + TAIL[rot][1];

        const sim = _createBoard();
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) sim[r][c] = this._board[r][c];
        const a = [gy, x];
        const b = [tailY, tailX];
        sim[a[0]][a[1]] = colors[0];
        sim[b[0]][b[1]] = colors[1];

        let moved = true;
        while (moved) {
            moved = false;
            const spots = [a, b];
            for (let i = 0; i < 2; i++) {
                const p = spots[i];
                if (p[0] + 1 >= ROWS) continue;
                if (sim[p[0] + 1][p[1]] === 0) {
                    sim[p[0]][p[1]] = 0;
                    p[0]++;
                    sim[p[0]][p[1]] = colors[i];
                    moved = true;
                }
            }
        }
        return [a, b];
    }

    _move(dx) {
        if (!this._current || this._resolving) return;
        const { x, y, rot } = this._current;
        if (this._fitsAt(x + dx, y, rot)) {
            this._current.x += dx;
            this._render();
        }
    }

    _rotate(dir) {
        if (!this._current || this._resolving) return;
        const { x, y, rot } = this._current;
        const newRot = (rot + dir + 4) % 4;
        for (let i = 0; i < KICKS.length; i++) {
            const [kx, ky] = KICKS[i];
            if (this._fitsAt(x + kx, y + ky, newRot)) {
                this._current.x += kx;
                this._current.y += ky;
                this._current.rot = newRot;
                this._render();
                return;
            }
        }
    }

    _softDrop() {
        if (!this._current || this._resolving) return;
        if (this._canMoveDown()) {
            this._current.y++;
            this._clearLockTimer();
            this._render();
        } else {
            this._startLockTimer();
        }
    }

    _hardDrop() {
        if (!this._current || this._resolving) return;
        while (this._canMoveDown()) this._current.y++;
        this._lock();
    }

    _lock() {
        if (!this._current || this._resolving) return;
        const { colors, x, y, rot } = this._current;
        const spots = [
            [x, y, colors[0]],
            [x + TAIL[rot][0], y + TAIL[rot][1], colors[1]],
        ];
        for (let i = 0; i < 2; i++) {
            const [cx, cy, col] = spots[i];
            if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) this._board[cy][cx] = col;
        }
        this._current = null;
        this._clearLockTimer();
        // A rigid pair stops when EITHER puyo is blocked, so a horizontal pair
        // can rest with one puyo hanging over a gap. Puyos never float: an
        // unsupported puyo keeps falling independently to the bottom or on top
        // of another puyo (animated via the same _fallStep pipeline), then
        // chain detection runs.
        if (this._hasFloatingPuyo()) {
            this._resolving = true;
            this._chain = 0;
            this._lastChainScore = 0;
            this._render();
            this._fallTimer = setTimeout(() => this._fallStep(), FALL_STEP_MS);
        } else {
            this._startChainResolve();
        }
    }

    _hasFloatingPuyo() {
        for (let r = 0; r < ROWS - 1; r++)
            for (let c = 0; c < COLS; c++)
                if (this._board[r][c] !== 0 && this._board[r + 1][c] === 0) return true;
        return false;
    }

    _startChainResolve() {
        this._resolving = true;
        this._chain = 0;
        this._lastChainScore = 0;
        this._chainTimer = setTimeout(() => this._chainStep(), 150);
    }

    _chainStep() {
        if (this._completed) return;
        const groups = _findGroups(this._board);
        if (groups.length === 0) {
            this._resolving = false;
            this._popping = null;
            this._chain = 0;
            this._spawn();
            return;
        }
        this._chain++;
        if (this._chain > this._maxChain) this._maxChain = this._chain;

        let popped = 0;
        const colors = new Set();
        const popping = new Set();
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            popped += g.cells.length;
            colors.add(g.color);
            for (let j = 0; j < g.cells.length; j++)
                popping.add(g.cells[j][0] * COLS + g.cells[j][1]);
        }
        this._lastChainScore = _calcChainScore(this._chain, popped, groups.length, colors.size);
        this._score += this._lastChainScore;
        this._popping = popping;

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
        this._render();
        this._fallTimer = setTimeout(() => this._fallStep(), FALL_STEP_MS);
    }

    // Animate the natural fall: step gravity one row at a time until every
    // puyo has settled, then check for chains.
    _fallStep() {
        if (this._completed) return;
        const moved = _fallOneStep(this._board);
        this._render();
        if (moved) {
            this._fallTimer = setTimeout(() => this._fallStep(), FALL_STEP_MS);
        } else {
            this._fallTimer = null;
            this._chainTimer = setTimeout(() => this._chainStep(), FALL_DELAY);
        }
    }

    _tick() {
        if (this._completed || this._paused || this._resolving || !this._current) return;
        if (this._canMoveDown()) {
            this._current.y++;
            this._clearLockTimer();
            this._render();
        } else {
            this._startLockTimer();
        }
    }

    _startLockTimer() {
        if (this._lockTimer) return;
        this._lockTimer = setTimeout(() => this._lock(), LOCK_DELAY);
    }

    _clearLockTimer() {
        if (this._lockTimer) {
            clearTimeout(this._lockTimer);
            this._lockTimer = null;
        }
    }

    _startTimers() {
        this._stopTimers();
        this._timerInterval = setInterval(() => {
            if (this._completed || this._paused) return;
            this._time++;
            this._render();
        }, 1000);
        this._startGravity();
    }

    _startGravity() {
        if (this._gravityInterval) clearInterval(this._gravityInterval);
        this._gravityInterval = setInterval(() => this._tick(),
            DIFFICULTY[this._difficulty].gravity);
    }

    _stopTimers() {
        if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
        if (this._gravityInterval) { clearInterval(this._gravityInterval); this._gravityInterval = null; }
        this._clearLockTimer();
        if (this._chainTimer) { clearTimeout(this._chainTimer); this._chainTimer = null; }
        if (this._fallTimer) { clearTimeout(this._fallTimer); this._fallTimer = null; }
    }

    _pause() {
        if (this._completed || this._resolving) return;
        this._paused = !this._paused;
        if (this._paused) this._stopTimers();
        else this._startTimers();
        this._render();
    }

    _gameOver() {
        this._completed = true;
        this._current = null;
        this._resolving = false;
        this._popping = null;
        this._stopTimers();
        this._render();
    }

    _onKey(data) {

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x03) { this._quit(); return; }

        if (this._completed) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

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
                if (ch === 'p') { this._pause(); return; }
                if (ch === 'q') { this._quit(); return; }
            }
            return;
        }

        if (this._resolving) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
            }
            return;
        }

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._rotate(1); return; }
            if (s === '\x1B[B') { this._softDrop(); return; }
            if (s === '\x1B[D') { this._move(-1); return; }
            if (s === '\x1B[C') { this._move(1); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
        }

        if (code === 0x20) { this._hardDrop(); return; }

        if (code === 0x08 || code === 0x7F) return;

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'z') { this._rotate(-1); return; }
            if (ch === 'x') { this._rotate(1); return; }
            if (ch === 'p') { this._pause(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._stopTimers();
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
        Object.defineProperty(PuyoCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { PuyoCmd };
