import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, yellow, cyan, gray, CURSOR_HIDE } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

const COLS = 6;
const ROWS = 12;
const LOCK_DELAY = 400;
const POP_DELAY = 300;
const FALL_DELAY = 250;
const FALL_STEP_MS = 40;

const BOARD_W = COLS * 2 + 2;
const BOARD_H = ROWS + 2;
const BOARD_X = 2;
const BOARD_Y = 1;
const SIDEBAR_X = 30;
const SIDEBAR_W = 50;

const DIFFICULTY = {
    easy:   { colors: 3, gravity: 900, label: 'Easy' },
    medium: { colors: 4, gravity: 650, label: 'Medium' },
    hard:   { colors: 5, gravity: 450, label: 'Hard' },
};

const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

// Tail offset from the pivot (top/left puyo) per rotation state.
const TAIL = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// Wall kicks tried in order when a rotation would collide.
const KICKS = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];

function _makeCell(ch, fg, bg, bold, width = 1) {
    return { ch, fg, bg, bold, dim: false, italic: false, underline: false,
             blink: false, inverse: false, conceal: false, crossedOut: false, width };
}

function _fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _createBoard() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS));
}

// Find all same-color groups of size >= 4.
function _findGroups(board) {
    const groups = [];
    const visited = new Set();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const color = board[r][c];
            if (color === 0 || visited.has(r * COLS + c)) continue;
            const cells = [];
            const stack = [[r, c]];
            visited.add(r * COLS + c);
            while (stack.length) {
                const [cr, cc] = stack.pop();
                cells.push([cr, cc]);
                for (let d = 0; d < 4; d++) {
                    const nr = cr + DIRS[d][0], nc = cc + DIRS[d][1];
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
                    const k = nr * COLS + nc;
                    if (board[nr][nc] === color && !visited.has(k)) {
                        visited.add(k);
                        stack.push([nr, nc]);
                    }
                }
            }
            if (cells.length >= 4) groups.push({ color, cells });
        }
    }
    return groups;
}

// One gravity step: every puyo with empty space directly below it falls one
// row down its column. Matches real Puyo Puyo — each puyo drops independently
// to the floor or on top of another puyo; no gaps can remain. The game calls
// this repeatedly (one row per tick) to animate the fall.
function _fallOneStep(board) {
    let moved = false;
    for (let c = 0; c < COLS; c++) {
        for (let r = ROWS - 2; r >= 0; r--) {
            if (board[r][c] !== 0 && board[r + 1][c] === 0) {
                board[r + 1][c] = board[r][c];
                board[r][c] = 0;
                moved = true;
            }
        }
    }
    return moved;
}

// Classic chain power table (chain 1=×1, 2=×8, 3=×16, ...).
function _chainMult(n) {
    const t = [0, 1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256];
    if (n < t.length) return t[n];
    return 256 + (n - t.length + 1) * 32;
}

function _calcChainScore(chain, popped, groups, colors) {
    const base = 10 * popped;
    const colorBonus = colors === 3 ? 3 : colors === 4 ? 6 : colors === 5 ? 10 : 0;
    const groupBonus = groups === 2 ? 3 : groups === 3 ? 6 : groups >= 4 ? 10 : 0;
    return (base + colorBonus * 10 + groupBonus * 10) * _chainMult(chain);
}

/** Pre-render all static sidebar text into cell arrays (one-time cost). */
function _buildStaticSidebar() {
    const vb = new VirtualBuffer(SIDEBAR_W, BOARD_H);
    vb.writeStr(0, 0, bold(cyan('  Puyo Puyo')));
    vb.writeStr(1, 0, '┌── Next ──┐');
    vb.writeStr(2, 0, '│          │');
    vb.writeStr(3, 0, '└──────────┘');
    vb.writeStr(4, 0, gray('─'.repeat(18)));
    // Rows 5–7 are dynamic (score/max chain/time) — leave null
    vb.writeStr(8, 0, gray('─'.repeat(18)));
    vb.writeStr(9, 0, gray(' ←→ Move  ↓ Soft'));
    vb.writeStr(10, 0, gray(' ↑/X Rotate CW'));
    vb.writeStr(11, 0, gray(' Z Rotate CCW'));
    vb.writeStr(12, 0, gray(' Space Hard Drop'));
    vb.writeStr(13, 0, gray(' P Pause  Q Quit'));
    const snapshot = [];
    for (let r = 0; r < BOARD_H; r++) {
        const row = vb._buffer[r];
        let end = row.length;
        while (end > 0 && row[end - 1] === null) end--;
        snapshot.push(row.slice(0, end));
    }
    return snapshot;
}

