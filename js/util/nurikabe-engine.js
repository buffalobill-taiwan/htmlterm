// Nurikabe engine — solver + generator.
// Ported from https://github.com/sen-ltd/nurikabe (MIT-style reference impl).

export const UNKNOWN = 0;
export const WHITE = 1;
export const BLACK = 2;

/** @typedef {{ R: number, C: number, clues: number[] }} Puzzle */

/** @typedef {{ R: number, C: number, N: number, nbrs: number[][], squares: [number,number,number,number][] }} Geom */

export function geom(R, C) {
    const N = R * C;
    const nbrs = [];
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            const ns = [];
            if (r > 0) ns.push((r - 1) * C + c);
            if (r < R - 1) ns.push((r + 1) * C + c);
            if (c > 0) ns.push(r * C + (c - 1));
            if (c < C - 1) ns.push(r * C + (c + 1));
            nbrs.push(ns);
        }
    }
    const squares = [];
    for (let r = 0; r < R - 1; r++) {
        for (let c = 0; c < C - 1; c++) {
            const a = r * C + c;
            squares.push([a, a + 1, a + C, a + C + 1]);
        }
    }
    return { R, C, N, nbrs, squares };
}

export function initialState(p) {
    const s = new Int8Array(p.R * p.C);
    for (let i = 0; i < s.length; i++) if (p.clues[i] > 0) s[i] = WHITE;
    return s;
}

function whiteRegion(state, g, p, start, seen) {
    const cells = [];
    const stack = [start];
    seen[start] = 1;
    let clue = 0;
    while (stack.length) {
        const cur = stack.pop();
        cells.push(cur);
        if (p.clues[cur] > 0) clue = clue === 0 ? p.clues[cur] : -1;
        for (const nb of g.nbrs[cur]) {
            if (!seen[nb] && state[nb] === WHITE) {
                seen[nb] = 1;
                stack.push(nb);
            }
        }
    }
    return { cells, clue };
}

export function propagate(state, g, p) {
    let changed = true;
    while (changed) {
        changed = false;

        for (const [a, b, c, d] of g.squares) {
            let black = 0;
            let unknown = -1;
            let unknownCount = 0;
            for (const cell of [a, b, c, d]) {
                if (state[cell] === BLACK) black++;
                else if (state[cell] === UNKNOWN) {
                    unknown = cell;
                    unknownCount++;
                }
            }
            if (black === 4) return false;
            if (black === 3 && unknownCount === 1) {
                state[unknown] = WHITE;
                changed = true;
            }
        }

        const seen = new Uint8Array(g.N);
        for (let i = 0; i < g.N; i++) {
            if (state[i] !== WHITE || seen[i]) continue;
            const { cells, clue } = whiteRegion(state, g, p, i, seen);
            if (clue === -1) return false;
            if (clue > 0) {
                if (cells.length > clue) return false;
                if (cells.length === clue) {
                    for (const cell of cells) {
                        for (const nb of g.nbrs[cell]) {
                            if (state[nb] === UNKNOWN) {
                                state[nb] = BLACK;
                                changed = true;
                            }
                        }
                    }
                }
            }
        }

        const reach = new Uint8Array(g.N);
        const region = new Int32Array(g.N).fill(-1);
        const seen2 = new Uint8Array(g.N);
        const clued = [];
        for (let i = 0; i < g.N; i++) {
            if (state[i] !== WHITE || seen2[i]) continue;
            const { cells, clue } = whiteRegion(state, g, p, i, seen2);
            if (clue > 0) {
                const id = clued.length;
                for (const cell of cells) region[cell] = id;
                clued.push({ id, cells, clue });
            }
        }

        for (const { id, cells, clue } of clued) {
            const budget = clue - cells.length;
            if (budget < 0) return false;
            for (const cell of cells) reach[cell] = 1;
            if (budget === 0) continue;
            const spent = new Float64Array(g.N).fill(Infinity);
            const queue = [];
            for (const cell of cells) {
                spent[cell] = 0;
                queue.push(cell);
            }
            for (let h = 0; h < queue.length; h++) {
                const cur = queue[h];
                const base = spent[cur];
                for (const nb of g.nbrs[cur]) {
                    if (state[nb] === BLACK) continue;
                    if (state[nb] === WHITE && region[nb] !== -1 && region[nb] !== id) continue;
                    const cost = state[nb] === UNKNOWN ? 1 : 0;
                    const nd = base + cost;
                    if (nd <= budget && nd < spent[nb]) {
                        spent[nb] = nd;
                        reach[nb] = 1;
                        queue.push(nb);
                    }
                }
            }
        }

        for (let i = 0; i < g.N; i++) {
            if (reach[i]) continue;
            if (state[i] === UNKNOWN) {
                state[i] = BLACK;
                changed = true;
            } else if (state[i] === WHITE && region[i] === -1) {
                return false;
            }
        }
    }
    return true;
}

