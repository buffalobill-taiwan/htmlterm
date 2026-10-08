import { CmdBase } from '../CmdBase.js';
import { DIFFICULTY, SEED_MAX, MIN_SIZE, MAX_SIZE, _sizeLabel } from './constants.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE, yellow, bold, red, gray, green } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { _create2D, _analyzeClueColors, _analyzePools, _analyzeSeaConnectivity } from './analysis.js';
import { WHITE, geom, generatePuzzle, BLACK, isSolved } from '../../util/nurikabe-engine.js';
import { _formatTime, renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.nurikabe;

class NurikabeCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {
            flags: {
                '--easy': Boolean, '--medium': Boolean, '--hard': Boolean,
                '--seed': Number, '--size': Number,
            },
        });
        if (p.hasHelp) return this.showHelp();

        let diffSize = null;
        if (p.flag('--easy'))   diffSize = DIFFICULTY.easy.size;
        if (p.flag('--medium')) diffSize = DIFFICULTY.medium.size;
        if (p.flag('--hard'))   diffSize = DIFFICULTY.hard.size;

        if (p.rest.length > 2) return this._badArgs();
        let posSeed = null;
        let posSize = null;
        if (p.rest.length >= 1) {
            const n = this._toInt(p.rest[0]);
            if (n === null) return this._badArgs();
            posSeed = n;
        }
        if (p.rest.length === 2) {
            const n = this._toInt(p.rest[1]);
            if (n === null) return this._badArgs();
            posSize = n;
        }

        const flagSeed = this._numFlag(p.flag('--seed'));
        const flagSize = this._numFlag(p.flag('--size'));
        if (flagSeed === undefined || flagSize === undefined) return this._badArgs();

        const seed = flagSeed !== null ? flagSeed : posSeed;
        const size = flagSize !== null ? flagSize : (posSize !== null ? posSize : (diffSize !== null ? diffSize : DIFFICULTY.medium.size));

        const hasParams = seed !== null || posSize !== null || flagSize !== null;
        if (!hasParams && diffSize === null) return this._pickDifficulty();

        if (seed !== null && (seed < 0 || seed > SEED_MAX)) return this._badArgs();
        if (size < MIN_SIZE || size > MAX_SIZE) return this._badArgs();
        return this._startGame(size, seed);
    }

    _toInt(v) {
        if (typeof v !== 'string' && typeof v !== 'number') return null;
        const n = Number(v);
        return Number.isInteger(n) ? n : null;
    }

    _numFlag(v) {
        if (v === null) return null;
        if (typeof v === 'boolean') return undefined;
        const n = this._toInt(v);
        return n === null ? undefined : n;
    }

    _badArgs() {
        this.error('invalid arguments');
        this.showHelp();
        return null;
    }

    _pickDifficulty() {
        this._stopTimer();
        this._completed = false;
        this._timer = 0;
        this._generating = false;
        this._spaceHeld = false;
        this._paintTarget = null;
        this._connectivityHeld = false;
        this._connectivityMask = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        const opts = ['Easy', 'Medium', 'Hard'];
        this._difficultyDialog = this.openDialog(SelectDialog, 'nurikabe-diff', {
            title: 'Nurikabe',
            message: yellow('Select difficulty'),
            options: opts,
            footer: '← → Move  ↩ Confirm  ESC Quit',
            onSelect: (idx) => {
                this._difficultyDialog = null;
                this._startGame(DIFFICULTY[opts[idx].toLowerCase()].size);
            },
            onCancel: () => {
                this._difficultyDialog = null;
                this._quit();
            },
        });
    }

    async _startGame(size, seed = null) {
        this._cancelGeneration?.();
        this._stopTimer();
        this._size = size;
        this._label = _sizeLabel(size);
        this._completed = false;
        this._won = false;
        this._cursorRow = Math.floor(size / 2);
        this._cursorCol = Math.floor(size / 2);
        this._timer = 0;
        this._difficultyDialog = null;
        this._generating = true;
        this._clues = null;
        this._solution = null;
        this._player = null;
        this._spaceHeld = false;
        this._paintTarget = null;
        this._connectivityHeld = false;
        this._connectivityMask = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._renderGenerating();

        const generation = { active: true, timer: null, resume: null };
        const cancel = () => {
            generation.active = false;
            clearTimeout(generation.timer);
            generation.resume?.();
            generation.resume = null;
        };
        this._cancelGeneration = cancel;
        const removeCleanup = this.addCleanup(cancel);
        this.holdBusy();
        let gen;
        let failure = 'Failed to generate puzzle.';
        try {
            gen = await this._generateAsync(size, generation, seed);
        } catch (err) {
            failure = 'Generation failed: ' + (err.message || String(err));
        } finally {
            removeCleanup();
        }
        if (!generation.active) return;
        this._cancelGeneration = null;
        this._generating = false;
        this.releaseBusy();

        if (!gen) {
            this._clearLayout();
            this._rootVB.writeStr(0, 0, bold(red('  ' + failure)));
            this._rootVB.writeStr(2, 0, gray('  Press [n] to retry or [q] to quit.'));
            term.writeVB(this._rootVB);
            this._completed = true;
            return;
        }

        this._seed = gen.seed;
        this._clues = gen.puzzle.clues;
        this._solution = gen.puzzle.solution;
        this._player = _create2D(size, size, WHITE);
        this._geom = geom(size, size);
        this._puzzleFlat = {
            R: size,
            C: size,
            clues: gen.puzzle.clues.flat(),
        };
        this._updateClueColors();

        this._render();
        this._startTimer();
    }

    async _generateAsync(size, generation, seed = null) {
        const maxAttempts = size <= 8 ? 300 : size <= 12 ? 600 : 1200;
        const baseSeed = seed != null ? seed : (Date.now() & 0x7fffffff);
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (!generation.active) return null;
            const puzzle = generatePuzzle(size, size, {
                seed: baseSeed + attempt,
                maxAttempts: 1,
            });
            if (puzzle) return { puzzle, seed: baseSeed + attempt };
            // Yield to the UI thread every attempt so the browser never freezes.
            // For large boards each attempt can take 10-100ms; batching would cause jank.
            await new Promise(resolve => {
                generation.resume = resolve;
                generation.timer = setTimeout(() => {
                    generation.timer = null;
                    generation.resume = null;
                    resolve();
                }, 0);
            });
        }
        return null;
    }

    _updateClueColors() {
        this._clueStatus = _analyzeClueColors(this._size, this._player, this._clues);
        this._poolMask = _analyzePools(this._size, this._player);
    }

    _toggleCell() {
        if (this._completed || this._clues[this._cursorRow][this._cursorCol] > 0) return;
        const r = this._cursorRow;
        const c = this._cursorCol;
        this._player[r][c] = this._player[r][c] === WHITE ? BLACK : WHITE;
        this._updateClueColors();
        this._drawBoard();
        if (this._connectivityHeld) this._updateConnectivity();
        this._checkWin();
    }

    _checkWin() {
        const size = this._size;
        const state = new Int8Array(size * size);
        for (let r = 0; r < size; r++)
            for (let c = 0; c < size; c++)
                state[r * size + c] = this._player[r][c];
        if (isSolved(state, this._geom, this._puzzleFlat))
            this._gameOver(true);
    }

    _gameOver(won) {
        this._completed = true;
        this._won = won;
        this._spaceHeld = false;
        this._paintTarget = null;
        this._connectivityHeld = false;
        this._connectivityMask = null;
        this._stopTimer();
        this._updateClueColors();
        this._drawHeader();
        this._drawBoard();
        const timeStr = _formatTime(this._timer);
        const fRow = this._footerRow();
        const msg = won
            ? bold(green('  Congratulations!')) + '  ' + yellow('Time: ' + timeStr)
            : bold(red('  Game Over')) + '  ' + yellow('Time: ' + timeStr);
        this._clearRow(fRow - 1);
        this._clearRow(fRow);
        this._rootVB.writeStr(fRow - 1, 0, msg);
        this._rootVB.writeStr(fRow, 0, gray('  Press [n]ew game or [q]uit'));
        term.writeVB(this._rootVB);
    }

    _move(dr, dc) {
        const nr = this._cursorRow + dr;
        const nc = this._cursorCol + dc;
        if (nr < 0 || nr >= this._size || nc < 0 || nc >= this._size) return;
        const oldR = this._cursorRow;
        const oldC = this._cursorCol;
        this._cursorRow = nr;
        this._cursorCol = nc;
        if (this._connectivityHeld) {
            this._updateConnectivity();
        } else if (this._spaceHeld && this._paintCell()) {
            // full board already redrawn with cursor
        } else {
            this._drawRow(oldR);
            this._drawRow(nr);
        }
    }

    _paintCell() {
        const r = this._cursorRow;
        const c = this._cursorCol;
        if (this._clues[r][c] > 0 || this._paintTarget == null) return false;
        this._player[r][c] = this._paintTarget;
        this._updateClueColors();
        this._drawBoard();
        if (this._connectivityHeld) this._updateConnectivity();
        this._checkWin();
        return true;
    }

    _updateConnectivity() {
        this._connectivityMask = _analyzeSeaConnectivity(this._size, this._player, this._cursorRow, this._cursorCol);
        this._drawBoard();
    }

    handleKeyUp(key) {
        if (key === ' ') this._spaceHeld = false;
        if (key.toLowerCase() === 'c' && this._connectivityHeld) {
            this._connectivityHeld = false;
            this._connectivityMask = null;
            this._drawBoard();
        }
    }

    _onKey(data) {
        if (data === '\x1B' || data === 0x1B) { this._quit(); return; }
        if (this._generating) return;

        if (this._completed && !this._clues) {
            const code = typeof data === 'string' ? data.charCodeAt(0) : data;
            if (code === 0x03) { this._quit(); return; }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

        if (this._completed) {
            const code = typeof data === 'string' ? data.charCodeAt(0) : data;
            if (code === 0x03) { this._quit(); return; }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._move(-1, 0); return; }
            if (s === '\x1B[B') { this._move(1, 0); return; }
            if (s === '\x1B[D') { this._move(0, -1); return; }
            if (s === '\x1B[C') { this._move(0, 1); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (code === 0x20) {
            if (!this._spaceHeld) {
                this._spaceHeld = true;
                this._toggleCell();
                this._paintTarget = this._player[this._cursorRow][this._cursorCol];
            }
            return;
        }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'n') { this._pickDifficulty(); return; }
            if (ch === 'r') { this._restart(); return; }
            if (ch === 'c' && !this._connectivityHeld) {
                this._connectivityHeld = true;
                this._updateConnectivity();
                return;
            }
        }
    }

    _restart() {
        const size = this._size;
        for (let r = 0; r < size; r++)
            for (let c = 0; c < size; c++)
                this._player[r][c] = WHITE;
        this._completed = false;
        this._won = false;
        this._timer = 0;
        this._spaceHeld = false;
        this._paintTarget = null;
        this._connectivityHeld = false;
        this._connectivityMask = null;
        this._updateClueColors();
        this._render();
        this._startTimer();
    }

    _startTimer() {
        this._stopTimer();
        this._timerInterval = setInterval(() => {
            if (this._completed || this._generating) return;
            this._timer++;
            this._drawHeader();
        }, 1000);
        this._removeTimerCleanup = this.addCleanup(() => this._stopTimer());
    }

    _stopTimer() {
        clearInterval(this._timerInterval);
        this._timerInterval = null;
        this._removeTimerCleanup?.();
        this._removeTimerCleanup = null;
    }

    _quit() {
        if (this._cancelGeneration) {
            this._cancelGeneration();
            this._cancelGeneration = null;
            this._generating = false;
            this.releaseBusy();
        }
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._spaceHeld = false;
        this._paintTarget = null;
        this._connectivityHeld = false;
        this._connectivityMask = null;
        this._stopTimer();
        if (this._size) {
            this.placeShellCursor(this._footerRow() + 1);
        }
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
        Object.defineProperty(NurikabeCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { NurikabeCmd };
