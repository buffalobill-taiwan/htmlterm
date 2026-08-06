import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import {
    generatePuzzle, formatClue, geom, isSolved, WHITE, BLACK,
} from '../util/nurikabe-engine.js';
import { isWide } from '../util/unicode-width.js';
import { bold, red, green, yellow, cyan, gray, white, CURSOR_HIDE } from '../util/sgr.js';

const DIFFICULTY = {
    easy:   { size: 7,  label: 'Easy' },
    medium: { size: 12, label: 'Medium' },
    hard:   { size: 18, label: 'Hard' },
};

const CLUE_CONNECTED = 'connected';
const CLUE_OK = 'ok';
const CLUE_OVER = 'over';
const CLUE_BAD = 'bad';

const CELL_ISLAND = '　';
const CELL_SEA    = '  ';

if (!isWide(CELL_ISLAND)) {
    throw new Error('Nurikabe island glyph must be wide (2-column).');
}

function _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _create2D(cols, rows, val) {
    return Array.from({ length: rows }, () => Array(cols).fill(val));
}

function _analyzeClueColors(size, player, clues) {
    const status = Array.from({ length: size }, () => Array(size).fill(null));
    const seen = Array.from({ length: size }, () => Array(size).fill(false));

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (seen[r][c] || player[r][c] !== WHITE) continue;

            const clueCells = [];
            const stack = [[r, c]];
            seen[r][c] = true;
            let regionSize = 0;

            while (stack.length) {
                const [cr, cc] = stack.pop();
                regionSize++;
                if (clues[cr][cc] > 0) clueCells.push([cr, cc]);
                if (cr > 0 && !seen[cr - 1][cc] && player[cr - 1][cc] === WHITE) {
                    seen[cr - 1][cc] = true;
                    stack.push([cr - 1, cc]);
                }
                if (cr + 1 < size && !seen[cr + 1][cc] && player[cr + 1][cc] === WHITE) {
                    seen[cr + 1][cc] = true;
                    stack.push([cr + 1, cc]);
                }
                if (cc > 0 && !seen[cr][cc - 1] && player[cr][cc - 1] === WHITE) {
                    seen[cr][cc - 1] = true;
                    stack.push([cr, cc - 1]);
                }
                if (cc + 1 < size && !seen[cr][cc + 1] && player[cr][cc + 1] === WHITE) {
                    seen[cr][cc + 1] = true;
                    stack.push([cr, cc + 1]);
                }
            }

            const connected = clueCells.length > 1;
            for (const [cr, cc] of clueCells) {
                const n = clues[cr][cc];
                if (connected) status[cr][cc] = CLUE_CONNECTED;
                else if (regionSize === n) status[cr][cc] = CLUE_OK;
                else if (regionSize > n) status[cr][cc] = CLUE_OVER;
                else status[cr][cc] = CLUE_BAD;
            }
        }
    }
    return status;
}

function _analyzePools(size, player) {
    const pool = Array.from({ length: size }, () => Array(size).fill(false));
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            if (player[r][c] === BLACK && player[r][c + 1] === BLACK &&
                player[r + 1][c] === BLACK && player[r + 1][c + 1] === BLACK) {
                pool[r][c] = true;
                pool[r][c + 1] = true;
                pool[r + 1][c] = true;
                pool[r + 1][c + 1] = true;
            }
        }
    }
    return pool;
}

function _styleClue(status, ch) {
    if (status === CLUE_CONNECTED || status === CLUE_OVER) return gray(ch);
    if (status === CLUE_OK) return bold(white(ch));
    return red(ch);
}

