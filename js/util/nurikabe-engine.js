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

        // 1. Check 2x2 pools (3 black + 1 unknown => 4th is white)
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

        // 2. White regions analysis & Island Merger Prevention
        const seen = new Uint8Array(g.N);
        const regionId = new Int32Array(g.N).fill(-1);
        const cluedRegions = [];

        for (let i = 0; i < g.N; i++) {
            if (state[i] !== WHITE || seen[i]) continue;

            const cells = [];
            const stack = [i];
            seen[i] = 1;
            let clue = 0;
            while (stack.length) {
                const cur = stack.pop();
                cells.push(cur);
                if (p.clues[cur] > 0) {
                    clue = clue === 0 ? p.clues[cur] : -1;
                }
                for (const nb of g.nbrs[cur]) {
                    if (!seen[nb] && state[nb] === WHITE) {
                        seen[nb] = 1;
                        stack.push(nb);
                    }
                }
            }

            if (clue === -1) return false; // Two clues merged -> contradiction!
            if (clue > 0) {
                if (cells.length > clue) return false;
                const id = cluedRegions.length;
                for (const cell of cells) regionId[cell] = id;
                cluedRegions.push({ id, cells, clue });

                // If island is complete -> surround all border unknown cells with black
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

        // 3. Unknown cell bridging 2 different clued regions -> MUST BE BLACK!
        for (let i = 0; i < g.N; i++) {
            if (state[i] !== UNKNOWN) continue;
            let touchId = -1;
            let multiTouch = false;
            for (const nb of g.nbrs[i]) {
                const rId = regionId[nb];
                if (rId !== -1) {
                    if (touchId === -1) {
                        touchId = rId;
                    } else if (touchId !== rId) {
                        multiTouch = true;
                        break;
                    }
                }
            }
            if (multiTouch) {
                state[i] = BLACK;
                changed = true;
            }
        }

        // 4. Single-option expansion for incomplete white island
        for (const { id, cells, clue } of cluedRegions) {
            if (cells.length < clue) {
                const candSet = new Set();
                for (const cell of cells) {
                    for (const nb of g.nbrs[cell]) {
                        if (state[nb] === UNKNOWN) {
                            let canTouchOther = false;
                            for (const nbnb of g.nbrs[nb]) {
                                const rId = regionId[nbnb];
                                if (rId !== -1 && rId !== id) {
                                    canTouchOther = true;
                                    break;
                                }
                            }
                            if (!canTouchOther) candSet.add(nb);
                        }
                    }
                }
                if (candSet.size === 0) return false; // Impossible to complete island!
                if (candSet.size === 1) {
                    const forcedCell = Array.from(candSet)[0];
                    state[forcedCell] = WHITE;
                    changed = true;
                }
            }
        }

        // 5. Reachability from clues
        const reach = new Uint8Array(g.N);
        for (const { id, cells, clue } of cluedRegions) {
            const budget = clue - cells.length;
            for (const cell of cells) reach[cell] = 1;
            if (budget <= 0) continue;
            const spent = new Int32Array(g.N).fill(999);
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
                    if (state[nb] === WHITE && regionId[nb] !== -1 && regionId[nb] !== id) continue;
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
            if (!reach[i]) {
                if (state[i] === UNKNOWN) {
                    state[i] = BLACK;
                    changed = true;
                } else if (state[i] === WHITE && regionId[i] === -1) {
                    return false;
                }
            }
        }

        // 6. Black Sea Connectivity Check (Bottleneck & Disconnection check)
        let firstBlack = -1;
        let blackCount = 0;
        for (let i = 0; i < g.N; i++) {
            if (state[i] === BLACK) {
                blackCount++;
                if (firstBlack === -1) firstBlack = i;
            }
        }

        if (blackCount > 0) {
            const reachedNonWhite = new Uint8Array(g.N);
            const stack = [firstBlack];
            reachedNonWhite[firstBlack] = 1;
            let reachedBlackCount = 0;

            while (stack.length) {
                const cur = stack.pop();
                if (state[cur] === BLACK) reachedBlackCount++;
                for (const nb of g.nbrs[cur]) {
                    if (!reachedNonWhite[nb] && state[nb] !== WHITE) {
                        reachedNonWhite[nb] = 1;
                        stack.push(nb);
                    }
                }
            }

            if (reachedBlackCount < blackCount) return false;

            const blackSeen = new Uint8Array(g.N);
            for (let i = 0; i < g.N; i++) {
                if (state[i] === BLACK && !blackSeen[i]) {
                    const comp = [];
                    const bStack = [i];
                    blackSeen[i] = 1;
                    const unkExitSet = new Set();
                    while (bStack.length) {
                        const cur = bStack.pop();
                        comp.push(cur);
                        for (const nb of g.nbrs[cur]) {
                            if (state[nb] === BLACK && !blackSeen[nb]) {
                                blackSeen[nb] = 1;
                                bStack.push(nb);
                            } else if (state[nb] === UNKNOWN) {
                                unkExitSet.add(nb);
                            }
                        }
                    }
                    if (blackCount > comp.length && unkExitSet.size === 0) return false;
                    if (blackCount > comp.length && unkExitSet.size === 1) {
                        const exitCell = Array.from(unkExitSet)[0];
                        state[exitCell] = BLACK;
                        changed = true;
                    }
                }
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

function isBlackSafeToRemove(cell, state, g) {
    state[cell] = WHITE;
    let firstB = -1;
    let bCount = 0;
    for (let i = 0; i < g.N; i++) {
        if (state[i] === BLACK) {
            bCount++;
            if (firstB === -1) firstB = i;
        }
    }
    if (bCount === 0) {
        state[cell] = BLACK;
        return false;
    }

    const seen = new Uint8Array(g.N);
    const stack = [firstB];
    seen[firstB] = 1;
    let reached = 0;
    while (stack.length) {
        const cur = stack.pop();
        reached++;
        for (const nb of g.nbrs[cur]) {
            if (!seen[nb] && state[nb] === BLACK) {
                seen[nb] = 1;
                stack.push(nb);
            }
        }
    }
    state[cell] = BLACK;
    return reached === bCount;
}

function buildConnectedCarvedBoard(R, C, rng) {
    const g = geom(R, C);
    const state = new Int8Array(g.N).fill(BLACK);

    // Control island count directly: an N×N board targets N-1..1.25N islands.
    // No per-island max area — islands grow freely within the white budget.
    const N = Math.min(R, C);
    const minIslands = N - 1;
    const maxIslands = Math.floor(N * 1.25);
    const targetIslandCount = minIslands + Math.floor(rng() * (maxIslands - minIslands + 1));
    const minDist = N <= 8 ? 1 : 2;
    const cand = shuffle(Array.from({ length: g.N }, (_, i) => i), rng);
    const seeds = [];

    for (const cell of cand) {
        if (seeds.length >= targetIslandCount) break;
        let ok = true;
        const cr = Math.floor(cell / C), cc = cell % C;
        for (const s of seeds) {
            const sr = Math.floor(s / C), sc = s % C;
            if (Math.abs(sr - cr) <= minDist && Math.abs(sc - cc) <= minDist) {
                ok = false;
                break;
            }
        }
        if (ok && isBlackSafeToRemove(cell, state, g)) {
            seeds.push(cell);
            state[cell] = WHITE;
        }
    }

    if (seeds.length < minIslands) return null;

    const islands = seeds.map(s => [s]);

    // Budget-based island size allocation: distribute ~35-45% of board cells
    // evenly among islands so each island gets a fair share (→ bigger islands)
    const targetTotalWhite = Math.round(g.N * (0.35 + rng() * 0.1));
    const targetSizes = seeds.map(() => 1);
    let remainingBudget = targetTotalWhite - seeds.length;
    while (remainingBudget > 0) {
        const idx = Math.floor(rng() * seeds.length);
        targetSizes[idx]++;
        remainingBudget--;
    }

    let growing = true;
    while (growing) {
        growing = false;
        for (let idx = 0; idx < seeds.length; idx++) {
            const isl = islands[idx];
            if (isl.length >= targetSizes[idx]) continue;

            const nbrs = [];
            for (const cell of isl) {
                for (const nb of g.nbrs[cell]) {
                    if (state[nb] === BLACK) {
                        let touchesOther = false;
                        for (const nbnb of g.nbrs[nb]) {
                            if (state[nbnb] === WHITE && !isl.includes(nbnb)) {
                                touchesOther = true;
                                break;
                            }
                        }
                        if (!touchesOther && isBlackSafeToRemove(nb, state, g)) {
                            nbrs.push(nb);
                        }
                    }
                }
            }

            if (nbrs.length > 0) {
                const pick = nbrs[Math.floor(rng() * nbrs.length)];
                state[pick] = WHITE;
                isl.push(pick);
                growing = true;
            }
        }
    }

    // Resolve 2x2 black pools by growing adjacent islands safely
    for (let pass = 0; pass < 5; pass++) {
        let poolsFixed = 0;
        for (const [a, b, c, d] of g.squares) {
            if (state[a] === BLACK && state[b] === BLACK &&
                state[c] === BLACK && state[d] === BLACK) {
                const quad = shuffle([a, b, c, d], rng);
                for (const cell of quad) {
                    let touchIslIdx = -1;
                    let touchMultiple = false;
                    for (const nb of g.nbrs[cell]) {
                        if (state[nb] === WHITE) {
                            const islIdx = islands.findIndex(isl => isl.includes(nb));
                            if (islIdx !== -1) {
                                if (touchIslIdx === -1) touchIslIdx = islIdx;
                                else if (touchIslIdx !== islIdx) { touchMultiple = true; break; }
                            }
                        }
                    }
                    if (!touchMultiple && touchIslIdx !== -1 && isBlackSafeToRemove(cell, state, g)) {
                        state[cell] = WHITE;
                        islands[touchIslIdx].push(cell);
                        poolsFixed++;
                        break;
                    }
                }
            }
        }
        if (poolsFixed === 0) break;
    }

    let pools = 0;
    for (const [a, b, c, d] of g.squares) {
        if (state[a] === BLACK && state[b] === BLACK &&
            state[c] === BLACK && state[d] === BLACK) pools++;
    }
    if (pools > 0) return null;

    return { state, islands };
}

function eqState(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function deriveUnique(R, C, solved, rng) {
    const g = geom(R, C);
    for (let tries = 0; tries < 10; tries++) {
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
 * Island count is controlled to lie in [N-1, 1.25N] for N×N boards;
 * individual island sizes are not capped.
 * @param {number} R
 * @param {number} C
 * @param {{ seed?: number, maxAttempts?: number }} opts
 * @returns {{ R: number, C: number, clues: number[][], solution: number[][] } | null}
 */
export function generatePuzzle(R, C, opts = {}) {
    const seed = opts.seed ?? (Date.now() & 0x7fffffff);
    const maxAttempts = opts.maxAttempts ?? 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const rng = mulberry32(seed + attempt * 2654435761);
        const solved = buildConnectedCarvedBoard(R, C, rng);
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