/** Pre-build an overlay frame border (double-line box). */
function _buildOverlayFrame(fw, fh, color) {
    const bc = (ch) => _makeCell(ch, color, 0, true);
    const cells = [];
    for (let r = 0; r < fh; r++) {
        const row = new Array(fw).fill(null);
        if (r === 0) {
            row[0] = bc('╔');
            for (let c = 1; c < fw - 1; c++) row[c] = bc('═');
            row[fw - 1] = bc('╗');
        } else if (r === fh - 1) {
            row[0] = bc('╚');
            for (let c = 1; c < fw - 1; c++) row[c] = bc('═');
            row[fw - 1] = bc('╝');
        } else {
            row[0] = bc('║');
            row[fw - 1] = bc('║');
        }
        cells.push(row);
    }
    return cells;
}

/** Pre-build overlay inner content cells (background + text). */
function _buildOverlayInner(cw, ch, text) {
    const vb = new VirtualBuffer(cw, ch);
    const e = _makeCell(' ', 0, 0, false);
    for (let r = 0; r < ch; r++)
        for (let c = 0; c < cw; c++)
            vb._buffer[r][c] = e;
    const tw = cw - 2;
    const tx = Math.floor((cw - tw) / 2);
    vb.writeStr(1, tx, text);
    return vb._buffer.map(row => row.slice());
}

/** Pre-build game over inner content cells (background + text). */
function _buildGameOverInner(cw, ch) {
    const vb = new VirtualBuffer(cw, ch);
    const e = _makeCell(' ', 0, 0, false);
    for (let r = 0; r < ch; r++)
        for (let c = 0; c < cw; c++)
            vb._buffer[r][c] = { ...e };
    const t1 = ' GAME OVER ';
    const t1x = Math.floor((cw - t1.length) / 2);
    vb.writeStr(1, t1x, '\x1B[1;31m' + t1 + '\x1B[0m');
    vb.writeStr(2, 1, '\x1B[31m' + '─'.repeat(cw - 2) + '\x1B[0m');
    const t2 = '[n]ew [q]uit';
    const t2x = Math.floor((cw - t2.length) / 2);
    vb.writeStr(3, t2x, '\x1B[90m' + t2 + '\x1B[0m');
    return vb._buffer.map(row => row.slice());
}

/** Pre-build a mutable 16-cell row for a dynamic stat line. */
function _buildDynRow(prefix) {
    const cells = [];
    for (let i = 0; i < 8; i++)
        cells.push(_makeCell(prefix[i] || ' ', 7, 0, false));
    for (let i = 0; i < 8; i++)
        cells.push(_makeCell(' ', 11, 0, true));
    return cells;
}

/** Write a numeric value into a pre-built dyn row and copy into a buffer row. */
function _writeDynRow(dstRow, cells, value) {
    const s = String(value).padStart(8);
    for (let i = 0; i < 8; i++) cells[8 + i].ch = s[i];
    for (let i = 0; i < 16; i++) dstRow[i] = cells[i];
}

export class PuyoCmd extends CmdBase {
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
            title: 'Puyo Puyo',
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
        dialog.open();
        this._difficultyDialog = dialog;
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

    _initVBs() {
        if (this._rootVB) {
            for (const vb of [this._rootVB, this._boardVB, this._sidebarVB]) {
                for (let r = 0; r < vb.height; r++) {
                    const row = vb._buffer[r];
                    for (let c = 0; c < vb.width; c++) row[c] = null;
                }
            }
        } else {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);

            // Pre-allocate fixed child slots — zero alloc per frame
            this._rootSlotBoard = this._rootVB.addChildSlot();
            this._rootSlotBoard.vb = this._boardVB;
            this._rootSlotBoard.x = BOARD_X;
            this._rootSlotBoard.y = BOARD_Y;
            this._rootSlotBoard.active = true;

            this._rootSlotSidebar = this._rootVB.addChildSlot();
            this._rootSlotSidebar.vb = this._sidebarVB;
            this._rootSlotSidebar.x = SIDEBAR_X;
            this._rootSlotSidebar.y = BOARD_Y;
            this._rootSlotSidebar.active = true;

            this._boardSlotPause = this._boardVB.addChildSlot();
            this._boardSlotPause.active = false;

            this._boardSlotGameOver = this._boardVB.addChildSlot();
            this._boardSlotGameOver.active = false;
        }

        if (!this._cellEmpty) {
            this._cellEmpty = _makeCell(' ', 0, 0, false);
            this._cellBorder = _makeCell('║', 8, 0, false);
            this._cellEmptyWide = { ch: '', fg: 0, bg: 0, bold: false, dim: false, italic: false,
                underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };

            this._palette = new Array(6);
            this._ghostCells = new Array(6);
            for (let c = 1; c <= 5; c++) {
                this._palette[c] = _makeCell('⬤', c, 0, true, 2);
                const g = _makeCell('⬤', c, 0, false, 2);
                g.dim = true;
                this._ghostCells[c] = g;
            }
            this._cellPop = _makeCell('⬤', 15, 0, true, 2);
        }

