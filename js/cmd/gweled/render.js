import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import {
    SIDEBAR_W, SIDEBAR_H, BOARD_W, BOARD_H, BOARD_X, BOARD_Y, SIDEBAR_X, SIDEBAR_Y, DIFFICULTY,
    ROWS, COLS,
} from './constants.js';
import { bold, cyan, gray, makeCell, yellow } from '../../util/sgr.js';
import { term } from '../../system/sys.js';
import { buildStatRow as _buildDynRow, writeStatRow as _writeDynRow } from '../../util/stat-row.js';

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
    const bc = (ch) => makeCell(ch, color, 0, true);
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
    const e = makeCell(' ', 0, 0, false);
    for (let r = 0; r < ch; r++)
        for (let c = 0; c < cw; c++)
            vb._buffer[r][c] = e;
    const tw = cw - 2;
    const tx = Math.floor((cw - tw) / 2);
    vb.writeStr(1, tx, text);
    return vb._buffer.map(row => row.slice());
}

const renderMethods = {
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
            this._cellEmpty = makeCell(' ', 0, 0, false);
            this._cellBorder = makeCell('║', 8, 0, false);
            this._cellEmptyWide = { ch: '', fg: 0, bg: 0, bold: false, dim: false, italic: false,
                underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };

            this._palette = new Array(8);
            this._cursorCells = new Array(8);
            this._selCells = new Array(8);
            for (let c = 1; c <= 7; c++) {
                this._palette[c] = makeCell('⬤', c, 0, true, 2);
                this._cursorCells[c] = makeCell('⬤', c, 4, true, 2);
                this._selCells[c] = makeCell('⬤', c, 7, true, 2);
            }
            this._cellPop = makeCell('⬤', 15, 0, true, 2);
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

        vb.writeStr(6, 0, gray('[' + DIFFICULTY[this._difficulty].label + ']'));
        vb.writeStr(13, 0, this._auto ? bold(yellow(' [a]uto: ON')) : gray(' [a]uto: OFF'));

        _writeDynRow(buf[2], this._dynScore, this._score);
        _writeDynRow(buf[3], this._dynChain, this._chain);
        _writeDynRow(buf[4], this._dynBest, this._maxChain);
    },

    _setGem(buf, x, y, color) {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
        buf[1 + y][1 + x * 2] = this._palette[color];
        buf[1 + y][1 + x * 2 + 1] = this._cellEmptyWide;
    },

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
                else if (cur && cur.r === r && cur.c === c && !this._resolving && !this._auto) cell = curs[v];
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
    },

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
    },

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
};

export { renderMethods };
