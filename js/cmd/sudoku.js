import { system, term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { ConfirmDialog } from '../dialog/ConfirmDialog.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, green, cyan, yellow, gray, CURSOR_HIDE } from '../util/sgr.js';
import { isWide } from '../util/unicode-width.js';

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

function _popcount(x) {
    let c = 0;
    while (x) { c++; x &= x - 1; }
    return c;
}

function _solveBasic(grid) {
    const g = _copyGrid(grid);
    const cands = Array.from({ length: SIZE }, () => new Uint16Array(SIZE));

    for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++) {
            if (g[r][c] !== 0) continue;
            let mask = 0;
            for (let n = 1; n <= 9; n++) {
                let ok = true;
                for (let i = 0; i < 9 && ok; i++)
                    if (g[r][i] === n || g[i][c] === n) ok = false;
                if (ok) {
                    const br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
                    for (let dr = 0; dr < 3 && ok; dr++)
                        for (let dc = 0; dc < 3 && ok; dc++)
                            if (g[br + dr][bc + dc] === n) ok = false;
                }
                if (ok) mask |= (1 << n);
            }
            cands[r][c] = mask;
        }

    function place(r, c, n) {
        g[r][c] = n;
        const bit = 1 << n;
        cands[r][c] = 0;
        for (let i = 0; i < 9; i++) { cands[r][i] &= ~bit; cands[i][c] &= ~bit; }
        const br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
        for (let dr = 0; dr < 3; dr++)
            for (let dc = 0; dc < 3; dc++)
                cands[br + dr][bc + dc] &= ~bit;
    }

    let progress = true;
    while (progress) {
        progress = false;

        for (let r = 0; r < 9; r++)
            for (let c = 0; c < 9; c++) {
                if (g[r][c] !== 0 || cands[r][c] === 0) continue;
                if ((cands[r][c] & (cands[r][c] - 1)) === 0) {
                    place(r, c, Math.log2(cands[r][c]));
                    progress = true;
                }
            }
        if (progress) continue;

        for (let n = 1; n <= 9; n++) {
            const bit = 1 << n;
            for (let r = 0; r < 9; r++) {
                let cnt = 0, lc = -1;
                for (let c = 0; c < 9; c++)
                    if (g[r][c] === 0 && (cands[r][c] & bit)) { cnt++; lc = c; }
                if (cnt === 1) { place(r, lc, n); progress = true; }
            }
            if (progress) continue;
            for (let c = 0; c < 9; c++) {
                let cnt = 0, lr = -1;
                for (let r = 0; r < 9; r++)
                    if (g[r][c] === 0 && (cands[r][c] & bit)) { cnt++; lr = r; }
                if (cnt === 1) { place(lr, c, n); progress = true; }
            }
            if (progress) continue;
            for (let br = 0; br < 3; br++)
                for (let bc = 0; bc < 3; bc++) {
                    let cnt = 0, lr = -1, lc = -1;
                    for (let dr = 0; dr < 3; dr++)
                        for (let dc = 0; dc < 3; dc++) {
                            const r = br * 3 + dr, c = bc * 3 + dc;
                            if (g[r][c] === 0 && (cands[r][c] & bit)) { cnt++; lr = r; lc = c; }
                        }
                    if (cnt === 1) { place(lr, lc, n); progress = true; }
                }
            if (progress) continue;
        }
        if (progress) continue;

        for (let n = 1; n <= 9; n++) {
            const bit = 1 << n;
            for (let br = 0; br < 3; br++)
                for (let bc = 0; bc < 3; bc++) {
                    let rMask = 0, cMask = 0;
                    for (let dr = 0; dr < 3; dr++)
                        for (let dc = 0; dc < 3; dc++) {
                            const r = br * 3 + dr, c = bc * 3 + dc;
                            if (g[r][c] === 0 && (cands[r][c] & bit)) {
                                rMask |= (1 << r); cMask |= (1 << c);
                            }
                        }
                    if (_popcount(rMask) === 1) {
                        const rr = Math.log2(rMask);
                        for (let c = 0; c < 9; c++) {
                            if (c >= bc * 3 && c < bc * 3 + 3) continue;
                            if (g[rr][c] === 0 && (cands[rr][c] & bit)) {
                                cands[rr][c] &= ~bit;
                                if (cands[rr][c] === 0) return false;
                                progress = true;
                            }
                        }
                    }
                    if (_popcount(cMask) === 1) {
                        const cc = Math.log2(cMask);
                        for (let r = 0; r < 9; r++) {
                            if (r >= br * 3 && r < br * 3 + 3) continue;
                            if (g[r][cc] === 0 && (cands[r][cc] & bit)) {
                                cands[r][cc] &= ~bit;
                                if (cands[r][cc] === 0) return false;
                                progress = true;
                            }
                        }
                    }
                }
            if (progress) continue;
            for (let r = 0; r < 9; r++) {
                let bMask = 0;
                for (let c = 0; c < 9; c++)
                    if (g[r][c] === 0 && (cands[r][c] & bit))
                        bMask |= (1 << (c / 3 | 0));
                if (_popcount(bMask) === 1) {
                    const bc = Math.log2(bMask), br = (r / 3 | 0);
                    for (let dr = 0; dr < 3; dr++)
                        for (let dc = 0; dc < 3; dc++) {
                            const rr = br * 3 + dr, cc = bc * 3 + dc;
                            if (rr === r) continue;
                            if (g[rr][cc] === 0 && (cands[rr][cc] & bit)) {
                                cands[rr][cc] &= ~bit;
                                if (cands[rr][cc] === 0) return false;
                                progress = true;
                            }
                        }
                }
            }
            if (progress) continue;
            for (let c = 0; c < 9; c++) {
                let bMask = 0;
                for (let r = 0; r < 9; r++)
                    if (g[r][c] === 0 && (cands[r][c] & bit))
                        bMask |= (1 << (r / 3 | 0));
                if (_popcount(bMask) === 1) {
                    const br = Math.log2(bMask), bc = (c / 3 | 0);
                    for (let dr = 0; dr < 3; dr++)
                        for (let dc = 0; dc < 3; dc++) {
                            const rr = br * 3 + dr, cc = bc * 3 + dc;
                            if (cc === c) continue;
                            if (g[rr][cc] === 0 && (cands[rr][cc] & bit)) {
                                cands[rr][cc] &= ~bit;
                                if (cands[rr][cc] === 0) return false;
                                progress = true;
                            }
                        }
                }
            }
        }
        if (progress) continue;

        function nakedSubsets(cells) {
            const uc = cells.map(([r, c]) => cands[r][c]);
            for (let sz = 2; sz <= 4; sz++) {
                for (let mask = 1; mask < (1 << cells.length); mask++) {
                    if (_popcount(mask) !== sz) continue;
                    let union = 0;
                    for (let i = 0; i < cells.length; i++)
                        if (mask & (1 << i)) union |= uc[i];
                    if (_popcount(union) !== sz) continue;
                    for (let i = 0; i < cells.length; i++) {
                        if (mask & (1 << i)) continue;
                        const before = uc[i];
                        uc[i] &= ~union;
                        if (uc[i] !== before) {
                            const [r, c] = cells[i];
                            cands[r][c] = uc[i];
                            if (cands[r][c] === 0) return false;
                            progress = true;
                        }
                    }
                }
            }
            return true;
        }

        for (let r = 0; r < 9; r++) {
            const cells = [];
            for (let c = 0; c < 9; c++) if (g[r][c] === 0) cells.push([r, c]);
            if (cells.length > 1 && !nakedSubsets(cells)) return false;
        }
        if (progress) continue;
        for (let c = 0; c < 9; c++) {
            const cells = [];
            for (let r = 0; r < 9; r++) if (g[r][c] === 0) cells.push([r, c]);
            if (cells.length > 1 && !nakedSubsets(cells)) return false;
        }
        if (progress) continue;
        for (let br = 0; br < 3; br++)
            for (let bc = 0; bc < 3; bc++) {
                const cells = [];
                for (let dr = 0; dr < 3; dr++)
                    for (let dc = 0; dc < 3; dc++) {
                        const r = br * 3 + dr, c = bc * 3 + dc;
                        if (g[r][c] === 0) cells.push([r, c]);
                    }
                if (cells.length > 1 && !nakedSubsets(cells)) return false;
            }
    }

    for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++)
            if (g[r][c] === 0) return false;
    return true;
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
        if (_countSolutions(grid, 2) === 1 &&
            (difficulty !== 'easy' || _solveBasic(grid))) {
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
        this.open();
        term.write(CURSOR_HIDE);
        this._renderEmptyBoard();
        const opts = ['Easy', 'Medium', 'Hard'];
        const dialog = new SelectDialog(term, {
            title: 'Sudoku',
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

    _renderEmptyBoard() {
        const lines = [];
        const counts = { counts: new Array(10).fill(0), total: new Array(10).fill(0) };
        lines.push(bold(cyan('  Sudoku')) + '                           ' +
            gray('[n]ew [q]uit'));
        lines.push('  ╔═══╤═══╤═══╦═══╤═══╤═══╦═══╤═══╤═══╗  ┌─────┐');
        for (let r = 0; r < SIZE; r++) {
            let row = '  ║';
            for (let c = 0; c < SIZE; c++) {
                row += '   ';
                row += (c % BOX === BOX - 1) ? '║' : '│';
            }
            row += '  │' + this._digitPanelStr(r + 1, counts) + '│';
            lines.push(row);
            if (r % BOX === BOX - 1 && r < SIZE - 1) {
                lines.push('  ╠═══╪═══╪═══╬═══╪═══╪═══╬═══╪═══╪═══╣  │     │');
            } else if (r < SIZE - 1) {
                lines.push('  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢  │     │');
            }
        }
        lines.push('  ╚═══╧═══╧═══╩═══╧═══╧═══╩═══╧═══╧═══╝  └─────┘');
        term.write('\x1B[2J\x1B[H');
        for (const line of lines) {
            term.write(line + '\r\n');
        }
    }

    _startGame(difficulty) {
        this._difficulty = difficulty;
        this._completed = false;
        this._timer = 0;
        this._autoCheck = true;
        this._errors = new Set();
        this._difficultyDialog = null;

        const { board, solution, given } = _generate(difficulty);
        this._board = board;
        this._solution = solution;
        this._given = given;
        this._initialBoard = _copyGrid(board);
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
            '    ' + gray('[g]ive up [n]ew [r]estart [c]heck:' + (auto ? 'ON' : 'OFF') + ' [q]uit'));
        term.write('\x1B[u');
    }

    _render() {
        const lines = this._buildLines();
        this._totalLines = lines.length;
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

    _countDigits() {
        const counts = new Array(10).fill(0);
        const total = new Array(10).fill(0);
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++) {
                const v = this._board[r][c];
                if (v > 0) {
                    total[v]++;
                    if (!this._hasConflict(r, c)) counts[v]++;
                }
            }
        return { counts, total };
    }

    _digitPanelStr(n, { counts, total }) {
        const count = counts[n];
        const t = total[n];
        const numStr = String(n);
        let visible, styled;
        if (t > 0 && t > count) {
            visible = numStr + ' ?/9';
            styled = red(bold(visible));
        } else if (count === 9) {
            visible = numStr + ' ✓';
            styled = green(bold(visible));
        } else if (count === 0) {
            visible = numStr + ' ·';
            styled = gray(visible);
        } else {
            visible = numStr + ' ' + count + '/9';
            styled = gray(visible);
        }
        let w = 0;
        for (const ch of visible) w += isWide(ch) ? 2 : 1;
        return styled + ' '.repeat(Math.max(0, 5 - w));
    }

    _updateDigitRow(n) {
        const counts = this._countDigits();
        const displayRow = 3 + (n - 1) * 2;
        term.write('\x1B[' + displayRow + ';42H\x1B[K');
        term.write('│' + this._digitPanelStr(n, counts) + '│');
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
        const counts = this._countDigits();

        lines.push(bold(cyan('  Sudoku [' + DIFFICULTY[this._difficulty].label + ']')) +
            '    ' + yellow(_formatTime(this._timer)) +
            '    ' + gray('[g]ive up [n]ew [r]estart [c]heck:' + (auto ? 'ON' : 'OFF') + ' [q]uit'));

        lines.push('  ╔═══╤═══╤═══╦═══╤═══╤═══╦═══╤═══╤═══╗  ┌─────┐');

        for (let r = 0; r < SIZE; r++) {
            let row = '  ║';
            for (let c = 0; c < SIZE; c++) {
                row += this._cellStr(r, c, br, bc, auto);
                row += (c % BOX === BOX - 1) ? '║' : '│';
            }
            row += '  │' + this._digitPanelStr(r + 1, counts) + '│';
            lines.push(row);
            if (r % BOX === BOX - 1 && r < SIZE - 1) {
                lines.push('  ╠═══╪═══╪═══╬═══╪═══╪═══╬═══╪═══╪═══╣  │     │');
            } else if (r < SIZE - 1) {
                lines.push('  ╟───┼───┼───╫───┼───┼───╫───┼───┼───╢  │     │');
            }
        }

        lines.push('  ╚═══╧═══╧═══╩═══╧═══╧═══╩═══╧═══╧═══╝  └─────┘');
        return lines;
    }

    _renderRow(r) {
        const br = this._cursorRow;
        const bc = this._cursorCol;
        const auto = this._autoCheck;
        const counts = this._countDigits();

        let row = '  ║';
        for (let c = 0; c < SIZE; c++) {
            row += this._cellStr(r, c, br, bc, auto);
            row += (c % BOX === BOX - 1) ? '║' : '│';
        }

        const displayRow = 3 + r * 2;
        term.write('\x1B[' + displayRow + ';1H\x1B[K');
        term.write(row + '  │' + this._digitPanelStr(r + 1, counts) + '│');
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
        if (this._difficultyDialog) {
            this._difficultyDialog.handleKey(data);
            return;
        }

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
        term.write('\x1B[2J\x1B[H');
        this._pickDifficulty();
    }

    _restart() {
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
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
            this._timerInterval = null;
        }
        term.write('\n');
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
