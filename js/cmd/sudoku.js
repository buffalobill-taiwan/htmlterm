import { system, term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { ConfirmDialog } from '../dialog/ConfirmDialog.js';
import { bold, red, green, cyan, yellow, gray, CURSOR_HIDE } from '../util/sgr.js';

const SIZE = 9;
const BOX = 3;

const DIFFICULTY = {
    easy:   { hints: 36, label: 'Easy' },
    medium: { hints: 30, label: 'Medium' },
    hard:   { hints: 24, label: 'Hard' },
};

function _createEmpty() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function _copyGrid(g) {
    return g.map(r => [...r]);
}

function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function _buildMasks(grid) {
    const rows = new Uint16Array(9);
    const cols = new Uint16Array(9);
    const boxes = new Uint16Array(9);
    for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++) {
            const v = grid[r][c];
            if (v !== 0) {
                const bit = 1 << v;
                rows[r] |= bit;
                cols[c] |= bit;
                boxes[(r / 3 | 0) * 3 + (c / 3 | 0)] |= bit;
            }
        }
    return { rows, cols, boxes };
}

function _solve(grid) {
    const m = _buildMasks(grid);
    function solve() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    const b = (r / 3 | 0) * 3 + (c / 3 | 0);
                    const used = m.rows[r] | m.cols[c] | m.boxes[b];
                    const nums = _shuffle([1,2,3,4,5,6,7,8,9]);
                    for (const n of nums) {
                        if (!(used & (1 << n))) {
                            grid[r][c] = n;
                            const bit = 1 << n;
                            m.rows[r] |= bit;
                            m.cols[c] |= bit;
                            m.boxes[b] |= bit;
                            if (solve()) return true;
                            m.rows[r] &= ~bit;
                            m.cols[c] &= ~bit;
                            m.boxes[b] &= ~bit;
                            grid[r][c] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }
    solve();
}

function _countSolutions(grid, limit) {
    let count = 0;
    const g = _copyGrid(grid);
    const m = _buildMasks(grid);

    function undoTrail(trail) {
        for (let i = trail.length - 1; i >= 0; i--) {
            const [r, c, n, b] = trail[i];
            const bit = 1 << n;
            g[r][c] = 0;
            m.rows[r] &= ~bit;
            m.cols[c] &= ~bit;
            m.boxes[b] &= ~bit;
        }
    }

    function propagate() {
        const trail = [];
        let changed = true;
        while (changed) {
            changed = false;
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    if (g[r][c] !== 0) continue;
                    const b = (r / 3 | 0) * 3 + (c / 3 | 0);
                    const used = m.rows[r] | m.cols[c] | m.boxes[b];
                    let cnt = 0, lastN = 0;
                    for (let n = 1; n <= 9; n++) {
                        if (!(used & (1 << n))) { cnt++; lastN = n; }
                    }
                    if (cnt === 0) { undoTrail(trail); return null; }
                    if (cnt === 1) {
                        g[r][c] = lastN;
                        const bit = 1 << lastN;
                        m.rows[r] |= bit;
                        m.cols[c] |= bit;
                        m.boxes[b] |= bit;
                        trail.push([r, c, lastN, b]);
                        changed = true;
                    }
                }
            }
        }
        return trail;
    }

    function solve() {
        if (count >= limit) return;

        const trail = propagate();
        if (!trail) return;

        let bestR = -1, bestC = -1, bestB = -1, bestMask = 0, bestCount = 10;
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (g[r][c] !== 0) continue;
                const b = (r / 3 | 0) * 3 + (c / 3 | 0);
                const used = m.rows[r] | m.cols[c] | m.boxes[b];
                let cnt = 0;
                for (let n = 1; n <= 9; n++) if (!(used & (1 << n))) cnt++;
                if (cnt < bestCount) {
                    bestCount = cnt;
                    bestR = r; bestC = c; bestB = b; bestMask = used;
                    if (cnt <= 1) break;
                }
            }
            if (bestCount <= 1) break;
        }

        if (bestR < 0) {
            count++;
            undoTrail(trail);
            return;
        }

        for (let n = 1; n <= 9; n++) {
            if (!(bestMask & (1 << n))) {
                undoTrail(trail);
                g[bestR][bestC] = n;
                const bit = 1 << n;
                m.rows[bestR] |= bit;
                m.cols[bestC] |= bit;
                m.boxes[bestB] |= bit;
                solve();
                m.rows[bestR] &= ~bit;
                m.cols[bestC] &= ~bit;
                m.boxes[bestB] &= ~bit;
                g[bestR][bestC] = 0;
                if (count >= limit) return;
            }
        }
    }

    solve();
    return count;
}