        if (!this._sidebarStatic) {
            this._sidebarStatic = _buildStaticSidebar();
            this._pauseFrameCells = _buildOverlayFrame(14, 5, 11);
            this._pauseInnerCells = _buildOverlayInner(12, 3, '\x1B[1;37;44m  PAUSED!  \x1B[0m');
            this._pauseFrameVB = new VirtualBuffer(14, 5);
            this._pauseInnerVB = new VirtualBuffer(12, 3);
            this._pauseSlotInner = this._pauseFrameVB.addChildSlot();
            this._pauseSlotInner.vb = this._pauseInnerVB;
            this._pauseSlotInner.x = 1;
            this._pauseSlotInner.y = 1;
            this._pauseSlotInner.active = true;

            this._gameOverFrameCells = _buildOverlayFrame(14, 6, 1);
            this._gameOverInnerCells = _buildGameOverInner(12, 4);
            this._gameOverFrameVB = new VirtualBuffer(14, 6);
            this._gameOverInnerVB = new VirtualBuffer(12, 4);
            this._gameOverSlotInner = this._gameOverFrameVB.addChildSlot();
            this._gameOverSlotInner.vb = this._gameOverInnerVB;
            this._gameOverSlotInner.x = 1;
            this._gameOverSlotInner.y = 1;
            this._gameOverSlotInner.active = true;

            this._dynScore = _buildDynRow(' Score  ');
            this._dynChain = _buildDynRow(' Chain  ');
            this._dynTime = _buildDynRow(' Time   ');
        }

        if (!this._borderTop) {
            const bvb = new VirtualBuffer(BOARD_W, 1);
            bvb.writeStr(0, 0, '\x1B[90m╔' + '═'.repeat(BOARD_W - 2) + '╗');
            this._borderTop = bvb._buffer[0].slice();
            bvb.writeStr(0, 0, '\x1B[90m╚' + '═'.repeat(BOARD_W - 2) + '╝');
            this._borderBottom = bvb._buffer[0].slice();
        }

        if (!this._emptyLineCells) {
            const elvb = new VirtualBuffer(this._rootVB.width, 1);
            elvb.writeStr(0, 0, ' '.repeat(this._rootVB.width));
            this._emptyLineCells = elvb._buffer[0].slice();
        }
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

        this._render();
        this._chainTimer = setTimeout(() => this._popAndFall(), POP_DELAY);
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
            this._quit(); return;
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

    _render() {
        const rootBuf = this._rootVB._buffer;
        const elc = this._emptyLineCells;
        for (let r = 0; r < this._rootVB.height; r++) {
            const row = rootBuf[r];
            for (let c = 0; c < row.length; c++) row[c] = elc[c];
        }
        this._renderSidebar();
        this._renderBoard();
    }

    _renderSidebar() {
        const vb = this._sidebarVB;
        const buf = vb._buffer;
        const ss = this._sidebarStatic;

        for (let r = 0; r < ss.length; r++) {
            const srcRow = ss[r];
            const dstRow = buf[r];
            for (let c = 0; c < srcRow.length; c++) dstRow[c] = srcRow[c];
            for (let c = srcRow.length; c < vb.width; c++) dstRow[c] = null;
        }

        vb.writeStr(0, 14, gray('[' + DIFFICULTY[this._difficulty].label + ']'));

        // Next pair preview (two wide circles side by side, centered in box)
        if (this._nextPair) {
            const cont = this._cellEmptyWide;
            buf[2][4] = this._palette[this._nextPair[0]];
            buf[2][5] = cont;
            buf[2][6] = this._palette[this._nextPair[1]];
            buf[2][7] = cont;
        }

        _writeDynRow(buf[5], this._dynScore, this._score);
        _writeDynRow(buf[6], this._dynChain, this._maxChain);
        _writeDynRow(buf[7], this._dynTime, _fmtTime(this._time));
    }

