import { CmdBase } from '../CmdBase.js';
import { _emptyBoard, _spawnTile, _copyBoard, _slide, _hasWon, _canMove } from './board.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE } from '../../util/sgr.js';
import { BOARD_Y, BOARD_H } from './constants.js';
import { renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META['2048'];

class Game2048Cmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args);
        if (p.hasHelp) return this.showHelp();
        this.addCleanup(() => this._cancelAnimation());
        this._startGame();
    }

    _cancelAnimation() {
        clearTimeout(this._animationTimer);
        this._animationTimer = null;
        this._animating = false;
    }

    _scheduleAnimation(callback, delay) {
        this._animationTimer = setTimeout(() => {
            this._animationTimer = null;
            callback();
        }, delay);
    }

    _startGame() {
        this._cancelAnimation();
        this._board = _emptyBoard();
        this._score = 0;
        this._best = 0;
        this._completed = false;
        this._won = false;
        this._continueAfterWin = false;
        this._prevBoard = null;
        this._prevScore = 0;
        this._animating = false;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._initVBs();
        _spawnTile(this._board);
        _spawnTile(this._board);
        this._render();
    }

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x03) { this._quit(); return; }

        if (this._completed) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._startGame(); return; }
            }
            return;
        }

        if (this._won && !this._continueAfterWin) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'c') {
                    this._continueAfterWin = true;
                    this._render();
                    return;
                }
                if (ch === 'q') { this._quit(); return; }
            }
            if (code === 0x1B) {
                const s = typeof data === 'string' ? data : '';
                if (s === '\x1B[3~') return;
                if (s === '\x1B[2~') return;
                if (s === '\x1B[H') return;
                if (s === '\x1B[F') return;
                if (s === '\x1B[5~') return;
                if (s === '\x1B[6~') return;
                if (s === '\x1B' || data === 0x1B) this._quit();
                return;
            }
            return;
        }

        if (this._animating) return;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._move(0); return; }
            if (s === '\x1B[B') { this._move(2); return; }
            if (s === '\x1B[D') { this._move(1); return; }
            if (s === '\x1B[C') { this._move(3); return; }
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
            if (ch === 'u') { this._undo(); return; }
            if (ch === 'r') { this._startGame(); return; }
            if (ch === 'n') { this._startGame(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    _move(dir) {
        if (this._animating) return;
        const prev = _copyBoard(this._board);
        const prevScore = this._score;
        const { board, slideBoard, mergeCells, moveCells, score, moved } = _slide(this._board, dir);
        if (!moved) return;

        this._prevBoard = prev;
        this._prevScore = prevScore;
        this._score += score;
        if (this._score > this._best) this._best = this._score;

        this._animating = true;

        const finishMerge = () => {
            this._board = board;
            _spawnTile(this._board);

            if (!this._won && _hasWon(this._board)) {
                this._won = true;
                this._render();
                this._renderWinOverlay();
                term.writeVB(this._rootVB);
            } else {
                if (!_canMove(this._board)) this._completed = true;
                this._render();
            }
            this._animating = false;
        };

        if (moveCells.length > 0) {
            this._renderMoveOverlay(moveCells);
            const hasMerge = mergeCells.length > 0;
            const moveDelay = hasMerge ? 30 : 60;

            this._scheduleAnimation(() => {
                this._board = slideBoard;
                this._render();

                if (hasMerge) {
                    this._scheduleAnimation(() => {
                        this._renderMergeOverlay(mergeCells);
                        this._scheduleAnimation(finishMerge, 80);
                    }, 30);
                } else {
                    finishMerge();
                }
            }, moveDelay);
        } else if (mergeCells.length > 0) {
            this._board = slideBoard;
            this._render();

            this._scheduleAnimation(() => {
                this._renderMergeOverlay(mergeCells);
                this._scheduleAnimation(finishMerge, 80);
            }, 30);
        } else {
            finishMerge();
        }
    }

    _undo() {
        if (!this._prevBoard || this._completed || this._animating) return;
        this._board = this._prevBoard;
        this._score = this._prevScore;
        this._prevBoard = null;
        this._prevScore = 0;
        this._render();
    }

    _quit() {
        this._cancelAnimation();
        this.placeShellCursor(BOARD_Y + BOARD_H + 1);
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
        Object.defineProperty(Game2048Cmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { Game2048Cmd };
