import { bufWidth } from '../../util/display-width.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import {
    BOARD_W, BOARD_H, SIDEBAR_W, SIDEBAR_H, BOARD_X, BOARD_Y, SIDEBAR_X, SIDEBAR_Y, ROWS, COLS,
} from './constants.js';
import { makeCell, bold, cyan, gray, yellow } from '../../util/sgr.js';
import { LEVELS } from '../../util/klotski-levels.js';

const NAME_COLOR = {
    '曹': 9,
    '關羽': 15, '關平': 220, '關興': 214, '關索': 209, '關統': 80,
    '張飛': 12, '趙雲': 14, '馬超': 11, '黃忠': 13,
    '兵': 15,
};

const NAME_BG = { '曹': 52, '關': 22, '張': 17, '趙': 23, '馬': 58, '黃': 53, '兵': 236 };

const NAME_CHARS = {
    '曹': '曹',
    '關羽': '關羽',
    '關平': '關平',
    '關興': '關興',
    '關索': '關索',
    '關統': '關統',
    '張飛': '張飛',
    '趙雲': '趙雲',
    '馬超': '馬超',
    '黃忠': '黃忠',
    '兵': '兵',
};

function _fmtTime(t) {
    const m = String(Math.floor(t / 60)).padStart(2, '0');
    const s = String(t % 60).padStart(2, '0');
    return m + ':' + s;
}

function _centerContent(content, width) {
    const w = bufWidth(content);
    const pad = Math.max(0, width - w);
    return ' '.repeat(Math.floor(pad / 2)) + content + ' '.repeat(Math.ceil(pad / 2));
}

