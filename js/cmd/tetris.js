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

const PIECE_COLORS = { I: 51, O: 226, T: 129, S: 34, Z: 196, J: 21, L: 214 };
const PIECE_BG = { I: 51, O: 226, T: 129, S: 34, Z: 196, J: 21, L: 214 };

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

function _drawPreviewVB(vb, ry, rx, type, innerW, innerH, cells) {
    const shape = SHAPES[type][0];
    const pieceW = shape[0].length * 2;
    const pieceH = shape.length;
    const ox = Math.round((innerW - pieceW) / 2);
    const oy = Math.round((innerH - pieceH) / 2);
    let idx = 0;
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++) {
            const cell = cells[idx++];
            vb.setCell(ry + oy + r, rx + ox + c * 2, cell);
            vb.setCell(ry + oy + r, rx + ox + c * 2 + 1, cell);
        }
}

function _buildPreviewCells(type) {
    const shape = SHAPES[type][0];
    const bg = PIECE_BG[type], fg = PIECE_COLORS[type];
    const cells = [];
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++) {
            const filled = shape[r][c];
            cells.push({ ch: filled ? '\u2588' : ' ', fg: filled ? fg : 0, bg: filled ? bg : 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        }
    return cells;
}

/** Pre-render all static sidebar text into cell arrays (one-time cost). */
function _buildStaticSidebar() {
    const vb = new VirtualBuffer(SIDEBAR_W, BOARD_H);
    vb.writeStr(0, 0, bold(cyan('  Tetris')));
    vb.writeStr(1, 0, '┌──── Next ────┐');
    for (let r = 0; r < 4; r++) vb.writeStr(2 + r, 0, '│              │');
    vb.writeStr(6, 0, '└──────────────┘');
    vb.writeStr(7, 0, '┌──── Hold ────┐');
    for (let r = 0; r < 4; r++) vb.writeStr(8 + r, 0, '│              │');
    vb.writeStr(12, 0, '└──────────────┘');
    vb.writeStr(13, 0, gray('\u2500'.repeat(16)));
    // Rows 14–16 are dynamic (score/level/lines) — leave null
    vb.writeStr(17, 0, gray('\u2500'.repeat(16)));
    vb.writeStr(18, 0, gray(' \u2190\u2191\u2193\u2192 Move'));
    vb.writeStr(19, 0, gray(' Space  Drop'));
    vb.writeStr(20, 0, gray(' H Hold  P Pause'));
    vb.writeStr(21, 0, gray(' Q Quit'));
    // Snapshot: for each row, store only up to the last non-null cell
    const snapshot = [];
    for (let r = 0; r < BOARD_H; r++) {
        const row = vb._buffer[r];
        let end = row.length;
        while (end > 0 && row[end - 1] === null) end--;
        snapshot.push(row.slice(0, end));
    }
    return snapshot;
}

/** Pre-build pause frame border cells (yellow double-line box). */
function _buildPauseFrame(fw, fh) {
    const bc = (ch) => ({ ch, fg: 11, bg: 0, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
    const cells = [];
    for (let r = 0; r < fh; r++) {
        const row = new Array(fw).fill(null);
        if (r === 0) {
            row[0] = bc('\u2554');
            for (let c = 1; c < fw - 1; c++) row[c] = bc('\u2550');
            row[fw - 1] = bc('\u2557');
        } else if (r === fh - 1) {
            row[0] = bc('\u255A');
            for (let c = 1; c < fw - 1; c++) row[c] = bc('\u2550');
            row[fw - 1] = bc('\u255D');
        } else {
            row[0] = bc('\u2551');
            row[fw - 1] = bc('\u2551');
        }
        cells.push(row);
    }
    return cells;
}

/** Pre-build pause inner content cells (background + "PAUSED!" text). */
function _buildPauseInner(cw, ch) {
    const vb = new VirtualBuffer(cw, ch);
    const empty = { ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };
    for (let r = 0; r < ch; r++)
        for (let c = 0; c < cw; c++)
            vb._buffer[r][c] = empty;
    vb.writeStr(1, 2, '\x1B[1;37;44mPAUSED!\x1B[0m');
    return vb._buffer.map(row => row.slice());
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
        this._clearFlashCount = 0;
        this._flashTimeout = null;
        this._prevScore = -1;
        this._prevLevel = -1;
        this._prevLines = -1;
        this._prevNextType = null;
        this._prevHoldType = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);
            this._pauseFrameVB = new VirtualBuffer(14, 5);
            this._pauseInnerVB = new VirtualBuffer(12, 3);
        }

        const cell = (ch, fg, bg, bld, dim) => ({ ch, fg, bg, bold: bld, dim, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });

        if (!this._cellEmpty) {
            this._cellEmpty = cell(' ', 0, 0, false, false);
            this._cellBorder = cell('\u2551', 8, 0, false, false);
            this._cellGhostL = cell('\u2591', 8, 0, false, true);
            this._cellGhostR = cell('\u2591', 8, 0, false, true);

            this._boardPalette = new Array(256);
            for (let i = 0; i < 256; i++)
                this._boardPalette[i] = cell('\u2588', i, i, true, false);

            this._curCells = {};
            for (const type of Object.keys(PIECE_COLORS)) {
                const fg = PIECE_COLORS[type], bg = PIECE_BG[type];
                this._curCells[type] = [cell('\u2588', fg, bg, true, false), cell('\u2588', fg, bg, true, false)];
            }

            this._previewCells = {};
            for (const type of Object.keys(PIECE_COLORS))
                this._previewCells[type] = _buildPreviewCells(type);
        }

        // Pre-render static sidebar cells (only once)
        if (!this._sidebarStatic) {
            this._sidebarStatic = _buildStaticSidebar();
            this._pauseFrameCells = _buildPauseFrame(14, 5);
            this._pauseInnerCells = _buildPauseInner(12, 3);
        }

        // Pre-render static board border cells (only once)
        if (!this._borderTop) {
            const bvb = new VirtualBuffer(BOARD_W, 1);
            bvb.writeStr(0, 0, '\x1B[90m\u2554' + '\u2550'.repeat(BOARD_W - 2) + '\u2557');
            this._borderTop = bvb._buffer[0].slice();
            bvb.writeStr(0, 0, '\x1B[90m\u255A' + '\u2550'.repeat(BOARD_W - 2) + '\u255D');
            this._borderBottom = bvb._buffer[0].slice();
        }

        // Pre-render root empty-line cells (only once)
        if (!this._emptyLineCells) {
            const elvb = new VirtualBuffer(this._rootVB.width, 1);
            elvb.writeStr(0, 0, ' '.repeat(this._rootVB.width));
            this._emptyLineCells = elvb._buffer[0].slice();
        }

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
        this._render();
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
        const rootBuf = this._rootVB._buffer;
        const elc = this._emptyLineCells;
        for (let r = 0; r < this._rootVB.height; r++) {
            const row = rootBuf[r];
            for (let c = 0; c < row.length; c++) row[c] = elc[c];
        }
        this._rootVB._children.length = 0;
        this._prevScore = -1;
        this._prevLevel = -1;
        this._prevLines = -1;
        this._prevNextType = null;
        this._prevHoldType = null;
        this._renderSidebar();
        this._renderBoard();
    }

    _renderSidebar() {
        const vb = this._sidebarVB;
        const buf = vb._buffer;
        const ss = this._sidebarStatic;

        // Restore static cells from cache (no writeStr, no new objects)
        for (let r = 0; r < ss.length; r++) {
            const srcRow = ss[r];
            const dstRow = buf[r];
            for (let c = 0; c < srcRow.length; c++) dstRow[c] = srcRow[c];
            // Null out remaining columns
            for (let c = srcRow.length; c < vb.width; c++) dstRow[c] = null;
        }
        vb._children.length = 0;

        // Difficulty label (only once per game, but it's 1 writeStr — acceptable)
        if (this._difficulty) {
            vb.writeStr(0, 11, gray(DIFFICULTY[this._difficulty].label));
        }

        // Dynamic: Next piece preview
        const nextType = this._nextQueue.length > 0 ? this._nextQueue[0] : null;
        if (nextType)
            _drawPreviewVB(vb, 2, 1, nextType, 14, 4, this._previewCells[nextType]);

        // Dynamic: Hold piece preview
        if (this._holdType)
            _drawPreviewVB(vb, 8, 1, this._holdType, 14, 4, this._previewCells[this._holdType]);

        // Dynamic: Score / Level / Lines — only writeStr when value changed
        if (this._score !== this._prevScore) {
            vb.writeStr(14, 0, ' Score  ' + bold(yellow(String(this._score).padStart(8))));
            this._prevScore = this._score;
        }
        if (this._level !== this._prevLevel) {
            vb.writeStr(15, 0, ' Level  ' + bold(yellow(String(this._level).padStart(8))));
            this._prevLevel = this._level;
        }
        if (this._lines !== this._prevLines) {
            vb.writeStr(16, 0, ' Lines  ' + bold(yellow(String(this._lines).padStart(8))));
            this._prevLines = this._lines;
        }

        if (this._completed) {
            vb.writeStr(10, 1, bold(red(' GAME OVER ')));
            vb.writeStr(11, 1, gray('[n]ew [q]uit'));
        }
    }

    _renderBoard() {
        const vb = this._boardVB;
        const buf = vb._buffer;

        // Fill board area with empty cells (reuse pre-allocated cell)
        const ec = this._cellEmpty;
        for (let r = 0; r < BOARD_H; r++) {
            const row = buf[r];
            for (let c = 0; c < BOARD_W; c++) row[c] = ec;
        }

        // Board locked pieces
        const pal = this._boardPalette;
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) {
                const v = this._board[r][c];
                if (v !== 0) {
                    const flash = this._clearingRows && this._clearingRows.includes(r) && this._clearFlashCount % 2 === 1;
                    const cell = flash ? pal[15] : pal[v];
                    buf[1 + r][1 + c * 2] = cell;
                    buf[1 + r][2 + c * 2] = cell;
                }
            }

        // Current piece + ghost
        if (this._current && !this._completed && !this._paused) {
            const { type, rot, x, y } = this._current;
            const shape = SHAPES[type][rot];
            const [cl, cr] = this._curCells[type];
            for (let r = 0; r < shape.length; r++)
                for (let c = 0; c < shape[r].length; c++)
                    if (shape[r][c]) {
                        const ny = y + r, nx = x + c;
                        if (ny >= 0 && ny < ROWS) {
                            buf[1 + ny][1 + nx * 2] = cl;
                            buf[1 + ny][2 + nx * 2] = cr;
                        }
                    }

            const gy = _ghostY(this._board, type, rot, x, y);
            if (gy !== y) {
                const gl = this._cellGhostL, gr = this._cellGhostR;
                for (let r = 0; r < shape.length; r++)
                    for (let c = 0; c < shape[r].length; c++)
                        if (shape[r][c]) {
                            const ny = gy + r, nx = x + c;
                            if (ny >= 0 && ny < ROWS && this._board[ny][nx] === 0) {
                                buf[1 + ny][1 + nx * 2] = gl;
                                buf[1 + ny][2 + nx * 2] = gr;
                            }
                        }
            }
        }

        // Borders from pre-rendered caches (no writeStr, no new cells)
        const topRow = buf[0], btmRow = buf[BOARD_H - 1];
        const bt = this._borderTop, bb = this._borderBottom;
        for (let c = 0; c < BOARD_W; c++) {
            topRow[c] = bt[c];
            btmRow[c] = bb[c];
        }
        const bd = this._cellBorder;
        for (let r = 1; r < BOARD_H - 1; r++) {
            buf[r][0] = bd;
            buf[r][BOARD_W - 1] = bd;
        }

        if (this._paused) this._renderPauseOverlay(vb);

        // Reuse children array instead of creating new one
        this._rootVB._children.length = 0;
        this._rootVB.embed(this._sidebarVB, SIDEBAR_X, BOARD_Y);
        this._rootVB.embed(this._boardVB, BOARD_X, BOARD_Y);
        term.writeVB(this._rootVB);
    }

    _renderPauseOverlay(vb) {
        const fw = 14, fh = 5;
        const ox = Math.floor((BOARD_W - fw) / 2);
        const oy = Math.floor((BOARD_H - fh) / 2);

        // Restore frame cells from pre-built cache (no spreads, no new objects)
        const frame = this._pauseFrameVB;
        const frameBuf = frame._buffer;
        const fc = this._pauseFrameCells;
        for (let r = 0; r < fh; r++) {
            const srcRow = fc[r], dstRow = frameBuf[r];
            for (let c = 0; c < fw; c++) dstRow[c] = srcRow[c];
        }
        frame._children.length = 0;

        // Restore inner cells from pre-built cache
        const inner = this._pauseInnerVB;
        const innerBuf = inner._buffer;
        const ic = this._pauseInnerCells;
        for (let r = 0; r < 3; r++) {
            const srcRow = ic[r], dstRow = innerBuf[r];
            for (let c = 0; c < 12; c++) dstRow[c] = srcRow[c];
        }
        inner._children.length = 0;

        frame.embed(inner, 1, 1);
        vb.embed(frame, ox, oy);
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
