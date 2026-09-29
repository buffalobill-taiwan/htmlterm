import { SIZE, SEED_MAX, DIFFICULTY } from './constants.js';
import { mulberry32 } from '../../util/random.js';

function parseSeed(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
    const seed = Number(value);
    return Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX ? seed : null;
}

function _createEmpty() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function _copyGrid(g) {
    return g.map(r => [...r]);
}

function _shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
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

function _solve(grid, rng) {
    const m = _buildMasks(grid);
    function solve() {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    const b = (r / 3 | 0) * 3 + (c / 3 | 0);
                    const used = m.rows[r] | m.cols[c] | m.boxes[b];
                    const nums = _shuffle([1,2,3,4,5,6,7,8,9], rng);
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

// The seed and difficulty fully determine both the clues and solution.
function _generate(difficulty, seed = Math.floor(Math.random() * (SEED_MAX + 1))) {
    if (!Object.hasOwn(DIFFICULTY, difficulty)) throw new RangeError('Invalid Sudoku difficulty');
    if (parseSeed(seed) === null) throw new RangeError('Invalid Sudoku seed');
    seed = Number(seed);
    const rng = mulberry32(seed);
    const grid = _createEmpty();
    _solve(grid, rng);
    const solution = _copyGrid(grid);
    const given = Array.from({ length: SIZE }, () => Array(SIZE).fill(true));
    const cells = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            cells.push([r, c]);
    _shuffle(cells, rng);
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
    return { board: grid, solution, given, seed };
}

export { _createEmpty, _generate, _copyGrid, parseSeed };