function _generate(difficulty) {
    const grid = _createEmpty();
    _solve(grid);
    const solution = _copyGrid(grid);
    const given = Array.from({ length: SIZE }, () => Array(SIZE).fill(true));
    const cells = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            cells.push([r, c]);
    _shuffle(cells);
    const toRemove = SIZE * SIZE - DIFFICULTY[difficulty].hints;
    let removed = 0;
    for (const [r, c] of cells) {
        if (removed >= toRemove) break;
        const val = grid[r][c];
        grid[r][c] = 0;
        if (_countSolutions(grid, 2) === 1) {
            given[r][c] = false;
            removed++;
        } else {
            grid[r][c] = val;
        }
    }
    return { board: grid, solution, given };
}

function _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export class SudokuCmd extends CmdBase {
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
        this.print(bold(cyan('=== Sudoku ===')) + '\r\n');
        this.select({
            text: yellow('Select difficulty (↑↓←→ move, Enter confirm, Esc cancel)') + '\r\n',
            options: [['Easy', 'Medium', 'Hard']],
            onPick: (row, col, value) => {
                term.write('\r\n\r\n');
                this._startGame(value.toLowerCase());
            },
        });
    }

    _startGame(difficulty) {
        this._difficulty = difficulty;
        this._completed = false;
        this._timer = 0;
        this._autoCheck = true;
        this._errors = new Set();

        const { board, solution, given } = _generate(difficulty);
        this._board = board;
        this._solution = solution;
        this._given = given;
        this._cursorRow = 4;
        this._cursorCol = 4;

        this.open();
        term.write(CURSOR_HIDE);
        this._render();
        this._timerInterval = setInterval(() => {
            if (this._completed) return;
            this._timer++;
            this._updateHeader();
        }, 1000);
    }

    _updateHeader() {
        const auto = this._autoCheck;
        term.write('\x1B[s');
        term.write('\x1B[1;1H\x1B[K');
        term.write(bold(cyan('  Sudoku [' + DIFFICULTY[this._difficulty].label + ']')) +
            '    ' + yellow(_formatTime(this._timer)) +
            '    ' + gray('[g]ive up [n]ew [c]heck:' + (auto ? 'ON' : 'OFF') + ' [q]uit'));
        term.write('\x1B[u');
    }

    _render() {
        const lines = this._buildLines();
        term.write('\x1B[2J\x1B[H');
        for (const line of lines) {
            term.write(line + '\r\n');
        }
    }

    _hasConflict(r, c) {
        const v = this._board[r][c];
        if (v === 0) return false;
        for (let i = 0; i < SIZE; i++) {
            if (i !== c && this._board[r][i] === v) return true;
            if (i !== r && this._board[i][c] === v) return true;
        }
        const br = Math.floor(r / BOX) * BOX;
        const bc = Math.floor(c / BOX) * BOX;
        for (let dr = 0; dr < BOX; dr++)
            for (let dc = 0; dc < BOX; dc++)
                if ((br + dr !== r || bc + dc !== c) && this._board[br + dr][bc + dc] === v) return true;
        return false;
    }

    _cellStr(r, c, br, bc, auto) {
        const val = this._board[r][c];
        const isGiven = this._given[r][c];
        const isCur = r === br && c === bc;
        const isError = auto && !isGiven && val !== 0 && this._hasConflict(r, c);
        const digit = val !== 0 ? String(val) : ' ';

        if (isCur) {
            if (isError)   return ' \x1B[7m' + red(bold(digit)) + '\x1B[0m ';
            if (isGiven)   return ' \x1B[7m' + cyan(bold(digit)) + '\x1B[0m ';
            if (val !== 0) return ' \x1B[7m' + green(digit) + '\x1B[0m ';
            return ' \x1B[7m \x1B[0m ';
        }
        if (isError)   return ' ' + red(bold(digit)) + ' ';
        if (isGiven)   return ' ' + cyan(bold(digit)) + ' ';
        if (val !== 0) return ' ' + green(digit) + ' ';
        return '   ';
    }

    _buildLines() {
        const lines = [];
        const br = this._cursorRow;
        const bc = this._cursorCol;
        const auto = this._autoCheck;

        lines.push(bold(cyan('  Sudoku [' + DIFFICULTY[this._difficulty].label + ']')) +
            '    ' + yellow(_formatTime(this._timer)) +
            '    ' + gray('[g]ive up [n]ew [c]heck:' + (auto ? 'ON' : 'OFF') + ' [q]uit'));

        lines.push('  ╔═══╤═══╤═══╦═══╤═══╤═══╦═══╤═══╤═══╗');

        for (let r = 0; r < SIZE; r++) {
            let row = '  ║';
            for (let c = 0; c < SIZE; c++) {
                row += this._cellStr(r, c, br, bc, auto);
                row += (c % BOX === BOX - 1) ? '║' : '│';
            }
            lines.push(row);
            if (r % BOX === BOX - 1 && r < SIZE - 1) {
                lines.push('  ╠═══╪═══╪═══╬═══╪═══╪═══╬═══╪═══╪═══╣');
            } else if (r < SIZE - 1) {
                lines.push('  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢');
            }
        }

        lines.push('  ╚═══╧═══╧═══╩═══╧═══╧═══╩═══╧═══╧═══╝');
        return lines;
    }

    _renderRow(r) {
        const br = this._cursorRow;
        const bc = this._cursorCol;
        const auto = this._autoCheck;

        let row = '  ║';
        for (let c = 0; c < SIZE; c++) {
            row += this._cellStr(r, c, br, bc, auto);
            row += (c % BOX === BOX - 1) ? '║' : '│';
        }

        const displayRow = 3 + r * 2;
        term.write('\x1B[' + displayRow + ';1H\x1B[K');
        term.write(row);
    }

    _checkWin() {
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (this._board[r][c] !== this._solution[r][c]) return false;
        return true;
    }

    _giveUpConfirm() {
        if (this._completed) return;
        system.createDialog(ConfirmDialog, 'sudoku-confirm', {
            title: 'Confirm',
            message: 'Give up and reveal\nthe answer?',
            onConfirm: () => this._giveUp(),
        });
    }

    _giveUp() {
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
        const timeStr = _formatTime(this._timer);
        term.write('\x1B[21;1H\x1B[K');
        term.write(bold(red('  Game Over')) + '  ' +
            yellow('Time: ' + timeStr) + '\r\n' +
            gray('  Press [n]ew game or [q]uit'));
    }

    _win() {
        this._completed = true;
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        const timeStr = _formatTime(this._timer);
        term.write('\x1B[21;1H\x1B[K');
        term.write(bold(green('  Congratulations!')) + '  ' +
            yellow('Time: ' + timeStr) + '\r\n' +
            gray('  Press [n]ew game or [q]uit'));
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
            if (s === '\x1B[A') { this._move(0, -1); return; }
            if (s === '\x1B[B') { this._move(0, 1); return; }
            if (s === '\x1B[D') { this._move(-1, 0); return; }
            if (s === '\x1B[C') { this._move(1, 0); return; }
            if (s === '\x1B[3~') { this._clearCell(); return; }
            this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'g') { this._giveUpConfirm(); return; }
            if (ch === 'n') { this._newGame(); return; }
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
        this._board[r][c] = num;

        if (this._autoCheck && this._hasConflict(r, c)) {
            this._errors.add(r + ',' + c);
        } else {
            this._errors.delete(r + ',' + c);
        }

        this._renderRow(r);
        if (this._checkWin()) this._win();
    }

    _clearCell() {
        const r = this._cursorRow;
        const c = this._cursorCol;
        if (this._given[r][c]) return;
        if (this._board[r][c] === 0) return;
        this._board[r][c] = 0;
        this._errors.delete(r + ',' + c);
        this._renderRow(r);
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
        term.write('\x1B[2J\x1B[H');
        this._pickDifficulty();
    }

    _quit() {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        term.write('\r\n');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'sudoku'; }
    static get help() { return 'Play Sudoku puzzle'; }
    static get menu() { return 'Sudoku Puzzle'; }
    static get usage() { return 'sudoku [--easy|--medium|--hard]'; }
}
