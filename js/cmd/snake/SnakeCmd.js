import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE, yellow } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import {
    DIFFICULTY, GRID_COLS, GRID_ROWS, DIR, SPEED_LEVELS, OPPOSITE, DY, DX, BOARD_Y, BOARD_H,
} from './constants.js';
import { renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.snake;

class SnakeCmd extends CmdBase {
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
        this._difficultyDialog = this.openDialog(SelectDialog, 'snake-diff', {
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
    }

    _startGame(diff) {
        const cfg = DIFFICULTY[diff];
        this._difficulty = diff;
        this._score = 0;
        this._speedLevel = this._speedForInterval(cfg.startSpeed);
        this._startSpeedLevel = this._speedLevel;
        this._currentInterval = cfg.startSpeed;
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
            this._startSpeedLevel + Math.floor(
                this._score / (10 * cfg.speedUpEvery)
            )
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
                if (s === '\x1B' || data === 0x1B) this._quit();
                return;
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
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
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
        this.placeShellCursor(BOARD_Y + BOARD_H);
        this.close();
    }

    onCancel() {
        this._quit();
    }


    static get commandName() { return META.commandName; }
    static get help() { return META.help; }
    static get menu() { return META.menu; }
    static get usage() { return META.usage; }
}

// Keep the command as the state owner and preserve class-method descriptors.
for (const methods of [renderMethods]) {
    for (const [name, value] of Object.entries(methods)) {
        Object.defineProperty(SnakeCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { SnakeCmd };
