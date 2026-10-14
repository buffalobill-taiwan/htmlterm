import { CmdBase } from '../CmdBase.js';
import { GAME_META } from '../game-meta.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE } from '../../util/sgr.js';
import { FieldPickerDialog } from '../../dialog/FieldPickerDialog.js';
import { DIFFICULTY, generateMaze } from './board.js';
import { initView, render } from './render.js';

const META = GAME_META.maze;
const MOVES = {
    '\x1B[A': [0, -1], '\x1B[B': [0, 1], '\x1B[C': [1, 0], '\x1B[D': [-1, 0],
    w: [0, -1], s: [0, 1], d: [1, 0], a: [-1, 0],
};

export class MazeCmd extends CmdBase {
    execute(args) {
        if (this.parseArgs(args).hasHelp) return this.showHelp();
        const difficulties = args.map(a => a.replace(/^--/, ''));
        if (difficulties.length > 1 || difficulties.some(d => !Object.hasOwn(DIFFICULTY, d))) {
            this.error('Usage: maze [--easy|--medium|--hard]');
            return;
        }
        this._root = null;
        this.open();
        term.write('\x1B[2J\x1B[H' + CURSOR_HIDE);
        if (difficulties.length) this._start(difficulties[0]);
        else this._pickDifficulty();
    }

    _pickDifficulty() {
        this._dialog = this.openDialog(FieldPickerDialog, 'maze-diff', {
            title: 'Maze 迷宮',
            fields: [{ key: 'difficulty', label: '難度', options: [
                ['Easy 20x10', 'easy'], ['Medium 40x15', 'medium'], ['Hard 60x20', 'hard'],
            ] }],
            onConfirm: ({ difficulty }) => {
                this._dialog = null;
                this._start(difficulty);
            },
            onCancel: () => {
                this._dialog = null;
                if (!this._root) this._quit();
            },
        });
    }

    _start(difficulty) {
        this._difficulty = difficulty;
        [this._width, this._height] = DIFFICULTY[difficulty];
        this._walls = generateMaze(this._width, this._height);
        initView(this);
        this._restart();
    }

    _restart() {
        this._x = 0;
        this._y = 0;
        this._steps = 0;
        this._won = false;
        this._revealLeft = 0;
        this._visited = new Uint8Array(this._width * this._height);
        this._visited[0] = 1;
        render(this);
    }

    _onKey(data) {
        if (data === '\x1B' || data === 27 || data === '\x03' || data === 3) return this._quit();
        const key = typeof data === 'string' && data.length === 1 ? data.toLowerCase() : data;
        if (key === 'q') return this._quit();
        if (key === 'n') return this._pickDifficulty();
        if (key === 'r') return this._restart();
        const move = MOVES[key];
        if (!move) return;
        if (this._won) {
            const left = Math.max(0, Math.min(this._width - this._viewWidth, this._revealLeft + move[0]));
            if (left !== this._revealLeft) {
                this._revealLeft = left;
                render(this);
            }
            return;
        }
        const x = this._x + move[0], y = this._y + move[1];
        if (x < 0 || x >= this._width || y < 0 || y >= this._height || this._walls[y * this._width + x]) return;
        this._x = x;
        this._y = y;
        this._steps++;
        this._visited[y * this._width + x] = 1;
        this._won = x === this._width - 1 && y === this._height - 1;
        if (this._won) this._revealLeft = this._width - this._viewWidth;
        render(this);
    }

    _quit() {
        if (this._dialog) { this._dialog.close(); this._dialog = null; }
        this.placeShellCursor(this._root ? 24 : 0);
        this.close();
    }

    onCancel() { this._quit(); }
    static get commandName() { return META.commandName; }
    static get help() { return META.help; }
    static get usage() { return META.usage; }
    static get menu() { return META.menu; }
}