export class NurikabeCmd extends CmdBase {
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
        this._timer = 0;
        this._difficulty = null;
        this._generating = false;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        const opts = ['Easy', 'Medium', 'Hard'];
        const dialog = new SelectDialog(term, {
            title: 'Nurikabe',
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

    async _startGame(diff) {
        const cfg = DIFFICULTY[diff];
        this._difficulty = diff;
        this._size = cfg.size;
        this._completed = false;
        this._won = false;
        this._cursorRow = Math.floor(cfg.size / 2);
        this._cursorCol = Math.floor(cfg.size / 2);
        this._timer = 0;
        this._difficultyDialog = null;
        this._generating = true;
        this._clues = null;
        this._solution = null;
        this._player = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._renderGenerating();

        this.holdBusy();
        const epoch = this.abortEpoch;
        const puzzle = await this._generateAsync(cfg.size, epoch);
        this.releaseBusy();

        if (this.closed || epoch !== this.abortEpoch) return;

        this._generating = false;
        if (!puzzle) {
            term.write('\x1B[2J\x1B[1;1H');
            term.write(bold(red('  Failed to generate puzzle. Press [n] to retry or [q] to quit.\n')));
            this._completed = true;
            return;
        }

        this._clues = puzzle.clues;
        this._solution = puzzle.solution;
        this._player = _create2D(cfg.size, cfg.size, WHITE);
        this._geom = geom(cfg.size, cfg.size);
        this._puzzleFlat = {
            R: cfg.size,
            C: cfg.size,
            clues: puzzle.clues.flat(),
        };
        this._updateClueColors();

        term.write('\x1B[2J\x1B[1;1H');
        this._render();

        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerInterval = setInterval(() => {
            if (this._completed || this._generating) return;
            this._timer++;
            this._drawHeader();
        }, 1000);
    }

    async _generateAsync(size, epoch) {
        const maxAttempts = size <= 7 ? 300 : size <= 12 ? 600 : 1200;
        const seed = Date.now() & 0x7fffffff;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (epoch !== this.abortEpoch) return null;
            const puzzle = generatePuzzle(size, size, {
                seed: seed + attempt,
                maxAttempts: 1,
            });
            if (puzzle) return puzzle;
            // Yield to the UI thread every attempt so the browser never freezes.
            // For large boards each attempt can take 10-100ms; batching would cause jank.
            await new Promise((r) => setTimeout(r, 0));
        }
        return null;
    }

    _renderGenerating() {
        const cfg = DIFFICULTY[this._difficulty];
        term.write('\x1B[1;1H' + bold(cyan('  Nurikabe [' + cfg.label + ']')) +
            '\n\n' + yellow('  Generating puzzle...'));
    }

    _drawHeader() {
        const cfg = DIFFICULTY[this._difficulty];
        const t = _formatTime(this._timer);
        const pad = Math.max(0, 48 - cfg.label.length);
        term.write('\x1B[1;1H' + bold(cyan('  Nurikabe [' + cfg.label + ']')) +
            ' '.repeat(Math.max(0, pad)) +
            yellow(t));
    }

    _footerRow() {
        return 6 + this._size;
    }

    _drawFooter() {
        term.write('\x1B[2;1H\x1B[2K' +
            gray('  ←↑↓→ Move   Space Toggle   [n]ew [q]uit'));
    }

    _drawBoard() {
        const size = this._size;
        const boardY = 3;
        const lineW = 1 + size * 2 + 1;
        let s = '\x1B[' + boardY + ';1H';
        s += '╔' + '═'.repeat(lineW - 2) + '╗';
        for (let r = 0; r < size; r++) {
            s += '\x1B[' + (boardY + 1 + r) + ';1H';
            s += '║';
            for (let c = 0; c < size; c++)
                s += this._cellStr(r, c);
            s += '║';
        }
        s += '\x1B[' + (boardY + 1 + size) + ';1H';
        s += '╚' + '═'.repeat(lineW - 2) + '╝';
        term.write(s);
    }

    _drawRow(r) {
        const boardY = 3;
        const size = this._size;
        let s = '\x1B[' + (boardY + 1 + r) + ';1H║';
        for (let c = 0; c < size; c++)
            s += this._cellStr(r, c);
        s += '║';
        term.write(s);
    }

    _cellStr(r, c) {
        const isCur = r === this._cursorRow && c === this._cursorCol && !this._completed;
        const clue = this._clues[r][c];

        if (clue > 0) {
            const ch = formatClue(clue);
            const st = this._clueStatus[r][c];
            const cell = bold(_styleClue(st, ch) + '\x1B[0m');
            return isCur ? '\x1B[7m' + cell + '\x1B[0m' : cell;
        }

        const isSea = this._player[r][c] === BLACK;
        if (isSea) {
            const inPool = this._poolMask[r][c];
            if (isCur) {
                return inPool
                    ? '\x1B[41;97m' + CELL_SEA + '\x1B[0m'
                    : '\x1B[107;30m' + CELL_SEA + '\x1B[0m';
            }
            return inPool
                ? '\x1B[41m' + CELL_SEA + '\x1B[0m'
                : '\x1B[100m' + CELL_SEA + '\x1B[0m';
        }
        return isCur ? '\x1B[7m' + CELL_ISLAND + '\x1B[0m' : CELL_ISLAND;
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
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        this._updateClueColors();
        this._drawHeader();
        this._drawBoard();
        const timeStr = _formatTime(this._timer);
        const fRow = this._footerRow();
        const msg = won
            ? bold(green('  Congratulations!')) + '  ' + yellow('Time: ' + timeStr)
            : bold(red('  Game Over')) + '  ' + yellow('Time: ' + timeStr);
        term.write('\x1B[' + (fRow - 1) + ';1H' + msg);
        term.write('\x1B[' + fRow + ';1H' + gray('  Press [n]ew game or [q]uit'));
    }

    _move(dr, dc) {
        const nr = this._cursorRow + dr;
        const nc = this._cursorCol + dc;
        if (nr < 0 || nr >= this._size || nc < 0 || nc >= this._size) return;
        const oldR = this._cursorRow;
        const oldC = this._cursorCol;
        this._cursorRow = nr;
        this._cursorCol = nc;
        this._drawRow(oldR);
        this._drawRow(nr);
    }

    _onKey(data) {
        if (this._difficultyDialog) {
            this._difficultyDialog.handleKey(data);
            return;
        }

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
            this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (code === 0x20) {
            this._toggleCell();
            return;
        }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'n') { this._pickDifficulty(); return; }
        }
    }

    _render() {
        this._drawHeader();
        this._drawBoard();
        this._drawFooter();
        term.write('\x1B[' + (this._cursorRow + 4) + ';' + (this._cursorCol * 2 + 3) + 'H');
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        if (this._size) {
            term.write('\x1B[' + (this._footerRow() + 1) + ';1H');
        }
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'nurikabe'; }
    static get help() { return 'Play Nurikabe'; }
    static get menu() { return 'Nurikabe'; }
    static get usage() { return 'nurikabe [--easy|--medium|--hard]'; }
}
