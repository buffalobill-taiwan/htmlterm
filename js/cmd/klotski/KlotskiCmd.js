import { CmdBase } from '../CmdBase.js';
import { term, system } from '../../system/sys.js';
import { CURSOR_HIDE } from '../../util/sgr.js';
import { LevelSelectDialog } from './LevelSelectDialog.js';
import { LEVELS } from '../../util/klotski-levels.js';
import { ROWS, COLS, FINISH_FALL, BOARD_Y, BOARD_H } from './constants.js';
import { NAME_COLOR, renderMethods } from './render.js';
import { ConfirmDialog } from '../../dialog/ConfirmDialog.js';
import klotskiSolutions from '../../util/klotski-solutions.json' with { type: 'json' };

class KlotskiCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {});
        if (p.hasHelp) return this.showHelp();
        this.open();
        this._showLevelMenu();
    }

    _showLevelMenu() {
        this._stopAuto();
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
        this._levelDialog = this.openDialog(LevelSelectDialog, 'klotski-level', {
            onSelect: (idx) => {
                this._levelDialog = null;
                this._startGame(idx);
            },
            onCancel: () => {
                this._levelDialog = null;
                this._quit();
            },
        });
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
        if (!this._autoPlay) {
            const last = this._history[this._history.length - 1];
            if (!last || last.id !== id) {
                this._history.push({ id, fromR: b.r, fromC: b.c });
                this._moves++;
            }
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

    _restart() {
        const lv = LEVELS[this._levelIdx];
        this._stopAuto();
        this._stopTimer();
        this._cancelFinishAnim();
        this._moves = 0;
        this._time = 0;
        this._completed = false;
        this._finishing = false;
        this._animOffset = 0;
        this._paused = false;
        this._selected = null;
        this._history = [];
        this._cursor = { r: 2, c: 1 };
        this._buildBlocks(lv.board);
        this._buildBoardGrid();
        this._render();
        this._startTimer();
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

    _showAutoConfirm() {
        if (this._completed || this._autoPlay) return;
        system.createDialog(ConfirmDialog, 'klotski-auto', {
            title: '確認',
            message: '是否自動演示？\n將重設局面並自動解題。',
            footer: '←→ 選擇  ↩ 確認  ESC 取消',
            onConfirm: () => this._startAuto(),
            onCancel: () => {},
        });
    }

    _stopAuto() {
        this._autoPlay = false;
        if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; }
    }

    _startAuto() {
        this._stopAuto();
        const lv = LEVELS[this._levelIdx];
        this._stopTimer();
        this._cancelFinishAnim();
        this._moves = 0;
        this._time = 0;
        this._completed = false;
        this._finishing = false;
        this._animOffset = 0;
        this._paused = false;
        this._selected = null;
        this._history = [];
        this._cursor = { r: 2, c: 1 };
        this._buildBlocks(lv.board);
        this._buildBoardGrid();
        this._render();
        const flat = klotskiSolutions[lv.board];
        if (!flat) { this._startTimer(); return; }
        this._autoPlay = true;
        let i = 0;
        let lastId = -1;
        const step = () => {
            if (this._completed) { this._stopAuto(); this._startTimer(); return; }
            if (this._paused) { this._autoTimer = setTimeout(step, 300); return; }
            if (i >= flat.length) { this._stopAuto(); this._startTimer(); return; }
            const mv = flat[i++];
            if (mv.id !== lastId) this._moves++;
            lastId = mv.id;
            this._slide(mv.id, mv.dr, mv.dc);
            this._autoTimer = setTimeout(step, 300);
        };
        this._autoTimer = setTimeout(step, 500);
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
        this._stopAuto();
        this._cancelFinishAnim();
        if (this._levelDialog) {
            this._levelDialog.close();
            this._levelDialog = null;
        }
        this._stopTimer();
        this._completed = false;
        this._paused = false;
        term.write('\x1B[2J\x1B[1;1H');
        this.placeShellCursor(BOARD_Y + BOARD_H + 1);
        this.close();
    }

    onCancel() {
        this._quit();
    }

    _onKey(data) {
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

        if (this._autoPlay) {
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
                if (ch === 'r') { this._restart(); return; }
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._showLevelMenu(); return; }
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
                if (ch === 'r') { this._restart(); return; }
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
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
        }

        if (code === 0x20 || code === 0x0D) { this._toggleSelect(); return; }
        if (code === 0x08 || code === 0x7F) return;

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'z') { if (this._selected === null) this._undo(); return; }
            if (ch === 'p') { this._togglePause(); return; }
            if (ch === 'r') { this._restart(); return; }
            if (ch === 'n') { this._showLevelMenu(); return; }
            if (ch === 'a') { this._showAutoConfirm(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    static get commandName() { return 'klotski'; }

    static get help() { return 'Play Klotski 華容道'; }

    static get menu() { return 'Klotski 華容道'; }

    static get usage() { return 'klotski'; }
}

// Keep the command as the state owner and preserve class-method descriptors.
for (const methods of [renderMethods]) {
    for (const [name, value] of Object.entries(methods)) {
        Object.defineProperty(KlotskiCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { KlotskiCmd };
