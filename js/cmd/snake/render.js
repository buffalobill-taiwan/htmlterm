import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import { BOARD_W, BOARD_H, SIDEBAR_W, BOARD_X, BOARD_Y, SIDEBAR_X, DIFFICULTY, SPEED_LEVELS } from './constants.js';
import { makeCell, bold, cyan, gray } from '../../util/sgr.js';
import { buildStatRow, writeStatRow } from '../../util/stat-row.js';
import { buildFrameCells, buildTextInner, buildGameOverInner } from '../../util/overlay-frame.js';

const renderMethods = {
    _initVBs() {
        if (this._rootVB) {
            for (const vb of [this._rootVB, this._boardVB, this._sidebarVB]) vb.clearCells();
        } else {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
            this._sidebarVB = new VirtualBuffer(SIDEBAR_W, BOARD_H);

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
        }

        if (!this._borderTop) {
            const bvb = new VirtualBuffer(BOARD_W, 1);
            bvb.writeStr(0, 0, '\x1B[90m╔' + '═'.repeat(BOARD_W - 2) + '╗');
            this._borderTop = bvb._buffer[0].slice();
            bvb.writeStr(0, 0, '\x1B[90m╚' + '═'.repeat(BOARD_W - 2) + '╝');
            this._borderBottom = bvb._buffer[0].slice();
        }

        if (!this._pauseFrameCells) {
            this._pauseFrameCells = buildFrameCells(14, 5, 11);
            this._pauseInnerCells = buildTextInner(12, 3, '\x1B[1;37;44m  PAUSED!  \x1B[0m');
            this._pauseFrameVB = new VirtualBuffer(14, 5);
            this._pauseInnerVB = new VirtualBuffer(12, 3);
            this._pauseSlotInner = this._pauseFrameVB.attach(this._pauseInnerVB, 1, 1);

            this._gameOverFrameCells = buildFrameCells(16, 6, 1);
            this._gameOverInnerCells = buildGameOverInner(14, 4);
            this._gameOverFrameVB = new VirtualBuffer(16, 6);
            this._gameOverInnerVB = new VirtualBuffer(14, 4);
            this._gameOverSlotInner = this._gameOverFrameVB.attach(this._gameOverInnerVB, 1, 1);
        }

        if (!this._dynScore) {
            this._dynScore = buildStatRow(' Score  ');
            this._dynSpeed = buildStatRow(' Speed  ');
            this._maxSpeedRow = Array.from(' Speed  ' + `${SPEED_LEVELS.length}(max)`.padStart(8),
                (ch, i) => makeCell(ch, i < 8 ? 7 : 11, 0, i >= 8));
        }
    },

    _render() {
        this._rootVB.fill(this._cellEmpty);
        this._renderSidebar();
        this._renderBoard();
    },

    _renderSidebar() {
        const vb = this._sidebarVB;
        const buf = vb._buffer;

        vb.writeStr(0, 0, bold(cyan('  Snake')) + gray(' [' + DIFFICULTY[this._difficulty].label + ']'));

        writeStatRow(buf[2], this._dynScore, this._score);
        if (this._speedLevel === SPEED_LEVELS.length) {
            for (let i = 0; i < this._maxSpeedRow.length; i++) buf[3][i] = this._maxSpeedRow[i];
        } else {
            writeStatRow(buf[3], this._dynSpeed, this._speedLevel);
        }

        vb.writeStr(5, 0, gray('─'.repeat(16)));
        vb.writeStr(7, 0, gray(' ←↑↓→ Move'));
        vb.writeStr(8, 0, gray(' P Pause'));
        vb.writeStr(9, 0, gray(' Q Quit'));
    },

    _renderBoard() {
        const vb = this._boardVB;
        const buf = vb._buffer;

        vb.fill(this._cellEmpty);

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
