// Nurikabe engine — solver + generator.
// Ported from https://github.com/sen-ltd/nurikabe (MIT-style reference impl).

export const UNKNOWN = 0;
export const WHITE = 1;
export const BLACK = 2;

/** @typedef {{ R: number, C: number, clues: number[] }} Puzzle */

/** @typedef {{ R: number, C: number, N: number, nbrs: number[][], squares: [number,number,number,number][] }} Geom */

const _geomCache = new Map();

export function geom(R, C) {
    const key = R * 1000 + C;
    const hit = _geomCache.get(key);
    if (hit) return hit;

    const N = R * C;
    const nbrs = [];
    // Flat CSR-style neighbour table — avoids per-cell array iteration overhead
    // in the propagate hot loop.
    const nbrOff = new Int32Array(N + 1);
    const nbrList = new Int32Array(N * 4);
    let k = 0;
    for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
            const i = r * C + c;
            nbrOff[i] = k;
            const ns = [];
            if (r > 0) ns.push((r - 1) * C + c);
            if (r < R - 1) ns.push((r + 1) * C + c);
            if (c > 0) ns.push(r * C + (c - 1));
            if (c < C - 1) ns.push(r * C + (c + 1));
            nbrs.push(ns);
            for (const n of ns) nbrList[k++] = n;
        }
    }
    nbrOff[N] = k;

    const squares = [];
    for (let r = 0; r < R - 1; r++) {
        for (let c = 0; c < C - 1; c++) {
            const a = r * C + c;
            squares.push([a, a + 1, a + C, a + C + 1]);
        }
    }
    // Flat square table (4 ints per square) — no per-square array allocation.
    const sqFlat = new Int32Array(squares.length * 4);
    for (let s = 0; s < squares.length; s++) {
        sqFlat[s * 4] = squares[s][0];
        sqFlat[s * 4 + 1] = squares[s][1];
        sqFlat[s * 4 + 2] = squares[s][2];
        sqFlat[s * 4 + 3] = squares[s][3];
    }

    const g = {
        R, C, N, nbrs, squares, nbrOff, nbrList, sqFlat,
        // Scratch buffers reused by propagate(). Safe because propagate is never
        // re-entrant (solveAll recursion calls it sequentially, never nested).
        _scratch: {
            seen: new Uint8Array(N),
            regionId: new Int32Array(N),
            reach: new Uint8Array(N),
            spent: new Int32Array(N),
            stack: new Int32Array(N),
            queue: new Int32Array(N),
            cells: new Int32Array(N),
            mark: new Int32Array(N),
            markGen: 0,
            regCells: [],   // flat cell list per clued region
            regStart: [],
            regClue: [],
        },
    };
    _geomCache.set(key, g);
    return g;
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

// Lazily grown scratch buffers shared per-geometry. propagate() is never
// re-entrant, so reusing them across calls is safe and removes ~10 typed-array
// allocations per call (propagate runs tens of thousands of times per puzzle).
function scratch(g) {
    let s = g._scratch;
    if (!s.ready) {
        const N = g.N;
        s.seen = new Uint8Array(N);
        s.regionId = new Int32Array(N);
        s.reach = new Uint8Array(N);
        s.spent = new Int32Array(N);
        s.stack = new Int32Array(N);
        // Relaxation BFS can re-enqueue a cell up to once per improved cost,
        // so the queue needs headroom beyond N.
        s.queue = new Int32Array(N * 5);
        s.cells = new Int32Array(N);
        s.regCell = new Int32Array(N);
        s.regStart = new Int32Array(N + 1);
        s.regClue = new Int32Array(N);
        s.blackSeen = new Uint8Array(N);
        s.exitMark = new Int32Array(N);
        s.exitGen = 0;
        s.ready = true;
    }
    return s;
}

