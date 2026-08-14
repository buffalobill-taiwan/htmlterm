import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { Dialog } from '../dialog/Dialog.js';
import { centeredDialogPos } from '../dialog/position.js';
import { parseCSI } from '../system/TextInputModel.js';
import { bold, yellow, cyan, gray, CURSOR_HIDE } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';
import { bufWidth } from '../util/display-width.js';

const COLS = 4;
const ROWS = 5;

const BOARD_W = COLS * 2 + 2;
const BOARD_H = ROWS + 2;
const BOARD_X = 22;
const BOARD_Y = 6;
const SIDEBAR_X = 40;
const SIDEBAR_Y = 3;
const SIDEBAR_W = 36;
const SIDEBAR_H = 14;
const FINISH_FALL = 6;

const LEVELS = [
    { name: '比翼橫空', mini: 28, board: 'BBAA' + 'CCAA' + 'DDEE' + 'N@OH' + 'P@QH' },
    { name: '捷足先登', mini: 32, board: 'NAAO' + 'PAAQ' + '@BB@' + 'HIJK' + 'HIJK' },
    { name: '勇闖五關', mini: 34, board: 'NAAO' + 'PAAQ' + 'BBCC' + 'DDEE' + '@FF@' },
    { name: '五將逼宮', mini: 36, board: 'BBCC' + 'HAAI' + 'HAAI' + 'NDDO' + 'P@@Q' },
    { name: '四將連關', mini: 39, board: 'AABB' + 'AACC' + 'HIDD' + 'HINO' + 'P@@Q' },
    { name: '雨聲淅瀝', mini: 47, board: 'HAAN' + 'HAAO' + 'IBBJ' + 'IK@J' + 'PK@Q' },
    { name: '左右佈兵', mini: 54, board: 'NAAO' + 'PAAQ' + 'HIJK' + 'HIJK' + '@BB@' },
    { name: '齊頭並進', mini: 60, board: 'HAAI' + 'HAAI' + 'NOPQ' + 'JBBK' + 'J@@K' },
    { name: '兵分三路', mini: 72, board: 'NAAO' + 'HAAI' + 'HBBI' + 'JPQK' + 'J@@K' },
    { name: '橫刀立關', mini: 81, board: 'HAAI' + 'HAAI' + 'JBBK' + 'JNOK' + 'P@@Q' },
    { name: '層層設防', mini: 102, board: 'HAAI' + 'HAAI' + 'NBBO' + 'PCCQ' + '@DD@' },
];

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

function _makeCell(ch, fg, bg, bold, width = 1) {
    return { ch, fg, bg, bold, dim: false, italic: false, underline: false,
             blink: false, inverse: false, conceal: false, crossedOut: false, width };
}

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

class LevelSelectDialog extends Dialog {
    constructor(term, opts) {
        const width = 40;
        const h = LEVELS.length + 6;
        const pos = centeredDialogPos(term, width, h);
        super(term, { ...opts, width, title: '選擇關卡 Klotski', footer: '↑↓ 選關  ↩ 開始  ESC 離開' });
        this.x = pos.x;
        this.y = Math.max(0, pos.y);
        this.h = h;
        this._selected = 0;
        this._onSelect = opts.onSelect || (() => {});
        this._onCancel = opts.onCancel || (() => {});
    }

    _renderContent() {
        for (let i = 0; i < LEVELS.length; i++) {
            const lv = LEVELS[i];
            const sel = i === this._selected;
            const left = ' ' + String(i + 1).padStart(2) + '  ' + lv.name;
            const right = String(lv.mini) + '步 ';
            const pad = Math.max(0, this.width - 2 - this._bufWidth(left) - this._bufWidth(right));
            let s = '│';
            if (sel) s += '\x1B[7m\x1B[1m';
            s += left + ' '.repeat(pad) + right;
            if (sel) s += '\x1B[0m';
            s += '│';
            this._t(3 + i, s);
        }
    }

