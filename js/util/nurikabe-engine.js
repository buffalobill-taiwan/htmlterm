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
    // Flat CSR-style neighbour table, built once and retained on the geometry.
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
        // Retained scratch buffers.
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

/**
 * Island-count band for an R×C board: [⌈R·C/8⌉, ⌊R·C/6⌋].
 *
 * Ties the number of islands to the board *area* and keeps the range tight, so
 * island counts (and with them puzzle variance) stay similar from game to game.
 * All shipped sizes start carving from ⌊R/2⌋×⌊C/2⌋ islands, comfortably above
 * the band's upper end (8×8: 16 > 10, 12×12: 36 > 24, 16×16: 64 > 42).
 */
export function islandCountBand(R, C) {
    return { minIslands: Math.max(1, Math.ceil(R * C / 8)), maxIslands: Math.floor(R * C / 6) };
}

// === Generator: carve → trimSea → placeClues → pinShapes (all board sizes) ===
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
// which starts with ⌊R/2⌋×⌊C/2⌋ single-cell islands, then randomly flip whole
// odd rows or columns, then whiten black cells (keeping the sea connected) until
// exactly `target` islands remain. Returns null if unreachable.
function _generateBoard(R, C, target, rng, { maxRestarts = 50, maxStuck = 5000 } = {}) {
  const N = R * C;
  for (let restart = 0; restart < maxRestarts; restart++) {
    const board = new Uint8Array(N);
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++)
        board[_idx(r, c, C)] = (r % 2 === 0 || c % 2 === 0) ? _B : _W;

    // Randomize the initial board to avoid predictable patterns
    if (rng() < 0.5) {
      // Row modification: for each odd row, with 50% chance flip the entire row
      for (let r = 1; r < R; r += 2) {
        if (rng() < 0.5) {
          for (let c = 0; c < C; c++) {
            board[_idx(r, c, C)] = board[_idx(r, c, C)] === _B ? _W : _B;
          }
        }
      }
    } else {
      // Column modification: for each odd column, with 50% chance flip the entire column
      for (let c = 1; c < C; c += 2) {
        if (rng() < 0.5) {
          for (let r = 0; r < R; r++) {
            board[_idx(r, c, C)] = board[_idx(r, c, C)] === _B ? _W : _B;
          }
        }
      }
    }

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
//   rule 2 : island touching the board edge in exactly one cell → clue there
//   rule 3 : a cell whose diagonal neighbour is another island's placed clue →
//            place here (ties: most orthogonal sea neighbours, then random)
//   rule 4 : when rule 3 finds nothing, scan 2x2 squares for a diagonal pair of
//            cells from two different, still-unclued islands, place both clues
//   rule 5 : when rules 3-4 find nothing, place on the most sea-exposed unclued
//            island's most sea-adjacent cell, then re-run the loop.
// The clue-position pass (rule 6) runs afterwards in pinIslandShapes; see the
// generatePuzzle docs.
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
    // rule 2 : island touching the board edge in exactly one cell → clue there
    for (let id = 0; id < islands.length; id++) {
      if (clued[id]) continue;
      let edge = -1, count = 0;
      for (const cell of islands[id].cells) {
        const r = Math.floor(cell / C), c = cell % C;
        if (r === 0 || c === 0 || r === R - 1 || c === C - 1) {
          count++;
          edge = cell;
          if (count > 1) break;
        }
      }
      if (count === 1) {
        clues[edge] = islands[id].size;
        clued[id] = true;
        progressed = true;
      }
    }
    if (progressed) continue;
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

    // Scan 2x2 squares for a diagonal pair of cells from two different,
    // still-unclued islands, and place both clues. Orthogonal neighbours can
    // never belong to different islands, so only the diagonal pairs are playable.
    for (let r = 0; r < R - 1 && !progressed; r++) {
      for (let c = 0; c < C - 1; c++) {
        const tl = _idx(r, c, C);
        const tr = _idx(r, c + 1, C);
        const bl = _idx(r + 1, c, C);
        const br = _idx(r + 1, c + 1, C);
        for (const [a, b] of [[tl, br], [tr, bl]]) {
          if (clues[a] !== 0 || clues[b] !== 0) continue;
          const oa = owner[a], ob = owner[b];
          if (oa === -1 || ob === -1 || oa === ob) continue;
          if (clued[oa] || clued[ob]) continue;
          clues[a] = islands[oa].size;
          clues[b] = islands[ob].size;
          clued[oa] = true;
          clued[ob] = true;
          progressed = true;
          break;
        }
      }
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

// === Final rule: pin island shapes by relocating clues ===
// Works on the solver's cell model (WHITE/BLACK) because validity is judged by
// `isSolved`. Also exported for the offline tools so the rule and its audit
// share one implementation.

/** White-island (BFS) regions of a fully WHITE/BLACK state, in scan order. */
export function enumeratePuzzleIslands(state, g) {
    const islands = [];
    const seen = new Uint8Array(g.N);
    for (let s = 0; s < g.N; s++) {
        if (state[s] !== WHITE || seen[s]) continue;
        const cells = [];
        const stack = [s];
        seen[s] = 1;
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
        islands.push({ cells });
    }
    return islands;
}

// Every single-cell shape relocation available to one island: swap one island
// cell that borders the sea (`a`) with one surrounding sea cell (`b`), keep the
// swap only if the whole board is still a valid solution. `candidates` counts
// the (a, b) pairs tested, which equals the number of `isSolved` calls.
export function islandSwapInfo(state, g, p, cells) {
    const hasBlackNbr = new Uint8Array(g.N);
    const seaSet = new Set();
    for (const c of cells) {
        for (const nb of g.nbrs[c]) {
            if (state[nb] === BLACK) {
                hasBlackNbr[c] = 1;
                seaSet.add(nb);
            }
        }
    }
    const frontier = cells.filter((c) => hasBlackNbr[c]);
    const seaList = [...seaSet];

    const swaps = [];
    for (const a of frontier) {
        for (const b of seaList) {
            state[a] = BLACK;
            state[b] = WHITE;
            if (isSolved(state, g, p)) swaps.push({ a, b });
            state[a] = WHITE;
            state[b] = BLACK;
        }
    }
    return { swaps, candidates: frontier.length * seaList.length };
}

function _regionOf(state, g, start) {
    const cells = [];
    const seen = new Uint8Array(g.N);
    const stack = [start];
    seen[start] = 1;
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
}

/**
 * Final clue-position rule (rule 6).  When an island can legally change shape,
 * swap its shape and MOVE its clue onto the swapped-in cell; re-testing proves
 * whether that pins the shape rigid.  Every legal swap is tried as a pin; the
 * first one that leaves the island rigid is adopted (state/clues mutate).
 *
 * Pinning one island can make another changeable, so the pass loops until no
 * further pin is adopted and then re-checks every island.  Only when the whole
 * board ends rigid (SUCCESS) is the result kept; otherwise (an island still
 * changeable) the entire pass is rolled back and the placed clues/shape -are
 * left intact (FAIL).
 *
 * @param {Int8Array} state  WHITE/BLACK state (mutated on adoption)
 * @param {Int32Array} clues flat clue grid (mutated on adoption)
 * @returns {boolean} true when every island ended up rigid (SUCCESS)
 */
export function pinIslandShapes(state, clues, R, C, g) {
    const p = { R, C, clues };
    const origState = state.slice();
    const origClues = clues.slice();

    const pinOneIsland = () => {
        for (const isl of enumeratePuzzleIslands(state, g)) {
            let clueIdx = -1;
            let clueVal = 0;
            for (const c of isl.cells) {
                if (clues[c] > 0) { clueIdx = c; clueVal = clues[c]; break; }
            }
            const { swaps } = islandSwapInfo(state, g, p, isl.cells);
            if (swaps.length === 0) continue;
            for (const { a, b } of swaps) {
                state[a] = BLACK;
                state[b] = WHITE;
                clues[clueIdx] = 0;
                clues[b] = clueVal;
                const after = islandSwapInfo(state, g, p, _regionOf(state, g, b));
                if (after.swaps.length === 0) return true;  // adopted
                state[a] = WHITE;
                state[b] = BLACK;
                clues[clueIdx] = clueVal;
                clues[b] = 0;
            }
            return false;  // island un-pinnable → FAIL
        }
        return false;  // nothing left to pin
    };

    // Loop to a fixpoint: each pass pins one more island, so the pass count is
    // bounded by the number of islands; the guard can never trip in practice.
    const maxPasses = enumeratePuzzleIslands(state, g).length + 1;
    for (let pass = 0; pass <= maxPasses; pass++) {
        if (!pinOneIsland()) break;
    }

    // Final verification: SUCCESS only when every island is rigid.
    for (const isl of enumeratePuzzleIslands(state, g)) {
        const { swaps } = islandSwapInfo(state, g, p, isl.cells);
        if (swaps.length > 0) {
            state.set(origState);
            clues.set(origClues);
            return false;
        }
    }
    return true;
}

/**
 * Generate a Nurikabe puzzle.
 *
 * Output shape is `{ R, C, clues, solution }`, produced by the carve → trimSea →
 * placeClues → pinShapes generator (`_generateBoard` → `_trimSea` → `_placeClues`
 * → `pinIslandShapes`): start from a checkerboard, carve down to the target
 * island count (merges capped at the board side length during carving) and trim
 * the sea to a minimal connected skeleton, then place one size clue per island.
 * `_trimSea` grows islands to their natural extent, so a final island may exceed
 * the side-length cap.
 *
 * The `pinIslandShapes` pass hardens the puzzle against the common duplicate
 * solution: for each island that can legally change shape, the clue is moved
 * onto the flexible cell, pinning the shape rigid. A puzzle ships only when
 * every island ends up rigid; otherwise the board is discarded and the next
 * attempt carves a fresh puzzle. Every returned puzzle is therefore rigid
 * under the single-shape-swap check (unique solution).
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

    const band = islandCountBand(R, C);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (Date.now() > deadline) break;
        const rng = mulberry32(seed + attempt * 2654435761);
        const target = band.minIslands + Math.floor(rng() * (band.maxIslands - band.minIslands + 1));
        const res = _generateBoard(R, C, target, rng);
        if (!res) continue;
        _trimSea(res.board, R, C);
        const clues = _placeClues(res.board, R, C, rng);

        // Final rule (clue-pin): move each flexible island's clue onto a swapped-in
        // cell so the shape goes rigid. On FAIL the board is discarded (the state/
        // clues are already restored internally) and the next attempt carves anew,
        // so only fully rigid puzzles are ever returned.
        const g = geom(R, C);
        const state = new Int8Array(R * C);
        for (let i = 0; i < R * C; i++) state[i] = res.board[i] === _W ? WHITE : BLACK;
        if (!pinIslandShapes(state, clues, R, C, g)) continue;

        const clues2d = Array.from({ length: R }, () => Array(C).fill(0));
        const solution2d = Array.from({ length: R }, () => Array(C).fill(WHITE));
        for (let r = 0; r < R; r++) {
            for (let c = 0; c < C; c++) {
                const i = r * C + c;
                clues2d[r][c] = clues[i];
                solution2d[r][c] = state[i];
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