export function propagate(state, g, p) {
    const N = g.N;
    const clues = p.clues;
    const nbrOff = g.nbrOff;
    const nbrList = g.nbrList;
    const sqFlat = g.sqFlat;
    const sqCount = sqFlat.length >> 2;
    const s = scratch(g);
    const seen = s.seen;
    const regionId = s.regionId;
    const reach = s.reach;
    const spent = s.spent;
    const stack = s.stack;
    const queue = s.queue;
    const regCell = s.regCell;
    const regStart = s.regStart;
    const regClue = s.regClue;
    const blackSeen = s.blackSeen;
    const exitMark = s.exitMark;

    let changed = true;
    while (changed) {
        changed = false;

        // 1. Check 2x2 pools (3 black + 1 unknown => 4th is white)
        for (let q = 0; q < sqCount; q++) {
            const o = q << 2;
            let black = 0;
            let unknown = -1;
            let unknownCount = 0;
            for (let t = 0; t < 4; t++) {
                const cell = sqFlat[o + t];
                const v = state[cell];
                if (v === BLACK) black++;
                else if (v === UNKNOWN) { unknown = cell; unknownCount++; }
            }
            if (black === 4) return false;
            if (black === 3 && unknownCount === 1) {
                state[unknown] = WHITE;
                changed = true;
            }
        }

        // 2. White regions analysis & Island Merger Prevention
        seen.fill(0);
        regionId.fill(-1);
        let regCount = 0;
        let regTop = 0;      // write cursor into regCell
        regStart[0] = 0;

        for (let i = 0; i < N; i++) {
            if (state[i] !== WHITE || seen[i]) continue;

            let sp = 0;
            let cellStart = regTop;
            let cellCount = 0;
            stack[sp++] = i;
            seen[i] = 1;
            let clue = 0;
            while (sp > 0) {
                const cur = stack[--sp];
                regCell[cellStart + cellCount] = cur;
                cellCount++;
                if (clues[cur] > 0) clue = clue === 0 ? clues[cur] : -1;
                for (let k = nbrOff[cur]; k < nbrOff[cur + 1]; k++) {
                    const nb = nbrList[k];
                    if (!seen[nb] && state[nb] === WHITE) {
                        seen[nb] = 1;
                        stack[sp++] = nb;
                    }
                }
            }

            if (clue === -1) return false; // Two clues merged -> contradiction!
            if (clue > 0) {
                if (cellCount > clue) return false;
                const id = regCount;
                for (let t = 0; t < cellCount; t++) regionId[regCell[cellStart + t]] = id;
                regClue[id] = clue;
                regStart[id] = cellStart;
                regStart[id + 1] = cellStart + cellCount;
                regCount++;
                regTop = cellStart + cellCount;

                // If island is complete -> surround all border unknown cells with black
                if (cellCount === clue) {
                    for (let t = 0; t < cellCount; t++) {
                        const cell = regCell[cellStart + t];
                        for (let k = nbrOff[cell]; k < nbrOff[cell + 1]; k++) {
                            const nb = nbrList[k];
                            if (state[nb] === UNKNOWN) {
                                state[nb] = BLACK;
                                changed = true;
                            }
                        }
                    }
                }
            }
            // Unclued regions are not recorded — regTop stays put and their cells
            // are overwritten by the next clued region.
        }

        // 3. Unknown cell bridging 2 different clued regions -> MUST BE BLACK!
        for (let i = 0; i < N; i++) {
            if (state[i] !== UNKNOWN) continue;
            let touchId = -1;
            let multiTouch = false;
            for (let k = nbrOff[i]; k < nbrOff[i + 1]; k++) {
                const rId = regionId[nbrList[k]];
                if (rId !== -1) {
                    if (touchId === -1) touchId = rId;
                    else if (touchId !== rId) { multiTouch = true; break; }
                }
            }
            if (multiTouch) {
                state[i] = BLACK;
                changed = true;
            }
        }

        // 4. Single-option expansion for incomplete white island
        for (let id = 0; id < regCount; id++) {
            const cs = regStart[id];
            const ce = regStart[id + 1];
            const clue = regClue[id];
            if (ce - cs >= clue) continue;

            const gen = ++s.exitGen;
            let candCount = 0;
            let lastCand = -1;
            for (let t = cs; t < ce; t++) {
                const cell = regCell[t];
                for (let k = nbrOff[cell]; k < nbrOff[cell + 1]; k++) {
                    const nb = nbrList[k];
                    if (state[nb] !== UNKNOWN || exitMark[nb] === gen) continue;
                    let canTouchOther = false;
                    for (let k2 = nbrOff[nb]; k2 < nbrOff[nb + 1]; k2++) {
                        const rId = regionId[nbrList[k2]];
                        if (rId !== -1 && rId !== id) { canTouchOther = true; break; }
                    }
                    if (!canTouchOther) {
                        exitMark[nb] = gen;
                        candCount++;
                        lastCand = nb;
                    }
                }
            }
            if (candCount === 0) return false; // Impossible to complete island!
            if (candCount === 1) {
                state[lastCand] = WHITE;
                changed = true;
            }
        }

        // 5. Reachability from clues
        reach.fill(0);
        for (let id = 0; id < regCount; id++) {
            const cs = regStart[id];
            const ce = regStart[id + 1];
            const budget = regClue[id] - (ce - cs);
            for (let t = cs; t < ce; t++) reach[regCell[t]] = 1;
            if (budget <= 0) continue;

            spent.fill(999);
            let qh = 0;
            let qt = 0;
            for (let t = cs; t < ce; t++) {
                const cell = regCell[t];
                spent[cell] = 0;
                queue[qt++] = cell;
            }
            while (qh < qt) {
                const cur = queue[qh++];
                const base = spent[cur];
                for (let k = nbrOff[cur]; k < nbrOff[cur + 1]; k++) {
                    const nb = nbrList[k];
                    const v = state[nb];
                    if (v === BLACK) continue;
                    if (v === WHITE && regionId[nb] !== -1 && regionId[nb] !== id) continue;
                    const nd = base + (v === UNKNOWN ? 1 : 0);
                    if (nd <= budget && nd < spent[nb]) {
                        spent[nb] = nd;
                        reach[nb] = 1;
                        if (qt < queue.length) queue[qt++] = nb;
                    }
                }
            }
        }

        for (let i = 0; i < N; i++) {
            if (reach[i]) continue;
            if (state[i] === UNKNOWN) {
                state[i] = BLACK;
                changed = true;
            } else if (state[i] === WHITE && regionId[i] === -1) {
                return false;
            }
        }

        // 6. Black Sea Connectivity Check (Bottleneck & Disconnection check)
        let firstBlack = -1;
        let blackCount = 0;
        for (let i = 0; i < N; i++) {
            if (state[i] === BLACK) {
                blackCount++;
                if (firstBlack === -1) firstBlack = i;
            }
        }

        if (blackCount > 0) {
            // Reuse `seen` — region data has already been consumed above.
            seen.fill(0);
            let sp = 0;
            stack[sp++] = firstBlack;
            seen[firstBlack] = 1;
            let reachedBlackCount = 0;
            while (sp > 0) {
                const cur = stack[--sp];
                if (state[cur] === BLACK) reachedBlackCount++;
                for (let k = nbrOff[cur]; k < nbrOff[cur + 1]; k++) {
                    const nb = nbrList[k];
                    if (!seen[nb] && state[nb] !== WHITE) {
                        seen[nb] = 1;
                        stack[sp++] = nb;
                    }
                }
            }
            if (reachedBlackCount < blackCount) return false;

            blackSeen.fill(0);
            for (let i = 0; i < N; i++) {
                if (state[i] !== BLACK || blackSeen[i]) continue;
                let bsp = 0;
                stack[bsp++] = i;
                blackSeen[i] = 1;
                let compSize = 0;
                const gen = ++s.exitGen;
                let exitCount = 0;
                let lastExit = -1;
                while (bsp > 0) {
                    const cur = stack[--bsp];
                    compSize++;
                    for (let k = nbrOff[cur]; k < nbrOff[cur + 1]; k++) {
                        const nb = nbrList[k];
                        const v = state[nb];
                        if (v === BLACK) {
                            if (!blackSeen[nb]) { blackSeen[nb] = 1; stack[bsp++] = nb; }
                        } else if (v === UNKNOWN && exitMark[nb] !== gen) {
                            exitMark[nb] = gen;
                            exitCount++;
                            lastExit = nb;
                        }
                    }
                }
                if (blackCount > compSize) {
                    if (exitCount === 0) return false;
                    if (exitCount === 1) {
                        state[lastExit] = BLACK;
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

export function solveAll(p, limit = 2, maxBranches = 5000) {
    const g = geom(p.R, p.C);
    const out = [];
    let branchCount = 0;

    const recurse = (state) => {
        if (out.length >= limit || branchCount >= maxBranches) return;
        branchCount++;
        if (!propagate(state, g, p)) return;
        const cell = pickBranch(state, g);
        if (cell === -1) {
            if (isSolved(state, g, p)) out.push(state);
            return;
        }
        for (const guess of [BLACK, WHITE]) {
            if (out.length >= limit || branchCount >= maxBranches) return;
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

export function mulberry32(seed) {
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

/** Is the black sea still fully connected if `cell` becomes white? */
function seaStaysConnected(cell, state, g) {
    const prev = state[cell];
    state[cell] = WHITE;
    let first = -1;
    let count = 0;
    for (let i = 0; i < g.N; i++) {
        if (state[i] === BLACK) {
            count++;
            if (first === -1) first = i;
        }
    }
    if (count === 0) {
        state[cell] = prev;
        return false;
    }
    const seen = new Uint8Array(g.N);
    const stack = [first];
    seen[first] = 1;
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
    state[cell] = prev;
    return reached === count;
}

/** Is the whole black sea one connected component in the current state? */
function seaConnected(state, g) {
    let first = -1;
    let count = 0;
    for (let i = 0; i < g.N; i++) {
        if (state[i] === BLACK) {
            count++;
            if (first === -1) first = i;
        }
    }
    if (count === 0) return false;
    const seen = new Uint8Array(g.N);
    const stack = [first];
    seen[first] = 1;
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
    return reached === count;
}

function hasPool(state, g) {
    for (const [a, b, c, d] of g.squares) {
        if (state[a] === BLACK && state[b] === BLACK &&
            state[c] === BLACK && state[d] === BLACK) return true;
    }
    return false;
}

/** Enumerate the white islands (connected white components) of a state. */
function islandsOf(state, g) {
    const seen = new Uint8Array(g.N);
    const out = [];
    for (let i = 0; i < g.N; i++) {
        if (state[i] !== WHITE || seen[i]) continue;
        const cells = [];
        const stack = [i];
        seen[i] = 1;
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
        out.push(cells);
    }
    return out;
}

/**
 * Build a random legal Nurikabe solution with a *targeted island count*.
 *
 * A count K is drawn from [minIslands, maxIslands] up front and a size budget is
 * distributed across the K islands; each island is then grown from a legal seed
 * while keeping the black sea connected at every step. Leftover 2x2 black pools
 * are dissolved afterwards, preferring the fix that extends a single existing
 * island (which leaves the count untouched) over merging or spawning islands.
 *
 * Returns null if the final count falls outside [minIslands, maxIslands].
 */
function buildSolution(R, C, rng, opt) {
    const g = geom(R, C);
    const N = g.N;
    const state = new Int8Array(N).fill(BLACK);
    const owner = new Int32Array(N).fill(-1);
    let islands = [];

    const initialMinIslands = opt.initialMinIslands ?? opt.minIslands;
    const K = initialMinIslands + Math.floor(
        rng() * (opt.maxIslands - initialMinIslands + 1)
    );
    const targetWhite = Math.round(N * opt.white);

    // Distribute the white budget across K islands, capped at maxSize each.
    const sizes = new Array(K).fill(1);
    let budget = targetWhite - K;
    let spins = 0;
    while (budget > 0 && spins++ < N * 10) {
        const i = Math.floor(rng() * K);
        if (sizes[i] >= opt.maxSize) continue;
        sizes[i]++;
        budget--;
    }

    const cells = shuffle(Array.from({ length: N }, (_, i) => i), rng);
    for (let id = 0; id < K; id++) {
        // A legal seed is a black cell with no white neighbour that can be
        // whitened without splitting the sea.
        let seed = -1;
        for (const c of cells) {
            if (state[c] !== BLACK) continue;
            let adjWhite = false;
            for (const nb of g.nbrs[c]) if (state[nb] === WHITE) { adjWhite = true; break; }
            if (adjWhite) continue;
            if (!seaStaysConnected(c, state, g)) continue;
            seed = c;
            break;
        }
        if (seed === -1) break;

        const isl = [seed];
        state[seed] = WHITE;
        owner[seed] = id;

        while (isl.length < sizes[id]) {
            const cand = [];
            for (const c of isl) {
                for (const nb of g.nbrs[c]) {
                    if (state[nb] !== BLACK) continue;
                    let touchesOther = false;
                    for (const n2 of g.nbrs[nb]) {
                        if (state[n2] === WHITE && owner[n2] !== id) { touchesOther = true; break; }
                    }
                    if (touchesOther) continue;
                    if (!seaStaysConnected(nb, state, g)) continue;
                    cand.push(nb);
                }
            }
            if (!cand.length) break;
            const pick = cand[Math.floor(rng() * cand.length)];
            state[pick] = WHITE;
            owner[pick] = id;
            isl.push(pick);
        }
        islands.push(isl);
        shuffle(cells, rng);
    }

    // Dissolve 2x2 black pools, in two priorities per pool:
    //   1. whiten a cell touching exactly one island -> extends it, count unchanged
    //   2. otherwise merge islands / spawn a new one -> count changes
    for (let pass = 0; pass < 12; pass++) {
        let fixed = 0;
        for (const [a, b, c, d] of g.squares) {
            if (state[a] !== BLACK || state[b] !== BLACK ||
                state[c] !== BLACK || state[d] !== BLACK) continue;

            let handled = false;
            for (const cell of shuffle([a, b, c, d], rng)) {
                if (!seaStaysConnected(cell, state, g)) continue;
                const owners = new Set();
                for (const nb of g.nbrs[cell]) {
                    if (state[nb] === WHITE && owner[nb] >= 0) owners.add(owner[nb]);
                }
                if (owners.size !== 1) continue;
                const o = owners.values().next().value;
                state[cell] = WHITE;
                owner[cell] = o;
                islands[o].push(cell);
                fixed++;
                handled = true;
                break;
            }
            if (handled) continue;

            for (const cell of shuffle([a, b, c, d], rng)) {
                if (!seaStaysConnected(cell, state, g)) continue;
                state[cell] = WHITE;
                const owners = new Set();
                for (const nb of g.nbrs[cell]) {
                    if (state[nb] === WHITE && owner[nb] >= 0) owners.add(owner[nb]);
                }
                if (owners.size === 0) {
                    owner[cell] = islands.length;
                    islands.push([cell]);
                } else {
                    const keep = Math.min(...owners);
                    owner[cell] = keep;
                    islands[keep].push(cell);
                    for (const o of owners) {
                        if (o === keep) continue;
                        for (const x of islands[o]) {
                            owner[x] = keep;
                            islands[keep].push(x);
                        }
                        islands[o] = null;
                    }
                }
                fixed++;
                break;
            }
        }
        if (!fixed) break;
    }
    islands = islands.filter(Boolean);

    if (hasPool(state, g)) return null;
    if (islands.length < opt.minIslands || islands.length > opt.maxIslands) return null;
    return { state, islands };
}

/**
 * Human-style logic solver: run `propagate`, then try each frontier unknown cell
 * both ways; if one branch is contradictory the other value is forced. Repeat
 * until no progress.
 *
 * Used instead of `solveAll` during generation. Full DFS search is exponential
 * on 12x12+ boards (100k+ branches, many seconds per candidate); this runs in
 * low milliseconds and, as a bonus, only accepts puzzles a human can actually
 * deduce without guessing.
 *
 * @returns {{ solved: Int8Array|null, partial: Int8Array|null }}
 */
function logicSolve(p, g) {
    const state = initialState(p);
    if (!propagate(state, g, p)) return { solved: null, partial: null };

    const tryW = new Int8Array(g.N);
    const tryB = new Int8Array(g.N);
    for (;;) {
        if (isSolved(state, g, p)) return { solved: state, partial: state };
        let progress = false;
        for (let i = 0; i < g.N; i++) {
            if (state[i] !== UNKNOWN) continue;
            // Only frontier cells are worth trialling — an isolated unknown
            // rarely produces a contradiction and doubles the work.
            let frontier = false;
            for (const nb of g.nbrs[i]) if (state[nb] !== UNKNOWN) { frontier = true; break; }
            if (!frontier) continue;

            tryW.set(state);
            tryW[i] = WHITE;
            const okW = propagate(tryW, g, p);
            tryB.set(state);
            tryB[i] = BLACK;
            const okB = propagate(tryB, g, p);

            if (!okW && !okB) return { solved: null, partial: null };
            if (!okW) { state.set(tryB); progress = true; continue; }
            if (!okB) { state.set(tryW); progress = true; continue; }
        }
        if (!progress) break;
    }
    return { solved: null, partial: state };
}

function eqState(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

/**
 * Turn a legal solution into a logically-solvable puzzle, repairing it in place
 * when it isn't.
 *
 * Each round places one clue per island and runs `logicSolve`. If the puzzle is
 * not fully deducible, one white cell that the solver could not pin down is
 * flipped to black (keeping the sea connected and pool-free) and the round
 * repeats. Shrinking the ambiguous islands is what converges the board toward
 * uniqueness, instead of rerolling a whole new random board every time.
 */
function deriveByRepair(R, C, solved, rng, maxRepairs, minIslands, maxIslands,
    acceptLegalCandidate = false) {
    const g = geom(R, C);
    const state = solved.state;
    const inRange = (n) => n >= minIslands && n <= maxIslands;
    for (let it = 0; it < maxRepairs; it++) {
        const islands = islandsOf(state, g);
        if (!islands.length) return null;
        if (!inRange(islands.length)) return null;
        const clues = new Array(g.N).fill(0);
        for (const cells of islands) {
            clues[cells[Math.floor(rng() * cells.length)]] = cells.length;
        }
        const p = { R, C, clues };
        const { solved: sol, partial } = logicSolve(p, g);
        if (sol && eqState(sol, state)) return { clues, solution: state };
        // With a low island cap, large boards are rarely completed by the
        // lightweight logic solver. The generated state is already legal, so
        // keep it rather than rejecting every Hard-board candidate.
        if (acceptLegalCandidate) return { clues, solution: state };

        // Repair candidates: cells the solver could not determine. Shrinking an
        // island (white -> black) is tried first, then growing one, and every
        // flip must keep the island count inside the requested band.
        const ambWhite = [];
        const ambBlack = [];
        for (let i = 0; i < g.N; i++) {
            if (partial && partial[i] !== UNKNOWN) continue;
            if (state[i] === WHITE && clues[i] === 0) ambWhite.push(i);
            else if (state[i] === BLACK) ambBlack.push(i);
        }

        let flipped = false;
        for (const c of shuffle(ambWhite, rng)) {
            state[c] = BLACK;
            if (seaConnected(state, g) && !hasPool(state, g) &&
                inRange(islandsOf(state, g).length)) { flipped = true; break; }
            state[c] = WHITE;
        }
        if (!flipped) {
            for (const c of shuffle(ambBlack, rng)) {
                state[c] = WHITE;
                if (seaConnected(state, g) && !hasPool(state, g) &&
                    inRange(islandsOf(state, g).length)) { flipped = true; break; }
                state[c] = BLACK;
            }
        }
        if (!flipped) return null;
    }
    return null;
}

/**
 * Island-count band for an R×C board: [n-1, 2n] where n = max(R, C).
 *
 * The upper bound is the one that bites: capping the count forces larger average
 * islands, and large islands are what destroy unique solvability. A 1.5n cap
 * yields zero unique puzzles on 12×12 even under exhaustive DFS search
 * (measured: 84 boards -> 40 multi-solution, 33 unsolvable, 0 unique). 2n keeps
 * comfortably inside the feasible region for every size we ship (7, 12, 16).
 */
export function islandCountBand(R, C) {
    const n = Math.max(R, C);
    return { minIslands: n - 1, maxIslands: 2 * n };
}

/**
 * Generation tuning per board size.
 *
 * Island *area* is deliberately uncapped (`maxSize: Infinity`) — only the island
 * *count* is constrained, via `islandCountBand`. The white-cell budget is spread
 * randomly across the chosen number of islands, so sizes vary naturally instead
 * of being clipped to a uniform maximum.
 */
function genOpts(R, C) {
    const n = Math.max(R, C);
    const band = islandCountBand(R, C);
    if (n <= 8) return { white: 0.38, maxSize: Infinity, ...band };
    if (n >= 12 && n < 16) return {
        white: 0.42,
        maxSize: Infinity,
        initialMinIslands: Math.ceil(n * 1.5),
        acceptLegalCandidate: true,
        ...band,
    };
    // Large boards need to start near the top of the permitted band. Starting
    // at its low end produces oversized islands that the logic solver rarely
    // resolves, even though the eventual puzzle still meets the count limit.
    if (n >= 16) return {
        white: 0.42,
        maxSize: Infinity,
        initialMinIslands: Math.ceil(n * 1.75),
        acceptLegalCandidate: true,
        ...band,
    };
    return { white: 0.42, maxSize: Infinity, ...band };
}

// === New generator: carve → trimSea → placeClues (medium/hard boards) ===
// Internal cell model: BLACK = sea, WHITE = island. Converted to engine
// WHITE/BLACK constants on output. No solver dependency.

const _B = 1;   // black (sea)
const _W = 0;   // white (island)
const _idx = (r, c, C) => r * C + c;
const _DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const _DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

class _DSU {
  constructor(n) { this.p = new Int32Array(n).fill(-1); }
  find(x) { while (this.p[x] >= 0) x = this.p[x]; return x; }
  union(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.p[ra] > this.p[rb]) [ra, rb] = [rb, ra];
    this.p[ra] += this.p[rb];
    this.p[rb] = ra;
  }
}

// v is not a cut vertex of the black region ⟺ all black neighbours of v lie in a
// single component of G\{v}. Keeps the sea connected when v is whitened.
function _keepsSeaConnected(board, R, C, v) {
  const r0 = Math.floor(v / C), c0 = v % C;
  const neigh = [];
  for (const [dr, dc] of _DIRS) {
    const nr = r0 + dr, nc = c0 + dc;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
    if (board[_idx(nr, nc, C)] === _B) neigh.push(_idx(nr, nc, C));
  }
  if (neigh.length <= 1) return true;
  const visited = new Uint8Array(R * C);
  const stack = [neigh[0]];
  visited[neigh[0]] = 1;
  while (stack.length) {
    const cur = stack.pop();
    const r = Math.floor(cur / C), c = cur % C;
    for (const [dr, dc] of _DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      const ni = _idx(nr, nc, C);
      if (ni === v) continue;
      if (board[ni] === _B && !visited[ni]) { visited[ni] = 1; stack.push(ni); }
    }
  }
  for (let i = 1; i < neigh.length; i++) if (!visited[neigh[i]]) return false;
  return true;
}

// Carve from a checkerboard (black if r even or c even; white only on odd×odd),
// which starts with floor(N/2)^2 islands, then whiten black cells (keeping the sea
// connected) until exactly `target` islands remain. Returns null if unreachable.
function _generateBoard(R, C, target, rng, { maxRestarts = 50, maxStuck = 5000 } = {}) {
  const N = R * C;
  for (let restart = 0; restart < maxRestarts; restart++) {
    const board = new Uint8Array(N);
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++)
        board[_idx(r, c, C)] = (r % 2 === 0 || c % 2 === 0) ? _B : _W;

    const dsu = new _DSU(N);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const i = _idx(r, c, C);
      if (board[i] !== _W) continue;
      if (c + 1 < C && board[_idx(r, c + 1, C)] === _W) dsu.union(i, _idx(r, c + 1, C));
      if (r + 1 < R && board[_idx(r + 1, c, C)] === _W) dsu.union(i, _idx(r + 1, c, C));
    }
    const roots = new Set();
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const i = _idx(r, c, C);
      if (board[i] === _W) roots.add(dsu.find(i));
    }
    let islands = roots.size;

    if (islands === target) return { board, islands, R, C };
    if (islands < target) return null;

    const blackCells = [];
    for (let i = 0; i < N; i++) if (board[i] === _B) blackCells.push(i);

    let stuck = 0;
    while (islands > target) {
      if (blackCells.length === 0) break;
      const k = Math.floor(rng() * blackCells.length);
      const v = blackCells[k];
      if (!_keepsSeaConnected(board, R, C, v)) {
        stuck++;
        if (stuck > maxStuck) break;
        continue;
      }
      {
        const r0 = Math.floor(v / C), c0 = v % C;
        const roots = new Set();
        let mergedSize = 1;
        for (const [dr, dc] of _DIRS) {
          const nr = r0 + dr, nc = c0 + dc;
          if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
          const ni = _idx(nr, nc, C);
          if (board[ni] === _W) {
            const root = dsu.find(ni);
            if (!roots.has(root)) { roots.add(root); mergedSize -= dsu.p[root]; }
          }
        }
        if (mergedSize > R) { stuck++; if (stuck > maxStuck) break; continue; }
      }
      board[v] = _W;
      const r0 = Math.floor(v / C), c0 = v % C;
      const seen = new Set();
      for (const [dr, dc] of _DIRS) {
        const nr = r0 + dr, nc = c0 + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const ni = _idx(nr, nc, C);
        if (board[ni] === _W) {
          const root = dsu.find(ni);
          if (!seen.has(root)) { seen.add(root); dsu.union(v, ni); }
        }
      }
      islands -= (seen.size - 1);
      blackCells[k] = blackCells[blackCells.length - 1];
      blackCells.pop();
      stuck = 0;
    }
    if (islands === target) return { board, islands, R, C };
  }
  return null;
}

// Concentric-square (spiral) order: outermost ring first, inward.
function _ringOrder(R, C) {
  const cells = [];
  const rings = Math.floor(Math.min(R, C) / 2);
  for (let d = 0; d < rings; d++) {
    for (let c = d; c <= C - 1 - d; c++) cells.push(_idx(d, c, C));
    for (let r = d + 1; r <= R - 1 - d; r++) cells.push(_idx(r, C - 1 - d, C));
    for (let c = C - 2 - d; c >= d; c--) cells.push(_idx(R - 1 - d, c, C));
    for (let r = R - 2 - d; r >= d + 1; r--) cells.push(_idx(r, d, C));
  }
  return cells;
}

// Trim to a minimal sea: in ring order, whiten any black cell whose removal keeps
// island count unchanged (exactly one white component among neighbours) and keeps
// the sea connected. Fixed point; only grows islands, never changes their count.
function _trimSea(board, R, C) {
  const N = R * C;
  const dsu = new _DSU(N);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = _idx(r, c, C);
    if (board[i] !== _W) continue;
    if (c + 1 < C && board[_idx(r, c + 1, C)] === _W) dsu.union(i, _idx(r, c + 1, C));
    if (r + 1 < R && board[_idx(r + 1, c, C)] === _W) dsu.union(i, _idx(r + 1, c, C));
  }
  const order = _ringOrder(R, C);
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of order) {
      if (board[v] !== _B) continue;
      const r0 = Math.floor(v / C), c0 = v % C;
      const roots = new Set();
      for (const [dr, dc] of _DIRS) {
        const nr = r0 + dr, nc = c0 + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const ni = _idx(nr, nc, C);
        if (board[ni] === _W) roots.add(dsu.find(ni));
      }
      if (roots.size !== 1) continue;             // exactly one white component → count unchanged
      if (!_keepsSeaConnected(board, R, C, v)) continue;
      board[v] = _W;
      for (const [dr, dc] of _DIRS) {
        const nr = r0 + dr, nc = c0 + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const ni = _idx(nr, nc, C);
        if (board[ni] === _W) dsu.union(v, ni);
      }
      changed = true;
    }
  }
  return board;
}

function _enumerateIslands(board, R, C) {
  const N = R * C;
  const seen = new Uint8Array(N);
  const islands = [];
  for (let s = 0; s < N; s++) {
    if (board[s] !== _W || seen[s]) continue;
    const cells = [];
    const st = [s]; seen[s] = 1;
    while (st.length) {
      const cur = st.pop();
      cells.push(cur);
      const r = Math.floor(cur / C), c = cur % C;
      for (const [dr, dc] of _DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        const ni = _idx(nr, nc, C);
        if (board[ni] === _W && !seen[ni]) { seen[ni] = 1; st.push(ni); }
      }
    }
    islands.push({ cells, size: cells.length });
  }
  return islands;
}

function _orthoBlack(board, R, C, cell) {
  const r = Math.floor(cell / C), c = cell % C;
  let n = 0;
  for (const [dr, dc] of _DIRS) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
    if (board[_idx(nr, nc, C)] === _B) n++;
  }
  return n;
}

// Place one clue per island (value = island size):
//   rule 1 : size-1 island → its only cell
//   rule 2 : a cell whose diagonal neighbour is another island's placed clue →
//            place here (ties: most orthogonal sea neighbours, then random)
//   rule 3 : when rule 2 finds nothing, place on the most sea-exposed unclued
//            island's most sea-adjacent cell, then re-run rule 2.
function _placeClues(board, R, C, rng) {
  const islands = _enumerateIslands(board, R, C);
  const clues = new Int32Array(R * C);
  const clued = new Array(islands.length).fill(false);
  const owner = new Int32Array(R * C).fill(-1);
  islands.forEach((isl, id) => { for (const c of isl.cells) owner[c] = id; });

  for (let id = 0; id < islands.length; id++) {
    if (islands[id].size === 1) { clues[islands[id].cells[0]] = 1; clued[id] = true; }
  }

  const diagNeighbours = (cell) => {
    const r = Math.floor(cell / C), c = cell % C;
    const out = [];
    for (const [dr, dc] of _DIAG) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
      out.push(_idx(nr, nc, C));
    }
    return out;
  };

  for (;;) {
    let progressed = false;
    for (let id = 0; id < islands.length; id++) {
      if (clued[id]) continue;
      const isl = islands[id];
      let best = -1, bestScore = -1;
      for (const cell of isl.cells) {
        let hits = false;
        for (const n of diagNeighbours(cell)) {
          if (clues[n] > 0 && owner[n] !== id) { hits = true; break; }
        }
        if (!hits) continue;
        const score = _orthoBlack(board, R, C, cell) + rng() * 0.5;
        if (score > bestScore) { bestScore = score; best = cell; }
      }
      if (best >= 0) { clues[best] = isl.size; clued[id] = true; progressed = true; }
    }
    if (progressed) continue;

    let pickId = -1, pickCell = -1, pickScore = -1;
    for (let id = 0; id < islands.length; id++) {
      if (clued[id]) continue;
      let bi = -1, bs = -1;
      for (const cell of islands[id].cells) {
        const s = _orthoBlack(board, R, C, cell) + rng() * 0.5;
        if (s > bs) { bs = s; bi = cell; }
      }
      if (bs > pickScore) { pickScore = bs; pickId = id; pickCell = bi; }
    }
    if (pickId === -1) break;
    clues[pickCell] = islands[pickId].size;
    clued[pickId] = true;
  }
  return clues;
}

/**
 * Generate a Nurikabe puzzle.
 *
 * Two generators share the same output shape `{ R, C, clues, solution }`:
 *   - Small boards (max(R,C) <= 8): the original island-growth + logic-repair
 *     generator (`buildSolution` + `deriveByRepair`), which is reliable there.
 *   - Medium/hard boards (>= 12): the carve → trimSea → placeClues generator
 *     (`_generateBoard` → `_trimSea` → `_placeClues`). It starts from a
 *     checkerboard, carves down to the target island count, trims the sea to a
 *     minimal connected skeleton, and places one size clue per island. No solver
 *     dependency; runs in O(board) time.
 *
 * Output cells are two-state: a clue grid (`clues[r][c]` = island size, 0 = none)
 * plus a solution grid (`solution[r][c]` = WHITE or BLACK). The solver's three
 * states (UNKNOWN/WHITE/BLACK) exist only during solving, never in this output.
 *
 * @param {number} R
 * @param {number} C
 * @param {{ seed?: number, maxAttempts?: number, timeBudgetMs?: number }} opts
 * @returns {{ R: number, C: number, clues: number[][], solution: number[][] } | null}
 */
export function generatePuzzle(R, C, opts = {}) {
    const seed = opts.seed ?? (Date.now() & 0x7fffffff);
    const maxAttempts = opts.maxAttempts ?? 400;
    const timeBudgetMs = opts.timeBudgetMs ?? 3000;
    const deadline = Date.now() + timeBudgetMs;

    // Small boards: keep the original generator.
    if (Math.max(R, C) <= 8) {
        const tuning = opts.tuning ?? genOpts(R, C);
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (Date.now() > deadline) break;
            const rng = mulberry32(seed + attempt * 2654435761);
            const solution = buildSolution(R, C, rng, tuning);
            if (!solution) continue;
            const derived = deriveByRepair(R, C, solution, rng, 80,
                tuning.minIslands, tuning.maxIslands, tuning.acceptLegalCandidate);
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

    // Medium/hard: carve → trim → clue.
    const band = islandCountBand(R, C);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (Date.now() > deadline) break;
        const rng = mulberry32(seed + attempt * 2654435761);
        const target = band.minIslands + Math.floor(rng() * (band.maxIslands - band.minIslands + 1));
        const res = _generateBoard(R, C, target, rng);
        if (!res) continue;
        _trimSea(res.board, R, C);
        const clues = _placeClues(res.board, R, C, rng);

        const clues2d = Array.from({ length: R }, () => Array(C).fill(0));
        const solution2d = Array.from({ length: R }, () => Array(C).fill(WHITE));
        for (let r = 0; r < R; r++) {
            for (let c = 0; c < C; c++) {
                const i = r * C + c;
                clues2d[r][c] = clues[i];
                solution2d[r][c] = res.board[i] === _W ? WHITE : BLACK;
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
