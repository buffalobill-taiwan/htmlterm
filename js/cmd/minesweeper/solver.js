import { DIFFICULTY } from './constants.js';
import { mulberry32, parseSeed, SEED_MAX } from '../../util/random.js';

function parseStart(value, difficulty) {
    const cfg = DIFFICULTY[difficulty];
    if (!cfg || typeof value !== 'string' || !/^\d+,\d+$/.test(value)) return null;
    const [row, col] = value.split(',').map(Number);
    return row < cfg.rows && col < cfg.cols ? { row, col } : null;
}

// Preserve the live game's 200-attempt policy, including its last-board fallback.
function generatePuzzle(difficulty, seed = Math.floor(Math.random() * (SEED_MAX + 1)), start = null) {
    if (!Object.hasOwn(DIFFICULTY, difficulty)) throw new RangeError('Invalid Minesweeper difficulty');
    if (parseSeed(seed) === null) throw new RangeError('Invalid Minesweeper seed');
    seed = Number(seed);
    const { rows, cols, mines } = DIFFICULTY[difficulty];
    const row = start?.row ?? Math.floor(rows / 2);
    const col = start?.col ?? Math.floor(cols / 2);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rows || col < 0 || col >= cols)
        throw new RangeError('Invalid starting cell');
    const rng = mulberry32(seed);
    let board;
    for (let attempt = 1; attempt <= 200; attempt++) {
        board = _create2D(cols, rows, 0);
        let placed = 0;
        while (placed < mines) {
            const r = Math.floor(rng() * rows);
            const c = Math.floor(rng() * cols);
            if (board[r][c] === -1 || (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1)) continue;
            board[r][c] = -1;
            placed++;
        }
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                if (board[r][c] === -1) continue;
                let n = 0;
                for (let dr = -1; dr <= 1; dr++)
                    for (let dc = -1; dc <= 1; dc++)
                        if (board[r + dr]?.[c + dc] === -1) n++;
                board[r][c] = n;
            }
        const solvable = _isSolvable(board, rows, cols, row, col);
        if (solvable || attempt === 200)
            return { board, seed, start: { row, col }, attempts: attempt, solvable };
    }
}

// Reveal a safe cell and its empty region, preserving any player flags.
function revealCells(board, revealed, r, c, flags = null) {
    if (board[r][c] === -1 || revealed[r][c] || flags?.[r][c]) return;
    const rows = board.length, cols = board[0].length;
    const q = [[r, c]];
    revealed[r][c] = true;
    while (q.length) {
        const [cr, cc] = q.pop();
        if (board[cr][cc] !== 0) continue;
        for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
                const nr = cr + dr, nc = cc + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !revealed[nr][nc] && !flags?.[nr][nc]) {
                    revealed[nr][nc] = true;
                    q.push([nr, nc]);
                }
            }
    }
}

function _create2D(cols, rows, val) {
    return Array.from({ length: rows }, () => Array(cols).fill(val));
}

function _isSubset(small, large) {
    let j = 0;
    for (let i = 0; i < small.length; i++) {
        while (j < large.length && large[j] < small[i]) j++;
        if (j >= large.length || large[j] !== small[i]) return false;
        j++;
    }
    return true;
}

function _arrayDiff(base, sub) {
    const result = [];
    let j = 0;
    for (let i = 0; i < base.length; i++) {
        if (j < sub.length && sub[j] === base[i]) { j++; continue; }
        result.push(base[i]);
    }
    return result;
}

function _isSolvable(board, rows, cols, safeR, safeC) {
    const totalCells = rows * cols;
    const revealed = _create2D(cols, rows, false);
    const flagged = new Set();

    const cellId = (r, c) => r * cols + c;
    const cellRC = (id) => [Math.floor(id / cols), id % cols];

    const allNeighbors = new Array(totalCells);
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const id = cellId(r, c);
            const nb = [];
            for (let dr = -1; dr <= 1; dr++)
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
                        nb.push(cellId(nr, nc));
                }
            allNeighbors[id] = nb;
        }

    const q = [[safeR, safeC]];
    revealed[safeR][safeC] = true;
    while (q.length) {
        const [r, c] = q.pop();
        if (board[r][c] !== 0) continue;
        for (const id of allNeighbors[cellId(r, c)]) {
            const [nr, nc] = cellRC(id);
            if (!revealed[nr][nc]) {
                revealed[nr][nc] = true;
                q.push([nr, nc]);
            }
        }
    }

    let totalSafe = 0, revealedSafe = 0;
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            if (board[r][c] !== -1) {
                totalSafe++;
                if (revealed[r][c]) revealedSafe++;
            }
    if (revealedSafe === totalSafe) return true;

    function buildConstraints() {
        const constraints = [];
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                if (!revealed[r][c] || board[r][c] <= 0) continue;
                const nbs = allNeighbors[cellId(r, c)];
                const unknown = [];
                let flaggedCount = 0;
                for (const nid of nbs) {
                    if (flagged.has(nid)) flaggedCount++;
                    else if (!revealed[Math.floor(nid / cols)][nid % cols])
                        unknown.push(nid);
                }
                const remaining = board[r][c] - flaggedCount;
                if (unknown.length === 0 || remaining < 0) continue;
                constraints.push({ cells: unknown, count: remaining });
            }
        return constraints;
    }

    let changed = true;
    while (changed) {
        changed = false;
        const constraints = buildConstraints();

        for (const con of constraints) {
            if (con.count === 0) {
                for (const id of con.cells) {
                    const [r, c] = cellRC(id);
                    if (!revealed[r][c]) {
                        revealed[r][c] = true;
                        changed = true;
                    }
                }
            } else if (con.count === con.cells.length) {
                for (const id of con.cells) {
                    if (!flagged.has(id)) {
                        flagged.add(id);
                        changed = true;
                    }
                }
            }
        }

        if (changed) continue;

        const safes = new Set();
        const mines = new Set();

        for (let i = 0; i < constraints.length; i++) {
            for (let j = i + 1; j < constraints.length; j++) {
                const a = constraints[i], b = constraints[j];
                let derived = null;

                if (a.cells.length < b.cells.length && _isSubset(a.cells, b.cells)) {
                    derived = { cells: _arrayDiff(b.cells, a.cells), count: b.count - a.count };
                } else if (b.cells.length < a.cells.length && _isSubset(b.cells, a.cells)) {
                    derived = { cells: _arrayDiff(a.cells, b.cells), count: a.count - b.count };
                }

                if (derived && derived.count >= 0 && derived.count <= derived.cells.length) {
                    if (derived.count === 0) {
                        for (const id of derived.cells) safes.add(id);
                    } else if (derived.count === derived.cells.length) {
                        for (const id of derived.cells) mines.add(id);
                    }
                }
            }
        }

        if (safes.size > 0 || mines.size > 0) {
            for (const id of safes) {
                const [r, c] = cellRC(id);
                if (!revealed[r][c]) {
                    revealed[r][c] = true;
                    changed = true;
                }
            }
            for (const id of mines) {
                if (!flagged.has(id)) {
                    flagged.add(id);
                    changed = true;
                }
            }
        }
    }

    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            if (board[r][c] !== -1 && !revealed[r][c]) return false;
    return true;
}

export { _create2D, _isSolvable, generatePuzzle, parseStart, revealCells };