    _onKey(data) {
        const code = data.charCodeAt(0);
        if (code === 0x1B) {
            const csi = parseCSI(data);
            if (!csi) { this._onCancel(); return 'close'; }
            const { final } = csi;
            if (final === 'A') {
                this._selected = (this._selected - 1 + LEVELS.length) % LEVELS.length;
                this.refreshContent();
            } else if (final === 'B') {
                this._selected = (this._selected + 1) % LEVELS.length;
                this.refreshContent();
            }
            return;
        }
        if (code === 0x03) { this._onCancel(); return 'close'; }
        if (code === 0x0D || code === 0x0A) {
            this._onSelect(this._selected);
            return 'close';
        }
    }
}

export class KlotskiCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {});
        if (p.hasHelp) return this.showHelp();
        this.open();
        this._showLevelMenu();
    }

    _showLevelMenu() {
        this._cancelFinishAnim();
        this._stopTimer();
        this._completed = false;
        this._finishing = false;
        this._animOffset = 0;
        this._paused = false;
        this._selected = null;
        this._levelIdx = null;
        this._history = [];
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        const dlg = new LevelSelectDialog(term, {
            onSelect: (idx) => {
                this._levelDialog = null;
                this._startGame(idx);
            },
            onCancel: () => {
                this._levelDialog = null;
                this._quit();
            },
        });
        dlg.open();
        this._levelDialog = dlg;
    }

    _startGame(idx) {
        const lv = LEVELS[idx];
        this._levelIdx = idx;
        this._moves = 0;
        this._time = 0;
        this._completed = false;
        this._finishing = false;
        this._animOffset = 0;
        this._paused = false;
        this._selected = null;
        this._history = [];
        this._cursor = { r: 2, c: 1 };
        this._board = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
        this._initVBs();
        this._buildBlocks(lv.board);
        this._buildBoardGrid();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._render();
        this._startTimer();
    }

    _buildBlocks(boardStr) {
        const posByLetter = {};
        for (let i = 0; i < boardStr.length; i++) {
            const ch = boardStr[i];
            if (ch === '@') continue;
            if (!posByLetter[ch]) posByLetter[ch] = [];
            posByLetter[ch].push([Math.floor(i / COLS), i % COLS]);
        }
        const infos = [];
        for (const letter of Object.keys(posByLetter)) {
            const list = posByLetter[letter];
            let minR = 9, maxR = -1, minC = 9, maxC = -1;
            for (const [r, c] of list) {
                if (r < minR) minR = r;
                if (r > maxR) maxR = r;
                if (c < minC) minC = c;
                if (c > maxC) maxC = c;
            }
            infos.push({ letter, r: minR, c: minC, w: maxC - minC + 1, h: maxR - minR + 1 });
        }
        infos.sort((a, b) => a.r - b.r || a.c - b.c);

        const rects = infos.filter(x => (x.w === 2 && x.h === 1) || (x.w === 1 && x.h === 2));
        const vNames = ['張飛', '趙雲', '馬超', '黃忠'];
        const hNames = ['關羽', '關平', '關興', '關索', '關統'];
        const names = new Map();
        let vi = 0, hi = 0;
        for (const x of rects) {
            if (x.w === 2 && x.h === 1) names.set(x.letter, hNames[hi++]);
            else names.set(x.letter, vNames[vi++]);
        }

        const blocks = [];
        for (const info of infos) {
            let name, color;
            if (info.w === 2 && info.h === 2) { name = '曹'; color = NAME_COLOR['曹']; }
            else if (info.w === 2 && info.h === 1) { name = names.get(info.letter); color = NAME_COLOR[name]; }
            else if (info.w === 1 && info.h === 2) { name = names.get(info.letter); color = NAME_COLOR[name]; }
            else { name = '兵'; color = NAME_COLOR['兵']; }
            blocks.push({ name, color, w: info.w, h: info.h, r: info.r, c: info.c });
        }
        blocks.sort((a, b) => (a.name === '曹' ? -1 : 1) - (b.name === '曹' ? -1 : 1));
        this._blocks = blocks;
    }

    _buildBoardGrid() {
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++) this._board[r][c] = -1;
        for (let id = 0; id < this._blocks.length; id++) {
            const b = this._blocks[id];
            for (let dy = 0; dy < b.h; dy++)
                for (let dx = 0; dx < b.w; dx++)
                    this._board[b.r + dy][b.c + dx] = id;
        }
    }

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
            this._cellEmpty = _makeCell(' ', 0, 0, false);
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
            this._cellCursorEmpty = _makeCell('　', 0, 4, false, 2);

            this._cellTL = _makeCell('╔', 8, 0, false);
            this._cellTR = _makeCell('╗', 8, 0, false);
            this._cellBL = _makeCell('╚', 8, 0, false);
            this._cellBR = _makeCell('╝', 8, 0, false);
            this._cellH = _makeCell('═', 8, 0, false);
            this._cellV = _makeCell('║', 8, 0, false);

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
        term.writeVB(this._rootVB);
    }

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
        vb.writeStr(9, 0, gray(' Space 選取方塊'));
        vb.writeStr(10, 0, gray(' ←↑↓→ 滑動'));
        vb.writeStr(11, 0, gray(' Z 撤銷'));
        vb.writeStr(12, 0, gray(' N 新關  P 暫停'));
        vb.writeStr(13, 0, gray(' Q 離開'));
    }

    _setCell(buf, r, c, cell) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
        buf[1 + r][1 + c * 2] = cell;
        buf[1 + r][1 + c * 2 + 1] = this._cellEmptyWide;
    }

    _raw(buf, r, termC, cell) {
        buf[1 + r][1 + termC] = cell;
    }

    _buildPalCells(name, fg, bg) {
        const chars = [...NAME_CHARS[name]];
        if (name === '曹') {
            const cells = [];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 4; c++) {
                    const cell = _makeCell(chars[0], fg, bg, true, 1);
                    cell.clip = true;
                    cell.clipOffX = -c;
                    cell.clipOffY = -r;
                    cells.push(cell);
                }
            }
            return cells;
        }
        return chars.map(ch => _makeCell(ch, fg, bg, true, 2));
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    _renderPauseOverlay() {
        const W = 14;
        const vb = this._pauseVB;
        vb.writeStr(0, 0, '\x1B[1;34m┌' + '─'.repeat(W - 2) + '┐\x1B[0m');
        vb.writeStr(1, 0, '\x1B[1;34m│\x1B[0m' + _centerContent(bold(cyan('暫停中')), W - 2) + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(2, 0, '\x1B[1;34m│\x1B[0m' + _centerContent(gray('P 繼續'), W - 2) + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(3, 0, '\x1B[1;34m│\x1B[0m' + ' '.repeat(W - 2) + '\x1B[1;34m│\x1B[0m');
        vb.writeStr(4, 0, '\x1B[1;34m└' + '─'.repeat(W - 2) + '┘\x1B[0m');
        this._rootSlotPause.active = true;
    }

    _canSlide(id, dr, dc) {
        const b = this._blocks[id];
        for (let dy = 0; dy < b.h; dy++) {
            for (let dx = 0; dx < b.w; dx++) {
                const nr = b.r + dy + dr, nc = b.c + dx + dc;
                if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return false;
                const v = this._board[nr][nc];
                if (v !== -1 && v !== id) return false;
            }
        }
        return true;
    }

    _slide(id, dr, dc) {
        if (this._completed || this._paused) return;
        const b = this._blocks[id];
        if (!this._canSlide(id, dr, dc)) return;
        const last = this._history[this._history.length - 1];
        if (!last || last.id !== id) {
            this._history.push({ id, fromR: b.r, fromC: b.c });
            this._moves++;
        }
        for (let dy = 0; dy < b.h; dy++)
            for (let dx = 0; dx < b.w; dx++)
                this._board[b.r + dy][b.c + dx] = -1;
        b.r += dr; b.c += dc;
        for (let dy = 0; dy < b.h; dy++)
            for (let dx = 0; dx < b.w; dx++)
                this._board[b.r + dy][b.c + dx] = id;
        this._cursor.r = b.r; this._cursor.c = b.c;
        this._render();
        if (b.name === '曹' && b.r === 3 && b.c === 1) this._startFinishAnim();
    }

    _undo() {
        if (this._completed || this._paused) return;
        if (!this._history.length) return;
        const e = this._history.pop();
        const b = this._blocks[e.id];
        for (let dy = 0; dy < b.h; dy++)
            for (let dx = 0; dx < b.w; dx++)
                this._board[b.r + dy][b.c + dx] = -1;
        b.r = e.fromR; b.c = e.fromC;
        for (let dy = 0; dy < b.h; dy++)
            for (let dx = 0; dx < b.w; dx++)
                this._board[b.r + dy][b.c + dx] = e.id;
        this._moves--;
        if (this._selected === e.id) { this._cursor.r = b.r; this._cursor.c = b.c; }
        this._render();
    }

    _moveCursor(dr, dc) {
        const startId = this._board[this._cursor.r][this._cursor.c];
        let r = this._cursor.r + dr, c = this._cursor.c + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
        while (startId >= 0 && this._board[r][c] === startId) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
            r = nr; c = nc;
        }
        this._cursor.r = r;
        this._cursor.c = c;
        this._render();
    }

    _toggleSelect() {
        const id = this._board[this._cursor.r][this._cursor.c];
        if (id < 0) return;
        if (this._selected === id) this._selected = null;
        else this._selected = id;
        this._render();
    }

    _togglePause() {
        if (this._completed) return;
        this._paused = !this._paused;
        this._render();
    }

    _startFinishAnim() {
        if (this._finishing || this._completed) return;
        this._finishing = true;
        this._selected = null;
        this._stopTimer();
        const t0 = performance.now();
        const step = (now) => {
            const t = now - t0;
            const frac = Math.min(t / 550, 1);
            this._animOffset = Math.min(FINISH_FALL, Math.floor(FINISH_FALL * frac * frac));
            this._render();
            if (frac < 1) this._finishRAF = requestAnimationFrame(step);
            else this._finishWin();
        };
        this._finishRAF = requestAnimationFrame(step);
    }

    _finishWin() {
        this._finishRAF = null;
        this._animOffset = FINISH_FALL;
        this._win();
    }

    _cancelFinishAnim() {
        if (this._finishRAF) { cancelAnimationFrame(this._finishRAF); this._finishRAF = null; }
        this._finishing = false;
        this._animOffset = 0;
    }

    _win() {
        this._completed = true;
        this._selected = null;
        this._stopTimer();
        this._render();
    }

    _startTimer() {
        this._stopTimer();
        this._timer = setInterval(() => {
            if (this._completed || this._paused) return;
            this._time++;
            this._render();
        }, 1000);
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    _quit() {
        this._cancelFinishAnim();
        if (this._levelDialog) {
            this._levelDialog.close();
            this._levelDialog = null;
        }
        this._stopTimer();
        this._completed = false;
        this._paused = false;
        term.write('\x1B[2J\x1B[1;1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    _onKey(data) {
        if (this._levelDialog) {
            this._levelDialog.handleKey(data);
            return;
        }
        if (this._finishing && !this._completed) return;

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (this._completed) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'n') { this._showLevelMenu(); return; }
                if (ch === 'q') { this._quit(); return; }
            }
            return;
        }

        if (this._paused) {
            if (code === 0x1B) {
                const s = typeof data === 'string' ? data : '';
                if (s === '\x1B[A' || s === '\x1B[B' || s === '\x1B[C' || s === '\x1B[D') return;
                if (s === '\x1B[3~' || s === '\x1B[2~') return;
                if (s === '\x1B[H' || s === '\x1B[F') return;
                if (s === '\x1B[5~' || s === '\x1B[6~') return;
                this._quit(); return;
            }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'p') { this._togglePause(); return; }
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._showLevelMenu(); return; }
            }
            return;
        }

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._selected === null ? this._moveCursor(-1, 0) : this._slide(this._selected, -1, 0); return; }
            if (s === '\x1B[B') { this._selected === null ? this._moveCursor(1, 0) : this._slide(this._selected, 1, 0); return; }
            if (s === '\x1B[D') { this._selected === null ? this._moveCursor(0, -1) : this._slide(this._selected, 0, -1); return; }
            if (s === '\x1B[C') { this._selected === null ? this._moveCursor(0, 1) : this._slide(this._selected, 0, 1); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            this._quit(); return;
        }

        if (code === 0x20) { this._toggleSelect(); return; }
        if (code === 0x08 || code === 0x7F) return;

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'z') { this._undo(); return; }
            if (ch === 'p') { this._togglePause(); return; }
            if (ch === 'n') { this._showLevelMenu(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    static get commandName() { return 'klotski'; }
    static get help() { return 'Play Klotski 華容道'; }
    static get menu() { return 'Klotski 華容道'; }
    static get usage() { return 'klotski'; }
}