const renderMethods = {
    _initVBs() {
        if (!this._rootVB) {
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

            this._rootSlotWin = this._rootVB.addChildSlot();
            this._rootSlotWin.active = false;

            this._rootSlotPause = this._rootVB.addChildSlot();
            this._rootSlotPause.active = false;

            this._rootSlotCao = this._rootVB.addChildSlot();
            this._rootSlotCao.active = false;
            this._caoVB = new VirtualBuffer(4, 2);
            this._rootSlotCao.vb = this._caoVB;
        }

        if (!this._pals) {
            this._cellEmpty = makeCell(' ', 0, 0, false);
            this._cellEmptyWide = { ch: '', fg: 0, bg: 0, bold: false, dim: false, italic: false,
                underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };
            this._pals = {};
            this._cursorPals = {};
            this._selPals = {};
            for (const name of Object.keys(NAME_CHARS)) {
                const color = NAME_COLOR[name];
                const bg = NAME_BG[name[0]];
                this._pals[name] = this._buildPalCells(name, color, bg);
                this._cursorPals[name] = this._buildPalCells(name, color, 4);
                this._selPals[name] = this._buildPalCells(name, color, 7);
            }
            this._cellCursorEmpty = makeCell('　', 0, 4, false, 2);

            this._cellTL = makeCell('╔', 8, 0, false);
            this._cellTR = makeCell('╗', 8, 0, false);
            this._cellBL = makeCell('╚', 8, 0, false);
            this._cellBR = makeCell('╝', 8, 0, false);
            this._cellH = makeCell('═', 8, 0, false);
            this._cellV = makeCell('║', 8, 0, false);

            this._winVB = new VirtualBuffer(18, 7);
            this._rootSlotWin.vb = this._winVB;
            this._rootSlotWin.x = BOARD_X - 4;
            this._rootSlotWin.y = BOARD_Y;

            this._pauseVB = new VirtualBuffer(14, 5);
            this._rootSlotPause.vb = this._pauseVB;
            this._rootSlotPause.x = BOARD_X - 2;
            this._rootSlotPause.y = BOARD_Y + 1;
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
        term.writeVB(this._rootVB);
    },

    _renderSidebar() {
        const vb = this._sidebarVB;
        vb.clear();
        const lv = LEVELS[this._levelIdx];
        vb.writeStr(0, 0, bold(cyan('  Klotski')));
        vb.writeStr(1, 0, bold(cyan('  華容道')));
        vb.writeStr(2, 0, gray('─'.repeat(20)));
        vb.writeStr(3, 0, gray(' 關卡 ') + bold(yellow(lv.name)));
        vb.writeStr(4, 0, gray(' 步數 ') + bold(String(this._moves)));
        vb.writeStr(5, 0, gray(' 目標 ') + bold('≤ ' + lv.mini));
        vb.writeStr(6, 0, gray(' 時間 ') + bold(_fmtTime(this._time)));
        vb.writeStr(7, 0, gray('─'.repeat(20)));
        vb.writeStr(9, 0, gray('  Space/↵ 選取'));
        vb.writeStr(10, 0, gray('  ←↑↓→   滑動'));
        vb.writeStr(11, 0, gray(' Z 撤銷  R 重設'));
        vb.writeStr(12, 0, gray(' N 新關  P 暫停'));
        vb.writeStr(13, 0, gray(' A 自動  Q 離開'));
    },

    _setCell(buf, r, c, cell) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
        buf[1 + r][1 + c * 2] = cell;
        buf[1 + r][1 + c * 2 + 1] = this._cellEmptyWide;
    },

    _raw(buf, r, termC, cell) {
        buf[1 + r][1 + termC] = cell;
    },

    _buildPalCells(name, fg, bg) {
        const chars = [...NAME_CHARS[name]];
        if (name === '曹') {
            const cells = [];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 4; c++) {
                    const cell = makeCell(chars[0], fg, bg, true, 1);
                    cell.clip = true;
                    cell.clipOffX = -c;
                    cell.clipOffY = -r;
                    cells.push(cell);
                }
            }
            return cells;
        }
        return chars.map(ch => makeCell(ch, fg, bg, true, 2));
    },

    _drawBlock(buf, b, pals) {
        if (b.name === '曹') {
            for (let r = 0; r < 2; r++)
                for (let c = 0; c < 4; c++)
                    this._raw(buf, b.r + r, b.c * 2 + c, pals[r * 4 + c]);
            return;
        }
        this._setCell(buf, b.r, b.c, pals[0]);
        if (b.w === 2) this._setCell(buf, b.r, b.c + 1, pals[1]);
        else if (b.h === 2) this._setCell(buf, b.r + 1, b.c, pals[1]);
    },

    _drawCaoFalling() {
        const b = this._blocks[0];
        const pals = this._pals['曹'];
        const slot = this._rootSlotCao;
        slot.x = BOARD_X + 1 + b.c * 2;
        slot.y = BOARD_Y + 1 + b.r + this._animOffset;
        slot.active = true;
        const buf = this._caoVB._buffer;
        for (let r = 0; r < 2; r++)
            for (let c = 0; c < 4; c++)
                buf[r][c] = pals[r * 4 + c];
    },

    _drawBorders(buf) {
        buf[0][0] = this._cellTL;
        buf[0][BOARD_W - 1] = this._cellTR;
        for (let c = 1; c < BOARD_W - 1; c++) buf[0][c] = this._cellH;
        for (let r = 1; r < BOARD_H - 1; r++) {
            buf[r][0] = this._cellV;
            buf[r][BOARD_W - 1] = this._cellV;
        }
        buf[BOARD_H - 1][0] = this._cellBL;
        for (let c = 1; c < 3; c++) buf[BOARD_H - 1][c] = this._cellH;
        for (let c = 7; c < BOARD_W - 1; c++) buf[BOARD_H - 1][c] = this._cellH;
        buf[BOARD_H - 1][BOARD_W - 1] = this._cellBR;
    },

    _renderBoard() {
        const buf = this._boardVB._buffer;
        const ec = this._cellEmpty;
        for (let r = 0; r < BOARD_H; r++) {
            const row = buf[r];
            for (let c = 0; c < BOARD_W; c++) row[c] = ec;
        }
        this._drawBorders(buf);

        const blocks = this._blocks;
        const sel = this._selected;
        let cursorBlock = null;
        let cursorEmpty = false;
        if (sel === null && !this._paused && !this._completed && !this._finishing) {
            const id = this._board[this._cursor.r][this._cursor.c];
            if (id >= 0) cursorBlock = id;
            else cursorEmpty = true;
        }
        for (let id = 0; id < blocks.length; id++) {
            const b = blocks[id];
            if (this._finishing && b.name === '曹') continue;
            let pals;
            if (sel === id) pals = this._selPals[b.name];
            else if (cursorBlock === id) pals = this._cursorPals[b.name];
            else pals = this._pals[b.name];
            this._drawBlock(buf, b, pals);
        }

        if (this._finishing) this._drawCaoFalling();
        else this._rootSlotCao.active = false;

        if (cursorEmpty) {
            this._setCell(buf, this._cursor.r, this._cursor.c, this._cellCursorEmpty);
        }

        if (this._completed) this._renderWinOverlay();
        else this._rootSlotWin.active = false;

        if (this._paused) this._renderPauseOverlay();
        else this._rootSlotPause.active = false;

        term.writeVB(this._rootVB);
    },

    _renderWinOverlay() {
        const lv = LEVELS[this._levelIdx];
        const W = 18;
        const vb = this._winVB;
        const good = this._moves <= lv.mini;
        vb.writeStr(0, 0, '\x1B[1;33m┌' + '─'.repeat(W - 2) + '┐\x1B[0m');
        vb.writeStr(1, 0, '\x1B[1;33m│\x1B[0m' + _centerContent(bold(yellow('恭喜通關！')), W - 2) + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(2, 0, '\x1B[1;33m│\x1B[0m' + _centerContent(bold('步數 ' + this._moves + '/' + lv.mini) + (good ? ' ★' : ''), W - 2) + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(3, 0, '\x1B[1;33m│\x1B[0m' + _centerContent(bold('時間 ' + _fmtTime(this._time)), W - 2) + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(4, 0, '\x1B[1;33m│\x1B[0m' + _centerContent(gray('[n]新關  [q]離開'), W - 2) + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(5, 0, '\x1B[1;33m│\x1B[0m' + ' '.repeat(W - 2) + '\x1B[1;33m│\x1B[0m');
        vb.writeStr(6, 0, '\x1B[1;33m└' + '─'.repeat(W - 2) + '┘\x1B[0m');
        this._rootSlotWin.active = true;
    },

    _renderPauseOverlay() {
        const W = 14;
        const vb = this._pauseVB;
        vb.writeStr(0, 0, '\x1B[1;34m┌' + '─'.repeat(W - 2) + '┐\x1B[0m');
        vb.writeStr(1, 0, '\x1B[1;34m│\x1B[0m' + _centerContent(bold(cyan('暫停中')), W - 2) + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(2, 0, '\x1B[1;34m│\x1B[0m' + _centerContent(gray('P 繼續'), W - 2) + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(3, 0, '\x1B[1;34m│\x1B[0m' + ' '.repeat(W - 2) + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(4, 0, '\x1B[1;34m└' + '─'.repeat(W - 2) + '┘\x1B[0m');
        this._rootSlotPause.active = true;
    },
};

export { NAME_COLOR, renderMethods };
