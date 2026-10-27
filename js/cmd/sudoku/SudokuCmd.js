import { CmdBase } from '../CmdBase.js';
import { _createEmpty, _generate, _copyGrid } from './solver.js';
import { SIZE, BOX } from './constants.js';
import { term, system } from '../../system/sys.js';
import { CURSOR_HIDE, yellow, bold, red, gray, green } from '../../util/sgr.js';
import { ConfirmDialog } from '../../dialog/ConfirmDialog.js';
import { seedFromArgs } from '../../util/seed-args.js';
import { renderMethods } from './render.js';
import { installMethods } from '../../util/install-methods.js';
import { formatDuration } from '../../util/format.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.sudoku;

class SudokuCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {
            flags: { '--easy': Boolean, '--medium': Boolean, '--hard': Boolean, '--seed': String },
        });
        if (p.hasHelp) return this.showHelp();
        const { seed, error } = seedFromArgs(args, p);
        if (error) {
            this.error(error);
            return this.showHelp();
        }
        this._hintDigit = 0;
        this._hintMask = new Uint8Array(SIZE * SIZE);
        const releaseHint = () => this._setHintDigit(0);
        // Observe the physical release before IME/input routing can consume it.
        // Checking modifier state also recovers when a platform reports a
        // different key name for the release.
        const releaseHintOnKeyUp = event => {
            if (event.key === 'Control' || event.code === 'ControlLeft' ||
                event.code === 'ControlRight' || event.ctrlKey === false) releaseHint();
        };
        const showHintOnKeyDown = event => {
            const top = system.cmdStack[system.cmdStack.length - 1];
            if (top?.cmd !== this || this.closed || this._completed || !this._difficulty) return;
            if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
            const digit = /^[1-9]$/.test(event.key) ? Number(event.key) :
                /^Digit[1-9]$/.test(event.code) ? Number(event.code.slice(-1)) : 0;
            if (!digit) return;
            event.preventDefault();
            event.stopPropagation();
            this._setHintDigit(digit);
        };
        window.addEventListener('keydown', showHintOnKeyDown, true);
        window.addEventListener('keyup', releaseHintOnKeyUp, true);
        window.addEventListener('blur', releaseHint);
        this.addCleanup(() => {
            window.removeEventListener('keydown', showHintOnKeyDown, true);
            window.removeEventListener('keyup', releaseHintOnKeyUp, true);
            window.removeEventListener('blur', releaseHint);
            releaseHint();
        });
        let diff = null;
        if (p.flag('--easy'))   diff = 'easy';
        if (p.flag('--medium')) diff = 'medium';
        if (p.flag('--hard'))   diff = 'hard';
        if (diff || seed !== undefined) {
            this._startGame(diff || 'medium', seed);
        } else {
            this._pickDifficulty();
        }
    }

    _pickDifficulty() {
        this._setHintDigit(0);
        this._board = _createEmpty();
        this._given = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
        this._solution = _createEmpty();
        this._cursorRow = 4;
        this._cursorCol = 4;
        this._autoCheck = true;
        this._completed = false;
        this._timer = 0;
        this._errors = new Set();
        this._difficulty = null;
        this._seed = null;

        this.open();
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._render();
        this.openDifficultyDialog({
            key: 'sudoku-diff',
            title: 'Sudoku',
            onConfirm: ({ difficulty }) => this._startGame(difficulty),
        });
    }

    _startGame(difficulty, seed) {
        this._difficulty = difficulty;
        this._completed = false;
        this._timer = 0;
        this._autoCheck = true;
        this._errors = new Set();
        this._difficultyDialog = null;

        const { board, solution, given, seed: puzzleSeed } = _generate(difficulty, seed);
        this._seed = puzzleSeed;
        this._board = board;
        this._solution = solution;
        this._given = given;
        this._initialBoard = _copyGrid(board);
        this._cursorRow = 4;
        this._cursorCol = 4;

        this.open();
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._render();
        this._timerInterval = setInterval(() => {
            if (this._completed) return;
            this._timer++;
            this._updateHeader();
        }, 1000);
    }

    _checkWin() {
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (this._board[r][c] !== this._solution[r][c]) return false;
        return true;
    }

    _giveUpConfirm() {
        if (this._completed) return;
        this._setHintDigit(0);
        system.createDialog(ConfirmDialog, 'sudoku-confirm', {
            title: 'Confirm',
            message: 'Give up and reveal\nthe answer?',
            onConfirm: () => this._giveUp(),
        });
    }

    _giveUp() {
        this._setHintDigit(0);
        this._completed = true;
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                this._board[r][c] = this._solution[r][c];
        this._autoCheck = false;
        this._render();
        const timeStr = formatDuration(this._timer);
        this._rootVB.writeStr(20, 0, bold(red('  Game Over')) + '  ' +
            yellow('Time: ' + timeStr));
        this._rootVB.writeStr(21, 0, gray('  Press [n]ew game or [q]uit'));
        term.writeVB(this._rootVB);
    }

    _win() {
        this._setHintDigit(0);
        this._completed = true;
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        const timeStr = formatDuration(this._timer);
        this._rootVB.writeStr(20, 0, bold(green('  Congratulations!')) + '  ' +
            yellow('Time: ' + timeStr));
        this._rootVB.writeStr(21, 0, gray('  Press [n]ew game or [q]uit'));
        term.writeVB(this._rootVB);
    }

    _setHintDigit(digit) {
        if (digit === this._hintDigit) return;
        this._hintDigit = digit;
        this._refreshHint();
    }

    _refreshHint() {
        const mask = this._hintMask;
        mask.fill(0);
        if (this._hintDigit) {
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    if (this._board[r][c] !== this._hintDigit) continue;
                    const br = Math.floor(r / BOX) * BOX;
                    const bc = Math.floor(c / BOX) * BOX;
                    for (let i = 0; i < SIZE; i++) {
                        mask[r * SIZE + i] = 1;
                        mask[i * SIZE + c] = 1;
                        mask[(br + Math.floor(i / BOX)) * SIZE + bc + i % BOX] = 1;
                    }
                }
            }
        }
        for (let r = 0; r < SIZE; r++) this._drawBoardRow(this._boardVB, r);
        term.writeVB(this._rootVB);
    }

    _onKey(data) {

        if (this._completed) {
            const code = typeof data === 'string' ? data.charCodeAt(0) : data;
            if (code === 0x03) { this._quit(); return; }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._newGame(); return; }
            }
            return;
        }

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A' || s === '\x1B[1;5A') { this._move(0, -1); return; }
            if (s === '\x1B[B' || s === '\x1B[1;5B') { this._move(0, 1); return; }
            if (s === '\x1B[D' || s === '\x1B[1;5D') { this._move(-1, 0); return; }
            if (s === '\x1B[C' || s === '\x1B[1;5C') { this._move(1, 0); return; }
            if (s === '\x1B[3~') { this._clearCell(); return; }
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'g') { this._giveUpConfirm(); return; }
            if (ch === 'n') { this._newGame(); return; }
            if (ch === 'r') { this._restart(); return; }
            if (ch === 'c') { this._toggleCheck(); return; }
        }

        if (typeof data === 'string' && data >= '1' && data <= '9') {
            this._enterDigit(parseInt(data, 10));
            return;
        }

        if (code === 0x08 || code === 0x7F || (typeof data === 'string' && data === '0')) {
            this._clearCell();
            return;
        }
    }

    _move(dx, dy) {
        const oldRow = this._cursorRow;
        const oldCol = this._cursorCol;
        this._cursorCol = Math.max(0, Math.min(SIZE - 1, this._cursorCol + dx));
        this._cursorRow = Math.max(0, Math.min(SIZE - 1, this._cursorRow + dy));
        if (oldRow !== this._cursorRow) this._renderRow(oldRow);
        if (oldCol !== this._cursorCol || oldRow !== this._cursorRow) this._renderRow(this._cursorRow);
    }

    _enterDigit(num) {
        const r = this._cursorRow;
        const c = this._cursorCol;
        if (this._given[r][c]) return;
        const oldVal = this._board[r][c];
        this._board[r][c] = num;

        if (this._autoCheck && this._hasConflict(r, c)) {
            this._errors.add(r + ',' + c);
        } else {
            this._errors.delete(r + ',' + c);
        }

        if (this._hintDigit) this._refreshHint();
        this._renderRow(r);
        if (oldVal > 0) this._updateDigitRow(oldVal);
        if (num > 0 && num !== oldVal) this._updateDigitRow(num);
        if (this._checkWin()) this._win();
    }

    _clearCell() {
        const r = this._cursorRow;
        const c = this._cursorCol;
        if (this._given[r][c]) return;
        if (this._board[r][c] === 0) return;
        const oldVal = this._board[r][c];
        this._board[r][c] = 0;
        this._errors.delete(r + ',' + c);
        if (this._hintDigit) this._refreshHint();
        this._renderRow(r);
        this._updateDigitRow(oldVal);
    }

    _toggleCheck() {
        this._autoCheck = !this._autoCheck;
        this._render();
    }

    _newGame() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        this._pickDifficulty();
    }

    _restart() {
        this._setHintDigit(0);
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                this._board[r][c] = this._given[r][c] ? this._initialBoard[r][c] : 0;
        this._completed = false;
        this._errors.clear();
        this._timer = 0;
        this._autoCheck = true;
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        this._render();
        this._timerInterval = setInterval(() => {
            if (this._completed) return;
            this._timer++;
            this._updateHeader();
        }, 1000);
    }

    _quit() {
        this._setHintDigit(0);
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        const row = this._completed ? 23 : 21;
        this.placeShellCursor(row - 1);
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
installMethods(SudokuCmd, renderMethods);

export { SudokuCmd };
