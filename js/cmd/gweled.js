import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, yellow, cyan, gray, CURSOR_HIDE } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

const COLS = 8;
const ROWS = 8;
const FLASH_STEP_MS = 80;
const FLASH_CYCLES = 6;
const FALL_DELAY = 400;
const FALL_STEP_MS = 70;
const SWAP_BACK_MS = 250;

const BOARD_W = COLS * 2 + 2;
const BOARD_H = ROWS + 2;
const BOARD_X = 13;
const BOARD_Y = 7;
const SIDEBAR_X = 33;
const SIDEBAR_W = 34;
const SIDEBAR_H = 14;
const SIDEBAR_Y = 2;

const DIFFICULTY = {
    easy:   { colors: 5, label: 'Easy' },
    medium: { colors: 6, label: 'Medium' },
    hard:   { colors: 7, label: 'Hard' },
};

const DIRS = [
    { dr: -1, dc: 0 },  // up
    { dr: 1,  dc: 0 },  // down
    { dr: 0,  dc: -1 }, // left
    { dr: 0,  dc: 1 },  // right
];

function _makeCell(ch, fg, bg, bold, width = 1) {
    return { ch, fg, bg, bold, dim: false, italic: false, underline: false,
             blink: false, inverse: false, conceal: false, crossedOut: false, width };
}

function _createBoard() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS));
}

// Horizontal + vertical runs of >= 3 same-color gems.
function _findMatches(board) {
    const popped = new Set();
    const groups = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const color = board[r][c];
            if (color === 0) continue;
            let len = 1;
            while (c + len < COLS && board[r][c + len] === color) len++;
            if (len >= 3) {
                const cells = [];
                for (let i = 0; i < len; i++) {
                    cells.push([r, c + i]);
                    popped.add(r * COLS + c + i);
                }
                groups.push({ color, cells });
            }
            c += len - 1;
        }
    }
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            const color = board[r][c];
            if (color === 0) continue;
            let len = 1;
            while (r + len < ROWS && board[r + len][c] === color) len++;
            if (len >= 3) {
                const cells = [];
                for (let i = 0; i < len; i++) {
                    cells.push([r + i, c]);
                    popped.add((r + i) * COLS + c);
                }
                groups.push({ color, cells });
            }
            r += len - 1;
        }
    }
    return { popped, groups };
}

// One gravity step: every gem with empty space directly below it drops one row
// down its column. Returns true if anything moved.
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

// Does the run of `color` starting at (r,c) in direction (dr,dc) reach length 3
// when a gem of that color sits at the adjacent swap target?
function _lineLenThrough(board, r, c, dr, dc) {
    const color = board[r][c];
    let len = 1;
    for (let i = 1; ; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== color) break;
        len++;
    }
    for (let i = 1; ; i++) {
        const nr = r - dr * i, nc = c - dc * i;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== color) break;
        len++;
    }
    return len;
}

// Would swapping two adjacent cells create a match-3?
function _swapCreatesMatch(board, r1, c1, r2, c2) {
    const a = board[r1][c1], b = board[r2][c2];
    board[r1][c1] = b;
    board[r2][c2] = a;
    const horiz = _lineLenThrough(board, r1, c1, 0, 1) >= 3 ||
                  _lineLenThrough(board, r2, c2, 0, 1) >= 3;
    const vert = _lineLenThrough(board, r1, c1, 1, 0) >= 3 ||
                 _lineLenThrough(board, r2, c2, 1, 0) >= 3;
    board[r1][c1] = a;
    board[r2][c2] = b;
    return horiz || vert;
}

function _hasAnyMove(board) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (c + 1 < COLS && _swapCreatesMatch(board, r, c, r, c + 1)) return true;
            if (r + 1 < ROWS && _swapCreatesMatch(board, r, c, r + 1, c)) return true;
        }
    }
    return false;
}

// Classic chain power table (chain 1=×1, 2=×8, 3=×16, ...).
function _chainMult(n) {
    const t = [0, 1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256];
    if (n < t.length) return t[n];
    return 256 + (n - t.length + 1) * 32;
}

function _calcChainScore(chain, popped, groups, colors) {
    const base = 10 * popped;
    const colorBonus = colors === 5 ? 3 : colors === 6 ? 6 : colors === 7 ? 10 : 0;
    const groupBonus = groups === 2 ? 3 : groups === 3 ? 6 : groups >= 4 ? 10 : 0;
    return (base + colorBonus * 10 + groupBonus * 10) * _chainMult(chain);
}