export function isSolved(state, g, p) {
    for (let i = 0; i < g.N; i++) if (state[i] === UNKNOWN) return false;

    const seen = new Uint8Array(g.N);
    for (let i = 0; i < g.N; i++) {
        if (state[i] !== WHITE || seen[i]) continue;
        const { cells, clue } = whiteRegion(state, g, p, i, seen);
        if (clue <= 0) return false;
        if (cells.length !== clue) return false;
    }

    for (const [a, b, c, d] of g.squares) {
        if (state[a] === BLACK && state[b] === BLACK &&
            state[c] === BLACK && state[d] === BLACK) return false;
    }

    let firstBlack = -1;
    let blackCount = 0;
    for (let i = 0; i < g.N; i++) {
        if (state[i] === BLACK) {
            blackCount++;
            if (firstBlack === -1) firstBlack = i;
        }
    }
    if (blackCount > 0) {
        const seenB = new Uint8Array(g.N);
        const stack = [firstBlack];
        seenB[firstBlack] = 1;
        let reached = 0;
        while (stack.length) {
            const cur = stack.pop();
            reached++;
            for (const nb of g.nbrs[cur]) {
                if (!seenB[nb] && state[nb] === BLACK) {
                    seenB[nb] = 1;
                    stack.push(nb);
                }
            }
        }
        if (reached !== blackCount) return false;
    }
    return true;
}

function pickBranch(state, g) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < g.N; i++) {
        if (state[i] !== UNKNOWN) continue;
        let score = 0;
        for (const nb of g.nbrs[i]) if (state[nb] !== UNKNOWN) score++;
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return best;
}

export function solveAll(p, limit = 2) {
    const g = geom(p.R, p.C);
    const out = [];

    const recurse = (state) => {
        if (out.length >= limit) return;
        if (!propagate(state, g, p)) return;
        const cell = pickBranch(state, g);
        if (cell === -1) {
            if (isSolved(state, g, p)) out.push(state);
            return;
        }
        for (const guess of [BLACK, WHITE]) {
            if (out.length >= limit) return;
            const next = state.slice();
            next[cell] = guess;
            recurse(next);
        }
    };

    recurse(initialState(p));
    return out;
}

export function solve(p) {
    const all = solveAll(p, 2);
    return all.length === 1 ? all[0] : null;
}

export function hasUniqueSolution(p) {
    return solveAll(p, 2).length === 1;
}

