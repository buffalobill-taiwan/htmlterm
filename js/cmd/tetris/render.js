import { SHAPES, PIECE_BG, PIECE_COLORS } from './pieces.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import {
    SIDEBAR_W, BOARD_H, BOARD_W, SIDEBAR_X, BOARD_Y, BOARD_X, DIFFICULTY, ROWS, COLS,
} from './constants.js';
import { bold, cyan, gray, yellow } from '../../util/sgr.js';
import { term } from '../../system/sys.js';
import { buildStatRow as _buildDynRow, writeStatRow as _writeDynRow } from '../../util/stat-row.js';
import { buildFrameCells, buildTextInner, buildGameOverInner } from '../../util/overlay-frame.js';
import { _ghostY } from './board.js';

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
            cells.push({ ch: filled ? '█' : ' ', fg: filled ? fg : 0, bg: filled ? bg : 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
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
    vb.writeStr(13, 0, gray('─'.repeat(16)));
    // Rows 14–16 are dynamic (score/level/lines) — leave null
    vb.writeStr(17, 0, gray('─'.repeat(16)));
    vb.writeStr(18, 0, gray(' ←↑↓→ Move  Z/X'));
    vb.writeStr(19, 0, gray(' Space  Drop'));
    vb.writeStr(20, 0, gray(' H Hold  P Pause'));
    vb.writeStr(21, 0, gray(' Q Quit'));
    return vb.snapshotRows();
}

const renderMethods = {
    _initVBs() {
        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);
            this._pauseFrameVB = new VirtualBuffer(14, 5);
            this._pauseInnerVB = new VirtualBuffer(12, 3);
            this._gameOverFrameVB = new VirtualBuffer(16, 6);
            this._gameOverInnerVB = new VirtualBuffer(14, 4);

            // Pre-allocate fixed child slots — zero alloc per frame
            // rootVB slots: [0]=sidebarVB, [1]=boardVB
            this._rootSlotSidebar = this._rootVB.attach(this._sidebarVB, SIDEBAR_X, BOARD_Y);
            this._rootSlotBoard = this._rootVB.attach(this._boardVB, BOARD_X, BOARD_Y);

            // boardVB slots for overlays, activated only when needed
            this._boardSlotPause = this._boardVB.addChildSlot();
            this._boardSlotGameOver = this._boardVB.addChildSlot();

            // frame slots for inner content
            this._pauseSlotInner = this._pauseFrameVB.attach(this._pauseInnerVB, 1, 1);
            this._gameOverSlotInner = this._gameOverFrameVB.attach(this._gameOverInnerVB, 1, 1);
        }

        const cell = (ch, fg, bg, bld, dim) => ({ ch, fg, bg, bold: bld, dim, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });

        if (!this._cellEmpty) {
            this._cellEmpty = cell(' ', 0, 0, false, false);
            this._cellBorder = cell('║', 8, 0, false, false);
            this._cellGhostL = cell('░', 8, 0, false, true);
            this._cellGhostR = cell('░', 8, 0, false, true);

            this._boardPalette = new Array(256);
            for (let i = 0; i < 256; i++)
                this._boardPalette[i] = cell('█', i, i, true, false);

            this._curCells = {};
            for (const type of Object.keys(PIECE_COLORS)) {
                const fg = PIECE_COLORS[type], bg = PIECE_BG[type];
                this._curCells[type] = [cell('█', fg, bg, true, false), cell('█', fg, bg, true, false)];
            }

            this._previewCells = {};
            for (const type of Object.keys(PIECE_COLORS))
                this._previewCells[type] = _buildPreviewCells(type);
        }

        // Pre-render static sidebar cells (only once)
        if (!this._sidebarStatic) {
            this._sidebarStatic = _buildStaticSidebar();
            this._pauseFrameCells = buildFrameCells(14, 5, 11);
            this._pauseInnerCells = buildTextInner(12, 3, '\x1B[1;37;44mPAUSED!\x1B[0m', { x: 2 });
            this._gameOverFrameCells = buildFrameCells(16, 6, 1);
            this._gameOverInnerCells = buildGameOverInner(14, 4);
            // Pre-build mutable cell rows for score/level/lines (avoid makeCell each update)
            this._dynScore = _buildDynRow(' Score  ');
            this._dynSpeed = _buildDynRow(' Speed  ');
            this._dynLines = _buildDynRow(' Lines  ');
        }

        // Pre-render static board border cells (only once)
        if (!this._borderTop) {
            const bvb = new VirtualBuffer(BOARD_W, 1);
            bvb.writeStr(0, 0, '\x1B[90m╔' + '═'.repeat(BOARD_W - 2) + '╗');
            this._borderTop = bvb._buffer[0].slice();
            bvb.writeStr(0, 0, '\x1B[90m╚' + '═'.repeat(BOARD_W - 2) + '╝');
            this._borderBottom = bvb._buffer[0].slice();
        }

        // Pre-render root empty-line cells (only once)
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
        this._prevNextType = null;
        this._prevHoldType = null;
        this._renderSidebar();
        this._renderBoard();
    },

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

        // Dynamic: Score / Speed / Lines — always re-write (static restore nulls these rows)
        _writeDynRow(buf[14], this._dynScore, this._score);
        let sp = this._speedLevel + 1;
        if (sp >= 30) {
            const text = ' Speed   30 (max)';
            vb.writeStr(15, 1, yellow(text));
        } else {
            _writeDynRow(buf[15], this._dynSpeed, sp);
        }
        _writeDynRow(buf[16], this._dynLines, this._lines);
    },

    _renderBoard() {
        const vb = this._boardVB;
        const buf = vb._buffer;

        // Fill board area with empty cells (reuse pre-allocated cell)
        vb.fill(this._cellEmpty);

        // Board locked pieces
        const pal = this._boardPalette;
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) {
                const v = this._board[r][c];
                if (v !== 0) {
                    const flash = this._clearingSet && this._clearingSet.has(r) && this._clearFlashCount % 2 === 1;
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
                const dy = gy - y;
                for (let r = 0; r < shape.length; r++)
                    for (let c = 0; c < shape[r].length; c++)
                        if (shape[r][c]) {
                            const ny = gy + r, nx = x + c;
                            if (ny >= 0 && ny < ROWS && this._board[ny][nx] === 0) {
                                const cr = r + dy;
                                if (cr >= 0 && cr < shape.length && shape[cr][c]) continue;
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
        else this._boardSlotPause.active = false;

        if (this._completed) this._renderGameOverOverlay(vb);
        else this._boardSlotGameOver.active = false;

        // Slots were pre-allocated at init — no embed() / push needed
        term.writeVB(this._rootVB);
    },

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

        // Restore inner cells from pre-built cache
        const inner = this._pauseInnerVB;
        const innerBuf = inner._buffer;
        const ic = this._pauseInnerCells;
        for (let r = 0; r < 3; r++) {
            const srcRow = ic[r], dstRow = innerBuf[r];
            for (let c = 0; c < 12; c++) dstRow[c] = srcRow[c];
        }
        // _pauseSlotInner is always active (set at init)

        // Activate the board's pause slot (deactivated when not paused)
        const ps = this._boardSlotPause;
        ps.vb = frame;
        ps.x  = ox;
        ps.y  = oy;
        ps.active = true;
    },

    _renderGameOverOverlay(vb) {
        const fw = 16, fh = 6;
        const ox = Math.floor((BOARD_W - fw) / 2);
        const oy = Math.floor((BOARD_H - fh) / 2);

        // Restore frame cells from pre-built cache (no spreads, no new objects)
        const frame = this._gameOverFrameVB;
        const frameBuf = frame._buffer;
        const fc = this._gameOverFrameCells;
        for (let r = 0; r < fh; r++) {
            const srcRow = fc[r], dstRow = frameBuf[r];
            for (let c = 0; c < fw; c++) dstRow[c] = srcRow[c];
        }

        // Restore inner cells from pre-built cache
        const inner = this._gameOverInnerVB;
        const innerBuf = inner._buffer;
        const ic = this._gameOverInnerCells;
        for (let r = 0; r < 4; r++) {
            const srcRow = ic[r], dstRow = innerBuf[r];
            for (let c = 0; c < 14; c++) dstRow[c] = srcRow[c];
        }

        // Activate the board's game over slot (deactivated when not game over)
        const ps = this._boardSlotGameOver;
        ps.vb = frame;
        ps.x  = ox;
        ps.y  = oy;
        ps.active = true;
    },
};

export { renderMethods };
