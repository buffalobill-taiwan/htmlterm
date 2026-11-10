import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import {
    SIDEBAR_W, BOARD_H, BOARD_W, BOARD_X, BOARD_Y, SIDEBAR_X, DIFFICULTY, ROWS, COLS, TAIL,
} from './constants.js';
import { bold, cyan, gray, makeCell } from '../../util/sgr.js';
import { term } from '../../system/sys.js';
import { buildStatRow as _buildDynRow, writeStatRow as _writeDynRow } from '../../util/stat-row.js';
import { formatDuration } from '../../util/format.js';
import { buildFrameCells, buildTextInner, buildGameOverInner } from '../../util/overlay-frame.js';

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
    return vb.snapshotRows();
}

const renderMethods = {
    _initVBs() {
        if (this._rootVB) {
            for (const vb of [this._rootVB, this._boardVB, this._sidebarVB]) vb.clearCells();
        } else {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);

            // Pre-allocate fixed child slots — zero alloc per frame
            this._rootSlotBoard = this._rootVB.attach(this._boardVB, BOARD_X, BOARD_Y);
            this._rootSlotSidebar = this._rootVB.attach(this._sidebarVB, SIDEBAR_X, BOARD_Y);
            this._boardSlotPause = this._boardVB.addChildSlot();
            this._boardSlotGameOver = this._boardVB.addChildSlot();
        }

        if (!this._cellEmpty) {
            this._cellEmpty = makeCell(' ', 0, 0, false);
            this._cellBorder = makeCell('║', 8, 0, false);
            this._cellEmptyWide = { ch: '', fg: 0, bg: 0, bold: false, dim: false, italic: false,
                underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };

            this._palette = new Array(6);
            this._ghostCells = new Array(6);
            for (let c = 1; c <= 5; c++) {
                this._palette[c] = makeCell('⬤', c, 0, true, 2);
                const g = makeCell('⬤', c, 0, false, 2);
                g.dim = true;
                this._ghostCells[c] = g;
            }
            this._cellPop = makeCell('⬤', 15, 0, true, 2);
        }

        if (!this._sidebarStatic) {
            this._sidebarStatic = _buildStaticSidebar();
            this._pauseFrameCells = buildFrameCells(14, 5, 11);
            this._pauseInnerCells = buildTextInner(12, 3, '\x1B[1;37;44m  PAUSED!  \x1B[0m');
            this._pauseFrameVB = new VirtualBuffer(14, 5);
            this._pauseInnerVB = new VirtualBuffer(12, 3);
            this._pauseSlotInner = this._pauseFrameVB.attach(this._pauseInnerVB, 1, 1);

            this._gameOverFrameCells = buildFrameCells(14, 6, 1);
            this._gameOverInnerCells = buildGameOverInner(12, 4);
            this._gameOverFrameVB = new VirtualBuffer(14, 6);
            this._gameOverInnerVB = new VirtualBuffer(12, 4);
            this._gameOverSlotInner = this._gameOverFrameVB.attach(this._gameOverInnerVB, 1, 1);

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
    },

    _render() {
        const rootBuf = this._rootVB._buffer;
        const elc = this._emptyLineCells;
        for (let r = 0; r < this._rootVB.height; r++) {
            const row = rootBuf[r];
            for (let c = 0; c < row.length; c++) row[c] = elc[c];
        }
        this._renderSidebar();
        this._renderBoard();
    },

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
        _writeDynRow(buf[7], this._dynTime, formatDuration(this._time));
    },

    _setPuyo(buf, x, y, color) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        buf[1 + y][1 + x * 2] = this._palette[color];
        buf[1 + y][1 + x * 2 + 1] = this._cellEmptyWide;
    },

    _setGhost(buf, x, y, color, occ) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        if (this._board[y][x] !== 0) return;
        if (occ && occ.has(y * COLS + x)) return;
        buf[1 + y][1 + x * 2] = this._ghostCells[color];
        buf[1 + y][1 + x * 2 + 1] = this._cellEmptyWide;
    },

    _renderBoard() {
        const vb = this._boardVB;
        const buf = vb._buffer;

        vb.fill(this._cellEmpty);

        // Locked puyos (popping cells flash white)
        const pal = this._palette;
        const cont = this._cellEmptyWide;
        const popWhite = this._cellPop;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const v = this._board[r][c];
                if (v !== 0) {
                    const popping = this._popping && this._popping.has(r * COLS + c) && this._popFlashCount % 2 === 1;
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
    },

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
    },

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
    },

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
    },
};

export { renderMethods };