// --- Generator ---

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function buildSolved(R, C, maxIsland, rng) {
    const g = geom(R, C);
    const state = new Int8Array(g.N).fill(WHITE);

    const wouldPool = (cell) => {
        const r = Math.floor(cell / C);
        const c = cell % C;
        for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
            const r0 = r + dr;
            const c0 = c + dc;
            if (r0 < 0 || c0 < 0 || r0 + 1 >= R || c0 + 1 >= C) continue;
            let black = 0;
            for (const cc of [r0 * C + c0, r0 * C + c0 + 1, (r0 + 1) * C + c0, (r0 + 1) * C + c0 + 1]) {
                if (cc === cell || state[cc] === BLACK) black++;
            }
            if (black === 4) return true;
        }
        return false;
    };

    const start = Math.floor(rng() * g.N);
    state[start] = BLACK;
    const black = [start];
    const targetBlack = Math.round(g.N * (0.6 + rng() * 0.1));
    let guard = g.N * 20;

    while (black.length < targetBlack && guard-- > 0) {
        const b = black[Math.floor(rng() * black.length)];
        const cand = shuffle([...g.nbrs[b]], rng);
        for (const w of cand) {
            if (state[w] !== WHITE) continue;
            if (wouldPool(w)) continue;
            state[w] = BLACK;
            black.push(w);
            break;
        }
    }

    const componentOf = (cell, seen) => {
        const cells = [];
        const stack = [cell];
        seen[cell] = 1;
        while (stack.length) {
            const cur = stack.pop();
            cells.push(cur);
            for (const nb of g.nbrs[cur]) {
                if (!seen[nb] && state[nb] === WHITE) {
                    seen[nb] = 1;
                    stack.push(nb);
                }
            }
        }
        return cells;
    };

    let trimGuard = g.N * 4;
    for (;;) {
        const seen = new Uint8Array(g.N);
        let big = null;
        for (let i = 0; i < g.N; i++) {
            if (state[i] === WHITE && !seen[i]) {
                const comp = componentOf(i, seen);
                if (comp.length > maxIsland) {
                    big = comp;
                    break;
                }
            }
        }
        if (!big) break;
        if (trimGuard-- <= 0) return null;
        const border = shuffle(
            big.filter((cell) => g.nbrs[cell].some((nb) => state[nb] === BLACK) && !wouldPool(cell)),
            rng,
        );
        if (!border.length) return null;
        state[border[0]] = BLACK;
        black.push(border[0]);
    }

    const islands = [];
    const seen = new Uint8Array(g.N);
    for (let i = 0; i < g.N; i++) {
        if (state[i] === WHITE && !seen[i]) islands.push(componentOf(i, seen));
    }
    if (islands.length < 2) return null;
    return { state, islands };
}

function eqState(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function deriveUnique(R, C, solved, rng) {
    const g = geom(R, C);
    for (let tries = 0; tries < 24; tries++) {
        const clues = new Array(g.N).fill(0);
        for (const cells of solved.islands) {
            const at = cells[Math.floor(rng() * cells.length)];
            clues[at] = cells.length;
        }
        const p = { R, C, clues };
        const sols = solveAll(p, 2);
        if (sols.length === 1 && eqState(sols[0], solved.state)) {
            if (isSolved(solved.state, g, p)) return { clues, solution: solved.state };
        }
    }
    return null;
}

/**
 * Generate a uniquely-solvable Nurikabe puzzle.
 * @param {number} R
 * @param {number} C
 * @param {{ maxIsland?: number, seed?: number, maxAttempts?: number }} opts
 * @returns {{ R: number, C: number, clues: number[][], solution: number[][] } | null}
 */
export function generatePuzzle(R, C, opts = {}) {
    const maxIsland = opts.maxIsland ?? 9;
    const seed = opts.seed ?? (Date.now() & 0x7fffffff);
    const maxAttempts = opts.maxAttempts ?? 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const rng = mulberry32(seed + attempt * 2654435761);
        const solved = buildSolved(R, C, maxIsland, rng);
        if (!solved) continue;
        const derived = deriveUnique(R, C, solved, rng);
        if (!derived) continue;

        const clues2d = Array.from({ length: R }, () => Array(C).fill(0));
        const solution2d = Array.from({ length: R }, () => Array(C).fill(WHITE));
        for (let r = 0; r < R; r++) {
            for (let c = 0; c < C; c++) {
                const i = r * C + c;
                clues2d[r][c] = derived.clues[i];
                solution2d[r][c] = derived.solution[i];
            }
        }
        return { R, C, clues: clues2d, solution: solution2d };
    }
    return null;
}

/** Format a clue number for display (fullwidth ≤9, halfwidth ≥10). */
export function formatClue(n) {
    if (n <= 9) return String.fromCharCode(0xFF10 + n);
    return String(n);
}

/** Format puzzle for console display. */
export function formatPuzzle(puzzle, { showSolution = false } = {}) {
    const { R, C, clues, solution } = puzzle;
    const lines = [];
    lines.push('┌' + '───'.repeat(C) + '┐');
    for (let r = 0; r < R; r++) {
        let row = '│';
        for (let c = 0; c < C; c++) {
            if (showSolution) {
                row += solution[r][c] === BLACK ? ' # ' : ' . ';
            } else if (clues[r][c] > 0) {
                const ch = formatClue(clues[r][c]);
                row += ch.length === 1 ? ' ' + ch + ' ' : ch + ' ';
            } else {
                row += ' . ';
            }
        }
        lines.push(row + '│');
    }
    lines.push('└' + '───'.repeat(C) + '┘');
    return lines.join('\n');
}