    _setPuyo(buf, x, y, color) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        buf[1 + y][1 + x * 2] = this._palette[color];
        buf[1 + y][1 + x * 2 + 1] = this._cellEmptyWide;
    }

    _setGhost(buf, x, y, color, occ) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        if (this._board[y][x] !== 0) return;
        if (occ && occ.has(y * COLS + x)) return;
        buf[1 + y][1 + x * 2] = this._ghostCells[color];
        buf[1 + y][1 + x * 2 + 1] = this._cellEmptyWide;
    }

    _renderBoard() {
        const vb = this._boardVB;
        const buf = vb._buffer;

        const ec = this._cellEmpty;
        for (let r = 0; r < BOARD_H; r++) {
            const row = buf[r];
            for (let c = 0; c < BOARD_W; c++) row[c] = ec;
        }

        // Locked puyos (popping cells flash white)
        const pal = this._palette;
        const cont = this._cellEmptyWide;
        const popWhite = this._cellPop;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const v = this._board[r][c];
                if (v !== 0) {
                    const popping = this._popping && this._popping.has(r * COLS + c);
                    const cell = popping ? popWhite : pal[v];
                    buf[1 + r][1 + c * 2] = cell;
                    buf[1 + r][1 + c * 2 + 1] = cont;
                }
            }
        }

        // Current pair + landing ghost (ghost shows the final settled spot of
        // each puyo after its own gravity fall — the two may be non-adjacent)
        if (this._current && !this._completed && !this._paused && !this._resolving) {
            const { colors, x, y, rot } = this._current;
            const tailX = x + TAIL[rot][0], tailY = y + TAIL[rot][1];
            this._setPuyo(buf, x, y, colors[0]);
            this._setPuyo(buf, tailX, tailY, colors[1]);

            const [ga, gb] = this._ghostLanding();
            const occ = new Set([y * COLS + x, tailY * COLS + tailX]);
            this._setGhost(buf, ga[1], ga[0], colors[0], occ);
            this._setGhost(buf, gb[1], gb[0], colors[1], occ);
        }

        // Borders from pre-rendered caches
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

        if (this._resolving && this._chain >= 2) this._renderChainOverlay(vb);

        if (this._paused) this._renderPauseOverlay(vb);
        else this._boardSlotPause.active = false;

        if (this._completed) this._renderGameOverOverlay(vb);
        else this._boardSlotGameOver.active = false;

        term.writeVB(this._rootVB);
    }

    _renderChainOverlay(vb) {
        const fw = BOARD_W;
        const oy = 3;
        const line1 = 'Chain ' + this._chain + '!';
        const line2 = '+' + this._lastChainScore;
        const p1 = fw - 2 - line1.length;
        const p2 = fw - 2 - line2.length;
        const c1 = ' '.repeat(Math.floor(p1 / 2)) + line1 + ' '.repeat(Math.ceil(p1 / 2));
        const c2 = ' '.repeat(Math.floor(p2 / 2)) + line2 + ' '.repeat(Math.ceil(p2 / 2));
        vb.writeStr(oy, 0, '\x1B[1;33m┌' + '─'.repeat(fw - 2) + '┐\x1B[0m');
        vb.writeStr(oy + 1, 0, '\x1B[1;33m│\x1B[0m' + c1 + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(oy + 2, 0, '\x1B[1;33m│\x1B[0m' + c2 + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(oy + 3, 0, '\x1B[1;33m└' + '─'.repeat(fw - 2) + '┘\x1B[0m');
    }

    _renderPauseOverlay() {
        const fw = 14, fh = 5;
        const ox = 0, oy = 4;

        const frame = this._pauseFrameVB;
        const frameBuf = frame._buffer;
        const fc = this._pauseFrameCells;
        for (let r = 0; r < fh; r++)
            for (let c = 0; c < fw; c++) frameBuf[r][c] = fc[r][c];

        const inner = this._pauseInnerVB;
        const innerBuf = inner._buffer;
        const ic = this._pauseInnerCells;
        for (let r = 0; r < 3; r++)
            for (let c = 0; c < 12; c++) innerBuf[r][c] = ic[r][c];

        const ps = this._boardSlotPause;
        ps.vb = frame;
        ps.x = ox;
        ps.y = oy;
        ps.active = true;
    }

    _renderGameOverOverlay() {
        const fw = 14, fh = 6;
        const ox = 0, oy = 4;

        const frame = this._gameOverFrameVB;
        const frameBuf = frame._buffer;
        const fc = this._gameOverFrameCells;
        for (let r = 0; r < fh; r++)
            for (let c = 0; c < fw; c++) frameBuf[r][c] = fc[r][c];

        const inner = this._gameOverInnerVB;
        const innerBuf = inner._buffer;
        const ic = this._gameOverInnerCells;
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 12; c++) innerBuf[r][c] = ic[r][c];

        const ps = this._boardSlotGameOver;
        ps.vb = frame;
        ps.x = ox;
        ps.y = oy;
        ps.active = true;
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

    static get commandName() { return 'puyo'; }
    static get help() { return 'Play Puyo Puyo'; }
    static get menu() { return 'Puyo Puyo'; }
    static get usage() { return 'puyo [--easy|--medium|--hard]'; }
}
