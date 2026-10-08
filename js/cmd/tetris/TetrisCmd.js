import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE, yellow } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import {
    DIFFICULTY, COLS, ROWS, MAX_LOCK_RESETS, LOCK_DELAY, MIN_GRAVITY_INTERVAL,
    BASE_GRAVITY_INTERVAL, GRAVITY_DECAY, BOARD_Y, BOARD_H,
} from './constants.js';
import { _createBoard, _bag, _fits, _isTSpin, _isTSpinMini } from './board.js';
import { SHAPES, KICKS_I, KICKS_3x3, PIECE_COLORS } from './pieces.js';
import { renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.tetris;

class TetrisCmd extends CmdBase {
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
        const opts = ['Easy', 'Medium', 'Hard'];
        this._difficultyDialog = this.openDialog(SelectDialog, 'tetris-diff', {
            title: 'Tetris',
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
        this._board = _createBoard();
        this._score = 0;
        this._level = cfg.level;
        this._speedLevel = cfg.level;
        this._lines = 0;
        this._combo = -1;
        this._backToBack = false;
        this._holdType = null;
        this._holdUsed = false;
        this._nextQueue = [..._bag(), ..._bag(), ..._bag()];
        this._current = null;
        this._completed = false;
        this._paused = false;
        this._timer = 0;
        this._difficultyDialog = null;
        this._lockTimer = null;
        this._lockMoves = 0;
        this._lastWasRotation = false;
        this._timerInterval = null;
        this._clearingRows = null;
        this._clearingSet = null;
        this._clearFlashCount = 0;
        this._flashTimeout = null;
        this._prevNextType = null;
        this._prevHoldType = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._initVBs();

        this._spawn();
        this._render();
        this._startTimers();
    }

    _nextType() {
        if (this._nextQueue.length < 21)
            this._nextQueue.push(..._bag());
        return this._nextQueue.shift();
    }

    _spawn() {
        const type = this._nextType();
        const shape = SHAPES[type][0];
        const px = Math.floor((COLS - shape[0].length) / 2);
        const py = type === 'I' ? -1 : -1;
        if (!_fits(this._board, type, 0, px, py)) {
            this._gameOver();
            return;
        }
        this._current = { type, rot: 0, x: px, y: py };
        this._holdUsed = false;
        this._lastWasRotation = false;
        this._lockMoves = 0;
        this._clearLockTimer();
    }

    _hold() {
        if (this._holdUsed || !this._current) return;
        this._holdUsed = true;
        const type = this._current.type;
        if (this._holdType) {
            const prev = this._holdType;
            this._holdType = type;
            this._current = null;
            this._spawnWithType(prev);
        } else {
            this._holdType = type;
            this._current = null;
            this._spawn();
        }
        this._clearLockTimer();
        this._renderSidebar();
    }

    _spawnWithType(type) {
        const shape = SHAPES[type][0];
        const px = Math.floor((COLS - shape[0].length) / 2);
        if (!_fits(this._board, type, 0, px, -1)) {
            this._gameOver();
            return;
        }
        this._current = { type, rot: 0, x: px, y: -1 };
        this._lastWasRotation = false;
        this._lockMoves = 0;
    }

    _move(dx, dy) {
        if (!this._current) return false;
        const { type, rot, x, y } = this._current;
        if (_fits(this._board, type, rot, x + dx, y + dy)) {
            this._current.x += dx;
            this._current.y += dy;
            this._lastWasRotation = false;
            this._resetLockIfNeeded();
            return true;
        }
        return false;
    }

    _rotate(dir = 1) {
        if (!this._current) return false;
        const { type, rot, x, y } = this._current;
        const newRot = (rot + (dir < 0 ? 3 : 1)) % 4;
        if (type === 'O') return false;
        const kicks = type === 'I' ? KICKS_I : KICKS_3x3;
        const key = rot + '>' + newRot;
        const tests = kicks[key] || [[0,0]];
        for (const [kx, ky] of tests) {
            if (_fits(this._board, type, newRot, x + kx, y - ky)) {
                this._current.rot = newRot;
                this._current.x += kx;
                this._current.y -= ky;
                this._lastWasRotation = true;
                this._resetLockIfNeeded();
                this._renderBoard();
                return true;
            }
        }
        return false;
    }

    _hardDrop() {
        if (!this._current) return;
        while (this._move(0, 1));
        this._lock();
    }

    _softDrop() {
        if (this._move(0, 1)) {
            if (!this._fitsCurrent(0, 1)) this._startLockTimer();
            this._renderBoard();
        }
    }

    _fitsCurrent(dx, dy) {
        if (!this._current) return false;
        const { type, rot, x, y } = this._current;
        return _fits(this._board, type, rot, x + dx, y + dy);
    }

    _lock() {
        if (!this._current) return;
        const { type, rot, x, y } = this._current;
        const shape = SHAPES[type][rot];
        for (let r = 0; r < shape.length; r++)
            for (let c = 0; c < shape[r].length; c++)
                if (shape[r][c]) {
                    const ny = y + r, nx = x + c;
                    if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS)
                        this._board[ny][nx] = PIECE_COLORS[type];
                }

        const isTSpinFull = this._lastWasRotation && _isTSpin(this._board, type, rot, x, y);
        const isTSpinM = this._lastWasRotation && _isTSpinMini(this._board, type, rot, x, y);

        const fullRows = [];
        for (let r = 0; r < ROWS; r++)
            if (this._board[r].every(c => c !== 0)) fullRows.push(r);

        let tspin = false, tspinMini = false;
        if (isTSpinFull || isTSpinM) {
            tspin = true;
            tspinMini = isTSpinM && !isTSpinFull;
        }

        this._current = null;
        this._clearLockTimer();

        let b2b = false;
        if (fullRows.length > 0) {
            this._combo++;
            if (fullRows.length === 4 || tspin) {
                b2b = this._backToBack;
                this._backToBack = true;
            } else {
                this._backToBack = false;
            }
        } else {
            this._combo = -1;
        }

        this._score += this._calcScore(fullRows.length, tspin, tspinMini, b2b);
        this._lines += fullRows.length;
        const newLevel = DIFFICULTY[this._difficulty].level + Math.floor(this._lines / 10);
        if (newLevel > this._level) {
            this._level = newLevel;
            this._speedLevel = newLevel;
            if (!this._paused && !this._completed) this._startGravity();
        }

        if (fullRows.length > 0) {
            this._clearingRows = fullRows;
            this._clearingSet = new Set(fullRows);
            this._clearFlashCount = 0;
            this._flashRows();
        } else {
            this._spawn();
            this._render();
        }
    }

    _flashRows() {
        if (this._clearFlashCount >= 6) {
            for (const r of this._clearingRows) {
                this._board.splice(r, 1);
                this._board.unshift(new Uint8Array(COLS));
            }
            this._clearingRows = null;
            this._clearingSet = null;
            this._flashTimeout = null;
            this._spawn();
            this._render();
            return;
        }
        this._clearFlashCount++;
        this._renderBoard();
        this._flashTimeout = setTimeout(() => this._flashRows(), 80);
    }

    _calcScore(cleared, tspin, tspinMini, b2b) {
        const L = this._level + 1;
        let s = 0;

        if (tspin) {
            if (cleared === 0)     s = tspinMini ? 100 * L : 400 * L;
            else if (cleared === 1) s = tspinMini ? 200 * L : 800 * L;
            else if (cleared === 2) s = 1200 * L;
            else if (cleared === 3) s = 1600 * L;
        } else {
            if (cleared === 1) s = 40 * L;
            else if (cleared === 2) s = 100 * L;
            else if (cleared === 3) s = 300 * L;
            else if (cleared === 4) s = 1200 * L;
        }

        if (b2b && cleared > 0) s = Math.floor(s * 1.5);

        if (this._combo > 0) s += 50 * this._combo * L;

        return s;
    }

    _startLockTimer() {
        this._clearLockTimer();
        this._lockMoves++;
        if (this._lockMoves >= MAX_LOCK_RESETS) {
            this._lock();
            return;
        }
        this._lockTimer = setTimeout(() => this._lock(), LOCK_DELAY);
    }

    _clearLockTimer() {
        if (this._lockTimer) {
            clearTimeout(this._lockTimer);
            this._lockTimer = null;
        }
    }

    _resetLockIfNeeded() {
        if (this._current) {
            const { type, rot, x, y } = this._current;
            if (!_fits(this._board, type, rot, x, y + 1)) {
                this._startLockTimer();
            } else {
                this._clearLockTimer();
            }
        }
    }

    _tick() {
        if (this._completed || this._paused || !this._current) return;
        this._move(0, 1);
        this._renderBoard();
    }

    _startTimers() {
        this._stopTimers();
        this._timerInterval = setInterval(() => {
            if (this._completed || this._paused) return;
            this._timer++;
            this._renderSidebar();
        }, 1000);
        this._startGravity();
    }

    _startGravity() {
        if (this._gravityInterval) clearInterval(this._gravityInterval);
        const interval = Math.max(
            MIN_GRAVITY_INTERVAL,
            Math.round(BASE_GRAVITY_INTERVAL * Math.pow(GRAVITY_DECAY, this._speedLevel))
        );
        this._gravityInterval = setInterval(() => this._tick(), interval);
    }

    _stopTimers() {
        if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
        if (this._gravityInterval) { clearInterval(this._gravityInterval); this._gravityInterval = null; }
        this._clearLockTimer();
        if (this._flashTimeout) { clearTimeout(this._flashTimeout); this._flashTimeout = null; }
    }

    _pause() {
        if (this._completed) return;
        this._paused = !this._paused;
        if (this._paused) this._stopTimers();
        else {
            this._startTimers();
            if (this._clearingRows && !this._flashTimeout) this._flashRows();
        }
        this._render();
    }

    _gameOver() {
        this._completed = true;
        this._current = null;
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
                if (ch === 'p' || ch === 'q') { if (ch === 'q') this._quit(); else this._pause(); return; }
            }
            return;
        }

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._rotate(1); return; }
            if (s === '\x1B[B') { this._softDrop(); return; }
            if (s === '\x1B[D') { if (this._move(-1, 0)) this._renderBoard(); return; }
            if (s === '\x1B[C') { if (this._move(1, 0)) this._renderBoard(); return; }
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
            if (ch === 'h') { this._hold(); return; }
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
        Object.defineProperty(TetrisCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { TetrisCmd };
