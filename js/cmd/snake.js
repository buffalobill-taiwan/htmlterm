import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, green, yellow, cyan, gray, CURSOR_HIDE } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

const GRID_COLS = 20;
const GRID_ROWS = 16;

const BOARD_W = GRID_COLS * 2 + 2;
const BOARD_H = GRID_ROWS + 2;
const BOARD_X = 2;
const BOARD_Y = 1;
const SIDEBAR_X = BOARD_X + BOARD_W + 2;
const SIDEBAR_W = 32;

const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const OPPOSITE = [DIR.DOWN, DIR.LEFT, DIR.UP, DIR.RIGHT];

const DIFFICULTY = {
    easy:   { startSpeed: 200, speedUpEvery: 8,  label: 'Easy' },
    medium: { startSpeed: 170, speedUpEvery: 5,  label: 'Medium' },
    hard:   { startSpeed: 130, speedUpEvery: 3,  label: 'Hard' },
};

const SPEED_LEVELS = [200, 180, 160, 140, 120, 100, 80, 65];

function _makeCell(ch, fg, bg, bold) {
    return { ch, fg, bg, bold, dim: false, italic: false, underline: false,
             blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };
}

export class SnakeCmd extends CmdBase {
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
            title: 'Snake',
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
        this._foodEaten = 0;
        this._speedLevel = this._speedForInterval(cfg.startSpeed);
        this._startSpeedLevel = this._speedLevel;
        this._currentInterval = cfg.startSpeed;
        this._speedUpEvery = cfg.speedUpEvery;
        this._completed = false;
        this._paused = false;
        this._difficultyDialog = null;
        this._tickTimer = null;
        this._pendingDir = null;