/** Pre-render all static sidebar text into cell arrays (one-time cost). */
function _buildStaticSidebar() {
    const vb = new VirtualBuffer(SIDEBAR_W, SIDEBAR_H);
    vb.writeStr(0, 0, bold(cyan('  Gweled')));
    vb.writeStr(1, 0, gray('─'.repeat(18)));
    // Rows 2–4 are dynamic (score/chain/best) — leave null
    vb.writeStr(5, 0, gray('─'.repeat(18)));
    vb.writeStr(7, 0, gray('─'.repeat(18)));
    vb.writeStr(8, 0, gray(' ← ↑ ↓ → Move'));
    vb.writeStr(9, 0, gray(' Space Select'));
    vb.writeStr(10, 0, gray(' Arrows Swap'));
    vb.writeStr(11, 0, gray(' P Pause  N New'));
    vb.writeStr(12, 0, gray(' Q Quit'));
    const snapshot = [];
    for (let r = 0; r < SIDEBAR_H; r++) {
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

export class GweledCmd extends CmdBase {
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
        const opts = ['Easy', 'Medium', 'Hard'];
        const dialog = new SelectDialog(term, {
            title: 'Gweled',
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
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, SIDEBAR_H);

            this._rootSlotBoard = this._rootVB.addChildSlot();
            this._rootSlotBoard.vb = this._boardVB;
            this._rootSlotBoard.x = BOARD_X;
            this._rootSlotBoard.y = BOARD_Y;
            this._rootSlotBoard.active = true;

            this._rootSlotSidebar = this._rootVB.addChildSlot();
            this._rootSlotSidebar.vb = this._sidebarVB;
            this._rootSlotSidebar.x = SIDEBAR_X;
            this._rootSlotSidebar.y = SIDEBAR_Y;
            this._rootSlotSidebar.active = true;

            this._boardSlotPause = this._boardVB.addChildSlot();
            this._boardSlotPause.active = false;

            this._boardSlotChain = this._rootVB.addChildSlot();
            this._boardSlotChain.x = BOARD_X;
            this._boardSlotChain.y = BOARD_Y - 4;
            this._boardSlotChain.active = false;
        }

        if (!this._cellEmpty) {
            this._cellEmpty = _makeCell(' ', 0, 0, false);
            this._cellBorder = _makeCell('║', 8, 0, false);
            this._cellEmptyWide = { ch: '', fg: 0, bg: 0, bold: false, dim: false, italic: false,
                underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };

            this._palette = new Array(8);
            this._cursorCells = new Array(8);
            this._selCells = new Array(8);
            for (let c = 1; c <= 7; c++) {
                this._palette[c] = _makeCell('⬤', c, 0, true, 2);
                this._cursorCells[c] = _makeCell('⬤', c, 4, true, 2);
                this._selCells[c] = _makeCell('⬤', c, 7, true, 2);
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

            this._dynScore = _buildDynRow(' Score  ');
            this._dynChain = _buildDynRow(' Chain  ');
            this._dynBest = _buildDynRow(' Best   ');

            this._chainVB = new VirtualBuffer(BOARD_W, 4);
            this._boardSlotChain.vb = this._chainVB;
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
            }, SWAP_BACK_MS);
        }
    }

    _chainStep() {
        if (this._completed) return;
        const { groups, popped } = _findMatches(this._board);
        if (groups.length === 0) {
            this._resolving = false;
            this._popping = null;
            this._chain = 0;
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
        }, 1200);
    }

    _clearTimers() {
        if (this._chainTimer) { clearTimeout(this._chainTimer); this._chainTimer = null; }
        if (this._fallTimer) { clearTimeout(this._fallTimer); this._fallTimer = null; }
        if (this._swapBackTimer) { clearTimeout(this._swapBackTimer); this._swapBackTimer = null; }
        if (this._noMovesTimer) { clearTimeout(this._noMovesTimer); this._noMovesTimer = null; }
    }

    _pause() {
        if (this._completed || this._resolving || this._reverting) return;
        this._paused = !this._paused;
        if (this._paused) this._clearTimers();
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
        if (this._difficultyDialog) {
            this._difficultyDialog.handleKey(data);
            return;
        }

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
                this._quit(); return;
            }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'p') { this._pause(); return; }
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

        if (this._resolving || this._reverting) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
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
            this._quit(); return;
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
            if (ch === 'p') { this._pause(); return; }
            if (ch === 'n') { this._pickDifficulty(); return; }
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

        vb.writeStr(6, 0, gray('[' + DIFFICULTY[this._difficulty].label + ']'));

        _writeDynRow(buf[2], this._dynScore, this._score);
        _writeDynRow(buf[3], this._dynChain, this._chain);
        _writeDynRow(buf[4], this._dynBest, this._maxChain);
    }

    _setGem(buf, x, y, color) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        buf[1 + y][1 + x * 2] = this._palette[color];
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

        const cont = this._cellEmptyWide;
        const pal = this._palette;
        const curs = this._cursorCells;
        const sels = this._selCells;
        const popWhite = this._cellPop;
        const sel = this._selected;
        const cur = this._cursor;
        const popping = this._popping;
        const noMoves = this._noMovesMsg;

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const v = this._board[r][c];
                if (v === 0) continue;
                let cell = pal[v];
                if (popping && popping.has(r * COLS + c) && this._popFlashCount % 2 === 1) cell = popWhite;
                else if (sel && sel.r === r && sel.c === c) cell = sels[v];
                else if (cur && cur.r === r && cur.c === c && !this._resolving) cell = curs[v];
                buf[1 + r][1 + c * 2] = cell;
                buf[1 + r][1 + c * 2 + 1] = cont;
            }
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

        if (this._resolving && this._chain >= 2) this._renderChainOverlay();
        else this._boardSlotChain.active = false;

        if (noMoves) this._renderNoMovesOverlay(vb);

        if (this._paused) this._renderPauseOverlay(vb);
        else this._boardSlotPause.active = false;

        term.writeVB(this._rootVB);
    }

    _renderChainOverlay() {
        const vb = this._chainVB;
        const fw = BOARD_W;
        const line1 = 'Chain ' + this._chain + '!';
        const line2 = '+' + this._lastChainScore;
        const p1 = fw - 2 - line1.length;
        const p2 = fw - 2 - line2.length;
        const c1 = ' '.repeat(Math.floor(p1 / 2)) + line1 + ' '.repeat(Math.ceil(p1 / 2));
        const c2 = ' '.repeat(Math.floor(p2 / 2)) + line2 + ' '.repeat(Math.ceil(p2 / 2));
        vb.writeStr(0, 0, '\x1B[1;33m┌' + '─'.repeat(fw - 2) + '┐\x1B[0m');
        vb.writeStr(1, 0, '\x1B[1;33m│\x1B[0m' + c1 + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(2, 0, '\x1B[1;33m│\x1B[0m' + c2 + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(3, 0, '\x1B[1;33m└' + '─'.repeat(fw - 2) + '┘\x1B[0m');
        this._boardSlotChain.active = true;
    }

    _renderNoMovesOverlay(vb) {
        const fw = BOARD_W;
        const l1 = 'No moves!';
        const l2 = 'Reshuffling';
        const p1 = fw - 2 - l1.length;
        const p2 = fw - 2 - l2.length;
        const c1 = ' '.repeat(Math.floor(p1 / 2)) + l1 + ' '.repeat(Math.ceil(p1 / 2));
        const c2 = ' '.repeat(Math.floor(p2 / 2)) + l2 + ' '.repeat(Math.ceil(p2 / 2));
        const oy = 2;
        vb.writeStr(oy, 0, '\x1B[1;34m┌' + '─'.repeat(fw - 2) + '┐\x1B[0m');
        vb.writeStr(oy + 1, 0, '\x1B[1;34m│\x1B[0m' + c1 + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(oy + 2, 0, '\x1B[1;34m│\x1B[0m' + c2 + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(oy + 3, 0, '\x1B[1;34m└' + '─'.repeat(fw - 2) + '┘\x1B[0m');
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

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._clearTimers();
        term.write('\x1B[' + (BOARD_Y + BOARD_H + 1) + ';1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'gweled'; }
    static get help() { return 'Play Gweled'; }
    static get menu() { return 'Gweled'; }
    static get usage() { return 'gweled [--easy|--medium|--hard]'; }
}
