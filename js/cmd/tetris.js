import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, green, yellow, cyan, gray, CURSOR_HIDE } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

const COLS = 10;
const ROWS = 20;
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;

const BOARD_W = 22;
const BOARD_H = 22;
const BOARD_X = 2;
const BOARD_Y = 1;
const SIDEBAR_X = 30;
const SIDEBAR_W = 50;

const DIFFICULTY = {
    easy:   { level: 0, label: 'Easy' },
    medium: { level: 5, label: 'Medium' },
    hard:   { level: 9, label: 'Hard' },
};

const SHAPES = {
    I: [
        [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
        [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
        [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
        [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    ],
    O: [
        [[1,1],[1,1]],
        [[1,1],[1,1]],
        [[1,1],[1,1]],
        [[1,1],[1,1]],
    ],
    T: [
        [[0,1,0],[1,1,1],[0,0,0]],
        [[0,1,0],[0,1,1],[0,1,0]],
        [[0,0,0],[1,1,1],[0,1,0]],
        [[0,1,0],[1,1,0],[0,1,0]],
    ],
    S: [
        [[0,1,1],[1,1,0],[0,0,0]],
        [[0,1,0],[0,1,1],[0,0,1]],
        [[0,0,0],[0,1,1],[1,1,0]],
        [[1,0,0],[1,1,0],[0,1,0]],
    ],
    Z: [
        [[1,1,0],[0,1,1],[0,0,0]],
        [[0,0,1],[0,1,1],[0,1,0]],
        [[0,0,0],[1,1,0],[0,1,1]],
        [[0,1,0],[1,1,0],[1,0,0]],
    ],
    J: [
        [[1,0,0],[1,1,1],[0,0,0]],
        [[0,1,1],[0,1,0],[0,1,0]],
        [[0,0,0],[1,1,1],[0,0,1]],
        [[0,1,0],[0,1,0],[1,1,0]],
    ],
    L: [
        [[0,0,1],[1,1,1],[0,0,0]],
        [[0,1,0],[0,1,0],[0,1,1]],
        [[0,0,0],[1,1,1],[1,0,0]],
        [[1,1,0],[0,1,0],[0,1,0]],
    ],
};

const KICKS_3x3 = {
    '0>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '1>0': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '1>2': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '2>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '2>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '3>2': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '3>0': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '0>3': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
};

const KICKS_I = {
    '0>1': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    '1>0': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    '1>2': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
    '2>1': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    '2>3': [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
    '3>2': [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
    '3>0': [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
    '0>3': [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],
};

const PIECE_COLORS = { I: 14, O: 11, T: 5, S: 2, Z: 1, J: 4, L: 3 };
const PIECE_BG = { I: 4, O: 6, T: 5, S: 2, Z: 1, J: 4, L: 3 };

function _fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _createBoard() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS));
}

function _bag() {
    const b = ['I','O','T','S','Z','J','L'];
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
}

function _ghostY(board, type, rot, px, py) {
    let gy = py;
    while (_fits(board, type, rot, px, gy + 1)) gy++;
    return gy;
}

function _fits(board, type, rot, px, py) {
    const shape = SHAPES[type][rot];
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++)
            if (shape[r][c]) {
                const ny = py + r, nx = px + c;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
                if (ny < 0) continue;
                if (board[ny][nx]) return false;
            }
    return true;
}

function _hasCorner(board, type, px, py, dx, dy) {
    if (type === 'O') return true;
    const cx = px + 1, cy = py + 1;
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return true;
    return board[ny][nx] !== 0;
}

function _isTSpin(board, type, rot, px, py) {
    if (type !== 'T') return false;
    return _hasCorner(board, type, px, py, -1, -1) &&
           _hasCorner(board, type, px, py, 1, -1) &&
           _hasCorner(board, type, px, py, -1, 1) &&
           _hasCorner(board, type, px, py, 1, 1);
}

function _isTSpinMini(board, type, rot, px, py) {
    if (type !== 'T') return false;
    const frontDx = rot === 0 ? 0 : rot === 1 ? 1 : rot === 2 ? 0 : -1;
    const frontDy = rot === 0 ? -1 : rot === 1 ? 0 : rot === 2 ? 1 : 0;
    return _hasCorner(board, type, px, py, -1, -1) &&
           _hasCorner(board, type, px, py, 1, -1) &&
           _hasCorner(board, type, px, py, -1, 1) &&
           _hasCorner(board, type, px, py, 1, 1) &&
           !_hasCorner(board, type, px, py, frontDx, frontDy);
}

function _clearLines(board) {
    const full = [];
    for (let r = 0; r < ROWS; r++)
        if (board[r].every(c => c !== 0)) full.push(r);
    for (const r of full) {
        board.splice(r, 1);
        board.unshift(new Uint8Array(COLS));
    }
    return full.length;
}

function _drawPreviewVB(vb, ry, rx, type) {
    const shape = SHAPES[type][0];
    const bg = PIECE_BG[type];
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++) {
            const ch = shape[r][c] ? '\u2588' : ' ';
            const fg = shape[r][c] ? PIECE_COLORS[type] : 0;
            const bgr = shape[r][c] ? bg : 0;
            vb.setCell(ry + r, rx + c * 2, { ch, fg, bg: bgr, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
            vb.setCell(ry + r, rx + c * 2 + 1, { ch, fg, bg: bgr, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        }
}

export class TetrisCmd extends CmdBase {
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
        const dialog = new SelectDialog(term, {
            title: 'Tetris',
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
        this._board = _createBoard();
        this._score = 0;
        this._level = cfg.level;
        this._lines = 0;
        this._combo = -1;
        this._backToBack = false;
        this._holdType = null;
        this._holdUsed = false;
        this._nextQueue = [..._bag(), ..._bag()];
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
        this._clearFlashCount = 0;
        this._flashTimeout = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._rootVB = new VirtualBuffer(term.cols, term.rows);
        this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);

        this._spawn();
        this._render();
        this._startTimers();
    }

    _nextType() {
        if (this._nextQueue.length < 14)
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

    _rotate() {
        if (!this._current) return false;
        const { type, rot, x, y } = this._current;
        const newRot = (rot + 1) % 4;
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
        let dropped = 0;
        while (this._move(0, 1)) dropped++;
        this._score += dropped * 2;
        this._lock();
    }

    _softDrop() {
        if (this._move(0, 1)) {
            this._score += 1;
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
                        this._board[ny][nx] = PIECE_BG[type];
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
        const newLevel = Math.floor(this._lines / 10);
        if (newLevel > this._level) {
            this._level = newLevel;
            if (!this._paused && !this._completed) this._startGravity();
        }

        if (fullRows.length > 0) {
            this._clearingRows = fullRows;
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
        this._gravityInterval = setInterval(() => this._tick(),
            Math.max(80, 800 - this._level * 70));
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
        else this._startTimers();
        this._renderSidebar();
    }

    _gameOver() {
        this._completed = true;
        this._current = null;
        this._stopTimers();
        this._renderSidebar();
    }

    _onKey(data) {
        if (this._difficultyDialog) {
            this._difficultyDialog.handleKey(data);
            return;
        }

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
                this._quit(); return;
            }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'p' || ch === 'q') { if (ch === 'q') this._quit(); else this._pause(); return; }
            }
            return;
        }

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._rotate(); return; }
            if (s === '\x1B[B') { this._softDrop(); return; }
            if (s === '\x1B[D') { if (this._move(-1, 0)) this._renderBoard(); return; }
            if (s === '\x1B[C') { if (this._move(1, 0)) this._renderBoard(); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            this._quit(); return;
        }

        if (code === 0x20) { this._hardDrop(); return; }

        if (code === 0x08 || code === 0x7F) return;

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'h') { this._hold(); return; }
            if (ch === 'p') { this._pause(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    _render() {
        this._rootVB.clear();
        for (let r = 0; r < this._rootVB.height; r++)
            this._rootVB.writeStr(r, 0, ' '.repeat(this._rootVB.width));
        this._renderSidebar();
        this._renderBoard();
    }

    _renderSidebar() {
        const vb = this._sidebarVB;
        vb.clear();

        vb.writeStr(0, 0, bold(cyan('  Tetris')));
        if (this._difficulty) {
            vb.writeStr(0, 11, gray(DIFFICULTY[this._difficulty].label));
        }

        vb.writeStr(1, 0, '┌──── Next ────┐');
        for (let r = 0; r < 4; r++) vb.writeStr(2 + r, 0, '│              │');
        vb.writeStr(6, 0, '└──────────────┘');

        if (this._nextQueue.length > 0)
            _drawPreviewVB(vb, 2, 3, this._nextQueue[0]);

        vb.writeStr(7, 0, '┌──── Hold ────┐');
        for (let r = 0; r < 4; r++) vb.writeStr(8 + r, 0, '│              │');
        vb.writeStr(12, 0, '└──────────────┘');

        if (this._holdType)
            _drawPreviewVB(vb, 8, 3, this._holdType);

        vb.writeStr(13, 0, gray('\u2500'.repeat(16)));

        vb.writeStr(14, 0, ' Score  ' + bold(yellow(String(this._score).padStart(8))));
        vb.writeStr(15, 0, ' Level  ' + bold(yellow(String(this._level).padStart(8))));
        vb.writeStr(16, 0, ' Lines  ' + bold(yellow(String(this._lines).padStart(8))));

        vb.writeStr(17, 0, gray('\u2500'.repeat(16)));

        vb.writeStr(18, 0, gray(' \u2190\u2191\u2193\u2192 Move'));
        vb.writeStr(19, 0, gray(' Space  Drop'));
        vb.writeStr(20, 0, gray(' H Hold  P Pause'));
        vb.writeStr(21, 0, gray(' Q Quit'));

        if (this._paused) {
            vb.writeStr(10, 2, bold(yellow(' PAUSED ')));
        } else if (this._completed) {
            const msg = bold(red(' GAME OVER '));
            vb.writeStr(10, 1, msg);
            vb.writeStr(11, 1, gray('[n]ew [q]uit'));
        }

        this._rootVB.embed(this._sidebarVB, SIDEBAR_X, BOARD_Y);
    }

    _renderBoard() {
        const vb = this._boardVB;
        vb.clear();

        for (let r = 0; r < BOARD_H; r++)
            for (let c = 0; c < BOARD_W; c++)
                vb.setCell(r, c, { ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });

        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) {
                const v = this._board[r][c];
                if (v !== 0) {
                    const flash = this._clearingRows && this._clearingRows.includes(r) && this._clearFlashCount % 2 === 1;
                    const bg = v, fg = flash ? 15 : v;
                    vb.setCell(1 + r, 1 + c * 2, { ch: '\u2588', fg, bg, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                    vb.setCell(1 + r, 2 + c * 2, { ch: '\u2588', fg, bg, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                }
            }

        if (this._current && !this._completed && !this._paused) {
            const { type, rot, x, y } = this._current;
            const shape = SHAPES[type][rot];
            const bg = PIECE_BG[type], fg = PIECE_COLORS[type];
            for (let r = 0; r < shape.length; r++)
                for (let c = 0; c < shape[r].length; c++)
                    if (shape[r][c]) {
                        const ny = y + r, nx = x + c;
                        if (ny >= 0 && ny < ROWS) {
                            vb.setCell(1 + ny, 1 + nx * 2, { ch: '\u2588', fg, bg, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                            vb.setCell(1 + ny, 2 + nx * 2, { ch: '\u2588', fg, bg, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                        }
                    }

            const gy = _ghostY(this._board, type, rot, x, y);
            if (gy !== y) {
                for (let r = 0; r < shape.length; r++)
                    for (let c = 0; c < shape[r].length; c++)
                        if (shape[r][c]) {
                            const ny = gy + r, nx = x + c;
                            if (ny >= 0 && ny < ROWS && this._board[ny][nx] === 0) {
                                vb.setCell(1 + ny, 1 + nx * 2, { ch: '\u2591', fg: 8, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                                vb.setCell(1 + ny, 2 + nx * 2, { ch: '\u2591', fg: 8, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                            }
                        }
            }
        }

        vb.writeStr(0, 0, '\u2554' + '\u2550'.repeat(BOARD_W - 2) + '\u2557');
        for (let r = 1; r < BOARD_H - 1; r++) {
            vb.setCell(r, 0, { ch: '\u2551', fg: 8, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
            vb.setCell(r, BOARD_W - 1, { ch: '\u2551', fg: 8, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        }
        vb.writeStr(BOARD_H - 1, 0, '\u255A' + '\u2550'.repeat(BOARD_W - 2) + '\u255D');

        this._rootVB.embed(this._boardVB, BOARD_X, BOARD_Y);
        term.writeVB(this._rootVB);
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._stopTimers();
        term.write('\x1B[' + (BOARD_Y + BOARD_H + 1) + ';1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'tetris'; }
    static get help() { return 'Play Tetris'; }
    static get menu() { return 'Tetris'; }
    static get usage() { return 'tetris [--easy|--medium|--hard]'; }
}