        const midC = Math.floor(GRID_COLS / 2);
        const midR = Math.floor(GRID_ROWS / 2);
        this._snake = [
            { r: midR, c: midC },
            { r: midR, c: midC - 1 },
            { r: midR, c: midC - 2 },
        ];
        this._dir = DIR.RIGHT;
        this._snakeSet = new Set();
        for (const seg of this._snake) this._snakeSet.add(seg.r * GRID_COLS + seg.c);

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._initVBs();
        this._spawnFood();
        this._render();
        this._startTick();
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
            this._dynScore = this._buildDynRow(' Score  ');
            this._dynSpeed = this._buildDynRow(' Speed  ');
        }
    }

    _buildOverlayFrame(fw, fh, color) {
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

    _buildOverlayInner(cw, ch, text) {
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

    _buildGameOverInner(cw, ch) {
        const vb = new VirtualBuffer(cw, ch);
        const e = _makeCell(' ', 0, 0, false);
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
    }

    _buildDynRow(prefix) {
        const cells = [];
        for (let i = 0; i < 8; i++)
            cells.push(_makeCell(prefix[i] || ' ', 7, 0, false));
        for (let i = 0; i < 8; i++)
            cells.push(_makeCell(' ', 11, 0, true));
        return cells;
    }

    _writeDynRow(dstRow, cells, value) {
        const s = String(value).padStart(8);
        for (let i = 0; i < 8; i++) cells[8 + i].ch = s[i];
        for (let i = 0; i < 16; i++) dstRow[i] = cells[i];
    }

    _speedForInterval(interval) {
        for (let i = SPEED_LEVELS.length - 1; i >= 0; i--)
            if (interval <= SPEED_LEVELS[i]) return i + 1;
        return 1;
    }

    _startTick() {
        this._stopTick();
        this._tickTimer = setInterval(() => this._tick(), this._currentInterval);
    }

    _stopTick() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
    }

    _tick() {
        if (this._completed || this._paused) return;

        if (this._pendingDir !== null) {
            if (this._pendingDir !== OPPOSITE[this._dir]) {
                this._dir = this._pendingDir;
            }
            this._pendingDir = null;
        }

        const head = this._snake[0];
        const nr = head.r + DY[this._dir];
        const nc = head.c + DX[this._dir];

        if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) {
            this._gameOver();
            return;
        }

        const key = nr * GRID_COLS + nc;
        if (this._snakeSet.has(key)) {
            this._gameOver();
            return;
        }

        const ate = (this._food && nr === this._food.r && nc === this._food.c);

        this._snake.unshift({ r: nr, c: nc });
        this._snakeSet.add(key);

        if (ate) {
            this._score += 10;
            this._foodEaten++;
            this._checkSpeedUp();
            this._spawnFood();
        } else {
            const tail = this._snake.pop();
            this._snakeSet.delete(tail.r * GRID_COLS + tail.c);
        }

        this._render();
    }

    _checkSpeedUp() {
        const cfg = DIFFICULTY[this._difficulty];
        const newLevel = Math.min(
            SPEED_LEVELS.length,
            this._startSpeedLevel + Math.floor(this._foodEaten / cfg.speedUpEvery)
        );
        if (newLevel !== this._speedLevel) {
            this._speedLevel = newLevel;
            const idx = Math.min(newLevel - 1, SPEED_LEVELS.length - 1);
            this._currentInterval = SPEED_LEVELS[idx];
            this._startTick();
        }
    }

    _spawnFood() {
        const occupied = new Set();
        for (const seg of this._snake) occupied.add(seg.r * GRID_COLS + seg.c);
        const empty = [];
        for (let r = 0; r < GRID_ROWS; r++)
            for (let c = 0; c < GRID_COLS; c++)
                if (!occupied.has(r * GRID_COLS + c)) empty.push([r, c]);
        if (empty.length === 0) {
            this._win();
            return;
        }
        const [r, c] = empty[Math.floor(Math.random() * empty.length)];
        this._food = { r, c };
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

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._queueDir(DIR.UP); return; }
            if (s === '\x1B[B') { this._queueDir(DIR.DOWN); return; }
            if (s === '\x1B[D') { this._queueDir(DIR.LEFT); return; }
            if (s === '\x1B[C') { this._queueDir(DIR.RIGHT); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            this._quit(); return;
        }

        if (code === 0x08 || code === 0x7F) return;

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'p') { this._pause(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    _queueDir(d) {
        const check = this._pendingDir !== null ? this._pendingDir : this._dir;
        if (d !== OPPOSITE[check]) this._pendingDir = d;
    }

    _pause() {
        if (this._completed) return;
        this._paused = !this._paused;
        if (this._paused) this._stopTick();
        else this._startTick();
        this._render();
    }

    _gameOver() {
        this._completed = true;
        this._stopTick();
        this._render();
    }

    _win() {
        this._completed = true;
        this._stopTick();
        this._render();
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._stopTick();
        term.write('\x1B[' + (BOARD_Y + BOARD_H + 1) + ';1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    _render() {
        const rootBuf = this._rootVB._buffer;
        for (let r = 0; r < this._rootVB.height; r++) {
            const row = rootBuf[r];
            for (let c = 0; c < row.length; c++) row[c] = this._cellEmpty;
        }
        this._renderSidebar();
        this._renderBoard();
    }

    _renderSidebar() {
        const vb = this._sidebarVB;
        const buf = vb._buffer;

        vb.writeStr(0, 0, bold(cyan('  Snake')) + gray(' [' + DIFFICULTY[this._difficulty].label + ']'));

        this._writeDynRow(buf[2], this._dynScore, this._score);
        this._writeDynRow(buf[3], this._dynSpeed, this._speedLevel);

        vb.writeStr(5, 0, gray('─'.repeat(16)));
        vb.writeStr(7, 0, gray(' ←↑↓→ Move'));
        vb.writeStr(8, 0, gray(' P Pause'));
        vb.writeStr(9, 0, gray(' Q Quit'));
    }

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
            const cell = isHead
                ? _makeCell('■', 15, 2, true)
                : _makeCell('■', 2, 22, false);
            const px = 1 + seg.c * 2;
            const py = 1 + seg.r;
            buf[py][px] = cell;
            buf[py][px + 1] = cell;
        }

        if (this._food && !this._completed) {
            const fc = _makeCell('◆', 1, 0, true);
            const fx = 1 + this._food.c * 2;
            const fy = 1 + this._food.r;
            buf[fy][fx] = fc;
            buf[fy][fx + 1] = fc;
        }

        if (this._paused) this._renderPauseOverlay(vb);
        else this._boardSlotPause.active = false;

        if (this._completed) this._renderGameOverOverlay(vb);
        else this._boardSlotGameOver.active = false;

        term.writeVB(this._rootVB);
    }

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
    }

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
    }

    static get commandName() { return 'snake'; }
    static get help() { return 'Play Snake (Nokia style)'; }
    static get menu() { return 'Snake'; }
    static get usage() { return 'snake [--easy|--medium|--hard]'; }
}
