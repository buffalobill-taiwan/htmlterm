import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import { BOARD_W, BOARD_H, SIDEBAR_W, BOARD_X, BOARD_Y, SIDEBAR_X, DIFFICULTY } from './constants.js';
import { makeCell, bold, cyan, gray } from '../../util/sgr.js';
import { buildStatRow, writeStatRow } from '../../util/stat-row.js';

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
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);

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
            this._cellEmpty = makeCell(' ', 0, 0, false);
            this._cellBorder = makeCell('║', 8, 0, false);
            this._cellEmptyWide = { ch: '', fg: 0, bg: 0, bold: false, dim: false, italic: false,
                underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };
        }

        if (!this._borderTop) {
            const bvb = new VirtualBuffer(BOARD_W, 1);
            bvb.writeStr(0, 0, '\x1B[90m╔' + '═'.repeat(BOARD_W - 2) + '╗');
            this._borderTop = bvb._buffer[0].slice();
            bvb.writeStr(0, 0, '\x1B[90m╚' + '═'.repeat(BOARD_W - 2) + '╝');
            this._borderBottom = bvb._buffer[0].slice();
        }

        if (!this._pauseFrameCells) {
            this._pauseFrameCells = this._buildOverlayFrame(14, 5, 11);
            this._pauseInnerCells = this._buildOverlayInner(12, 3, '\x1B[1;37;44m  PAUSED!  \x1B[0m');
            this._pauseFrameVB = new VirtualBuffer(14, 5);
            this._pauseInnerVB = new VirtualBuffer(12, 3);
            this._pauseSlotInner = this._pauseFrameVB.addChildSlot();
            this._pauseSlotInner.vb = this._pauseInnerVB;
            this._pauseSlotInner.x = 1;
            this._pauseSlotInner.y = 1;
            this._pauseSlotInner.active = true;

            this._gameOverFrameCells = this._buildOverlayFrame(16, 6, 1);
            this._gameOverInnerCells = this._buildGameOverInner(14, 4);
            this._gameOverFrameVB = new VirtualBuffer(16, 6);
            this._gameOverInnerVB = new VirtualBuffer(14, 4);
            this._gameOverSlotInner = this._gameOverFrameVB.addChildSlot();
            this._gameOverSlotInner.vb = this._gameOverInnerVB;
            this._gameOverSlotInner.x = 1;
            this._gameOverSlotInner.y = 1;
            this._gameOverSlotInner.active = true;
        }

        if (!this._dynScore) {
            this._dynScore = buildStatRow(' Score  ');
            this._dynSpeed = buildStatRow(' Speed  ');
        }
    },

    _buildOverlayFrame(fw, fh, color) {
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
    },

    _buildOverlayInner(cw, ch, text) {
        const vb = new VirtualBuffer(cw, ch);
        const e = makeCell(' ', 0, 0, false);
        for (let r = 0; r < ch; r++)
            for (let c = 0; c < cw; c++)
                vb._buffer[r][c] = e;
        const tw = cw - 2;
        const tx = Math.floor((cw - tw) / 2);
        vb.writeStr(1, tx, text);
        return vb._buffer.map(row => row.slice());
    },

    _buildGameOverInner(cw, ch) {
        const vb = new VirtualBuffer(cw, ch);
        const e = makeCell(' ', 0, 0, false);
        for (let r = 0; r < ch; r++)
            for (let c = 0; c < cw; c++)
                vb._buffer[r][c] = { ...e };
        const t1 = ' GAME OVER ';
        const t1x = Math.floor((cw - t1.length) / 2);
        vb.writeStr(1, t1x, '\x1B[1;31m' + t1 + '\x1B[0m');
        const sep = '─'.repeat(cw - 2);
        const sx = 1;
        vb.writeStr(2, sx, '\x1B[31m' + sep + '\x1B[0m');
        const t2 = '[n]ew [q]uit';
        const t2x = Math.floor((cw - t2.length) / 2);
        vb.writeStr(3, t2x, '\x1B[90m' + t2 + '\x1B[0m');
        return vb._buffer.map(row => row.slice());
    },

    _render() {
        const rootBuf = this._rootVB._buffer;
        for (let r = 0; r < this._rootVB.height; r++) {
            const row = rootBuf[r];
            for (let c = 0; c < row.length; c++) row[c] = this._cellEmpty;
        }
        this._renderSidebar();
        this._renderBoard();
    },

    _renderSidebar() {
        const vb = this._sidebarVB;
        const buf = vb._buffer;

        vb.writeStr(0, 0, bold(cyan('  Snake')) + gray(' [' + DIFFICULTY[this._difficulty].label + ']'));

        writeStatRow(buf[2], this._dynScore, this._score);
        writeStatRow(buf[3], this._dynSpeed, this._speedLevel);

        vb.writeStr(5, 0, gray('─'.repeat(16)));
        vb.writeStr(7, 0, gray(' ←↑↓→ Move'));
        vb.writeStr(8, 0, gray(' P Pause'));
        vb.writeStr(9, 0, gray(' Q Quit'));
    },

    _renderBoard() {
        const vb = this._boardVB;
        const buf = vb._buffer;

        const ec = this._cellEmpty;
        for (let r = 0; r < BOARD_H; r++) {
            const row = buf[r];
            for (let c = 0; c < BOARD_W; c++) row[c] = ec;
        }

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

        for (let i = this._snake.length - 1; i >= 0; i--) {
            const seg = this._snake[i];
            const isHead = i === 0;
            const px = 1 + seg.c * 2;
            const py = 1 + seg.r;
            if (isHead) {
                const cell = makeCell('■', 15, 2, true);
                buf[py][px] = cell;
                buf[py][px + 1] = cell;
            } else {
                const cell = makeCell('⬤', 2, 0, false, 2);
                buf[py][px] = cell;
                buf[py][px + 1] = this._cellEmptyWide;
            }
        }

        if (this._food && !this._completed) {
            const fc = makeCell('⬤', 1, 0, true, 2);
            const fx = 1 + this._food.c * 2;
            const fy = 1 + this._food.r;
            buf[fy][fx] = fc;
            buf[fy][fx + 1] = this._cellEmptyWide;
        }

        if (this._paused) this._renderPauseOverlay(vb);
        else this._boardSlotPause.active = false;

        if (this._completed) this._renderGameOverOverlay(vb);
        else this._boardSlotGameOver.active = false;

        term.writeVB(this._rootVB);
    },

    _renderPauseOverlay() {
        const fw = 14, fh = 5;
        const ox = Math.floor((BOARD_W - fw) / 2);
        const oy = Math.floor((BOARD_H - fh) / 2);

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
        const fw = 16, fh = 6;
        const ox = Math.floor((BOARD_W - fw) / 2);
        const oy = Math.floor((BOARD_H - fh) / 2);

        const frame = this._gameOverFrameVB;
        const frameBuf = frame._buffer;
        const fc = this._gameOverFrameCells;
        for (let r = 0; r < fh; r++)
            for (let c = 0; c < fw; c++) frameBuf[r][c] = fc[r][c];

        const inner = this._gameOverInnerVB;
        const innerBuf = inner._buffer;
        const ic = this._gameOverInnerCells;
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 14; c++) innerBuf[r][c] = ic[r][c];

        const ps = this._boardSlotGameOver;
        ps.vb = frame;
        ps.x = ox;
        ps.y = oy;
        ps.active = true;
    },
};

export { renderMethods };
