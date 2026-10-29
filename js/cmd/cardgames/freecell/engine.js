import { mulberry32, parseSeed } from '../../../util/random.js';

const LIMITS = [7, 7, 7, 7, 6, 6, 6, 6];
const suit = c => Math.floor(c / 13);
const rank = c => c % 13 + 1;
const nearRank = (a, b) => Math.abs(rank(a) - rank(b)) <= 2;
const color = c => [0, 1, 1, 0][suit(c)];
const fits = (c, below) => below === undefined || (rank(below) === rank(c) + 1 && color(c) !== color(below));
const clone = s => ({ columns: s.columns.map(c => [...c]), cells: [...s.cells], foundations: [...s.foundations] });
const solved = s => s.foundations.every(n => n === 13);
function pile(s, ref) { return ref.zone === 'column' ? s.columns[ref.index] : null; }

export function validate(s, initial = false) {
    if (!s || s.columns?.length !== 8 || s.cells?.length !== 4 || s.foundations?.length !== 4) throw Error('Invalid board shape');
    const cards = [];
    s.columns.forEach((col, i) => {
        if (!Array.isArray(col) || (initial && col.length !== LIMITS[i])) throw Error('Invalid column length');
        cards.push(...col);
    });
    s.cells.forEach(c => { if (c !== null) cards.push(c); });
    s.foundations.forEach((n, i) => {
        if (!Number.isInteger(n) || n < 0 || n > 13) throw Error('Invalid foundation');
        for (let r = 0; r < n; r++) cards.push(i * 13 + r);
    });
    if (cards.length !== 52 || new Set(cards).size !== 52 || cards.some(c => !Number.isInteger(c) || c < 0 || c > 51)) throw Error('Cards must be unique and complete');
    if (initial && (s.cells.some(c => c !== null) || s.foundations.some(Boolean))) throw Error('Initial cells/foundations must be empty');
}

// Independent forward interpreter: certificates consist exclusively of single-card moves.
export function applyMove(s, move) {
    const { from, to } = move;
    for (const ref of [from, to]) {
        if (!ref || !['column', 'cell', 'foundation'].includes(ref.zone) || !Number.isInteger(ref.index) || ref.index < 0 || ref.index >= (ref.zone === 'column' ? 8 : 4)) throw Error('Invalid location');
    }
    if (from.zone === 'foundation' || (from.zone === to.zone && from.index === to.index)) throw Error('Invalid source');
    const src = pile(s, from);
    const c = src ? src.at(-1) : s.cells[from.index];
    if (c === null || c === undefined) throw Error('Empty source');
    const dst = pile(s, to);
    if (dst && !fits(c, dst.at(-1))) throw Error('Invalid tableau move');
    if (to.zone === 'cell' && s.cells[to.index] !== null) throw Error('Occupied cell');
    if (to.zone === 'foundation' && (suit(c) !== to.index || rank(c) !== s.foundations[to.index] + 1)) throw Error('Invalid foundation move');
    if (src) src.pop(); else s.cells[from.index] = null;
    if (dst) dst.push(c);
    else if (to.zone === 'cell') s.cells[to.index] = c;
    else s.foundations[to.index]++;
    return s;
}
export function verify(board, solution) {
    validate(board, true);
    const state = clone(board);
    for (let i = 0; i < solution.length; i++) {
        try { applyMove(state, solution[i]); validate(state); }
        catch (e) { throw Error(`Move ${i + 1}: ${e.message}`); }
    }
    if (!solved(state)) throw Error('Certificate does not solve board');
    return true;
}

function safe(s, c) {
    if (rank(c) !== s.foundations[suit(c)] + 1) return false;
    return rank(c) <= 2 || s.foundations.every((n, i) => color(i * 13) === color(c) || n >= rank(c) - 1);
}
function auto(s, moves = []) {
    let changed;
    do {
        changed = false;
        for (const zone of ['column', 'cell']) for (let i = 0; i < (zone === 'column' ? 8 : 4); i++) {
            const c = zone === 'column' ? s.columns[i].at(-1) : s.cells[i];
            if (c == null || !safe(s, c)) continue;
            const move = { from: { zone, index: i }, to: { zone: 'foundation', index: suit(c) } };
            applyMove(s, move); moves.push(move); changed = true;
        }
    } while (changed);
    return moves;
}
export function metrics(board) {
    let buriedLow = 0, blockers = 0, builtPairs = 0, sameSuitPairs = 0, closePairs = 0;
    let rankSpan = 0;
    for (const col of board.columns) if (col.length) {
        const ranks = col.map(rank);
        rankSpan += Math.max(...ranks) - Math.min(...ranks);
    }
    for (const col of board.columns) for (let i = 0; i < col.length; i++) {
        if (rank(col[i]) <= 3) buriedLow += col.length - i - 1;
        for (let j = i + 1; j < col.length; j++) if (rank(col[j]) > rank(col[i])) blockers++;
        if (i && fits(col[i], col[i - 1])) builtPairs++;
        if (i && suit(col[i]) === suit(col[i - 1])) sameSuitPairs++;
        if (i && nearRank(col[i], col[i - 1])) closePairs++;
    }
    const state = clone(board); auto(state);
    const automaticCards = state.foundations.reduce((a, b) => a + b, 0);
    return { buriedLow, blockers, builtPairs, sameSuitPairs, automaticCards, closePairs, rankSpan,
        score: buriedLow * 3 + blockers * 2 + rankSpan * 5 - builtPairs * 2 - automaticCards * 4 - sameSuitPairs * 3 - closePairs * 2 };
}

function candidate(rng) {
    const state = { columns: Array.from({ length: 8 }, () => []), cells: Array(4).fill(null), foundations: Array(4).fill(13) };
    const reverse = [];
    // Unequal suit rates break the synchronized K-to-A layers. Weight by the
    // remaining cards as well, so one slow suit need not dominate the tail.
    const weights = Array.from({ length: 4 }, () => 0.1 + rng() ** 2);
    // Hold reserve cards across later foundation extractions, rather than
    // immediately returning them. Their forward inverses create parked blockers.
    const heldUntil = [0, 0, 0, 0];
    const reserved = Math.floor(rng() * 8);
    const choose = xs => xs[Math.floor(rng() * xs.length)];
    // Locations are immutable. Reuse them and the scratch lists across all
    // reverse steps instead of allocating every possible move at each step.
    const columns = Array.from({ length: 8 }, (_, index) => ({ zone: 'column', index }));
    const cells = Array.from({ length: 4 }, (_, index) => ({ zone: 'cell', index }));
    const sources = [], destinations = [], pairs = [], suits = [], slots = [];
    // Every reverse move removes an exposed card from a location where its
    // forward return would be legal. Extraction has a quota, guaranteeing termination.
    for (let dealt = 0; dealt < 52; dealt++) {
        for (let step = 0; step < 24; step++) {
            sources.length = 0; destinations.length = 0; pairs.length = 0;
            for (let i = 0; i < 8; i++) {
                const col = state.columns[i];
                if (col.length && fits(col.at(-1), col.at(-2))) sources.push(columns[i]);
                // Keep one column available for late reverse staging. The other
                // seven have room for at least 45 cards, so 36 cannot fill them.
                if (col.length < LIMITS[i] && (i !== reserved || dealt >= 36)) destinations.push(columns[i]);
            }
            for (let i = 0; i < 4; i++) if (state.cells[i] !== null && dealt >= heldUntil[i]) sources.push(cells[i]);
            const emptyCell = state.cells.indexOf(null);
            if (emptyCell >= 0) destinations.push(cells[emptyCell]);
            for (const from of sources) for (const to of destinations) {
                if (from === to || (from.zone === 'cell' && to.zone === 'cell')) continue;
                // Moving a lone card to an empty column only renames its slot.
                if (from.zone === 'column' && to.zone === 'column' && state.columns[from.index].length === 1 && !state.columns[to.index].length) continue;
                pairs.push(from, to);
            }
            if (!pairs.length) break;
            const offset = Math.floor(rng() * (pairs.length / 2)) * 2;
            const from = pairs[offset], to = pairs[offset + 1];
            const card = from.zone === 'column' ? state.columns[from.index].pop() : state.cells[from.index];
            if (from.zone === 'cell') state.cells[from.index] = null;
            if (to.zone === 'column') state.columns[to.index].push(card);
            else {
                state.cells[to.index] = card;
                heldUntil[to.index] = dealt + 3 + Math.floor(rng() * 12);
            }
            reverse.push({ from: to, to: from });
        }
        suits.length = 0; slots.length = 0;
        for (let i = 0; i < 4; i++) if (state.foundations[i]) suits.push(i);
        let pick = rng() * suits.reduce((sum, i) => sum + weights[i] * state.foundations[i], 0);
        const su = suits.find(i => (pick -= weights[i] * state.foundations[i]) < 0) ?? suits.at(-1);
        const c = su * 13 + state.foundations[su] - 1;
        for (let i = 0; i < 8; i++) if (state.columns[i].length < LIMITS[i] && (i !== reserved || dealt >= 36)) slots.push(i);
        const emptyCell = state.cells.indexOf(null);
        if (emptyCell >= 0 && rng() < 0.8) {
            // Inverse: legally collect this reserve card onto its foundation.
            state.cells[emptyCell] = c;
            heldUntil[emptyCell] = dealt + 3 + Math.floor(rng() * 12);
            reverse.push({ from: cells[emptyCell], to: { zone: 'foundation', index: su } });
        } else {
            const target = choose(slots);
            state.columns[target].push(c);
            reverse.push({ from: columns[target], to: { zone: 'foundation', index: su } });
        }
        state.foundations[su]--;
    }
    // Restore the standard start shape. The forward inverse parks these cards
    // in empty free cells; each cell is used exactly once during this flush.
    for (let i = 0; i < 4; i++) if (state.cells[i] !== null) {
        slots.length = 0;
        for (let j = 0; j < 8; j++) if (state.columns[j].length < LIMITS[j]) slots.push(j);
        const target = choose(slots);
        state.columns[target].push(state.cells[i]); state.cells[i] = null;
        reverse.push({ from: { zone: 'column', index: target }, to: { zone: 'cell', index: i } });
    }
    return { board: state, solution: reverse.reverse() };
}

// Erase exact state loops, so random wandering cannot inflate certificate length.
function shorten(board, moves) {
    const state = clone(board), path = [], keys = [JSON.stringify(state)];
    const seen = new Map([[keys[0], 0]]);
    for (const move of moves) {
        applyMove(state, move);
        const key = JSON.stringify(state), previous = seen.get(key);
        if (previous !== undefined) {
            while (keys.length > previous + 1) seen.delete(keys.pop());
            path.length = previous;
        } else { path.push(move); seen.set(key, path.length); keys.push(key); }
    }
    return path;
}
// Describe this certificate, not the minimum resources required by all solutions.
// Count distinct cards/columns so repeated detours cannot inflate the score.
export function constructionMetrics(board, solution) {
    const state = clone(board), parked = new Set(), released = new Set(), staging = new Set();
    let peakOccupiedCells = 0;
    for (const move of solution) {
        const { from, to } = move;
        const c = from.zone === 'column' ? state.columns[from.index].at(-1) : state.cells[from.index];
        if (to.zone === 'cell' && rank(c) > state.foundations[suit(c)] + 1) parked.add(c);
        if (from.zone === 'cell' && to.zone === 'column' && parked.has(c)) released.add(c);
        if (to.zone === 'column' && !state.columns[to.index].length &&
            state.foundations.reduce((a, b) => a + b, 0) < 26) staging.add(to.index);
        applyMove(state, move);
        peakOccupiedCells = Math.max(peakOccupiedCells, state.cells.filter(c => c !== null).length);
    }
    return { parkedCards: parked.size, releasedCards: released.size,
        earlyEmptyColumns: staging.size, peakOccupiedCells };
}

export function generate(seed, candidates = 64) {
    if (parseSeed(seed) === null || !Number.isInteger(candidates) || candidates < 1 || candidates > 4096) throw Error('Invalid seed/candidate count');
    const rng = mulberry32(seed);
    const pool = [];
    for (let i = 0; i < candidates; i++) {
        const result = candidate(rng); result.metrics = metrics(result.board);
        if (result.metrics.automaticCards > 8 || result.metrics.buriedLow < 24 || result.metrics.blockers < 40) continue;
        pool.push(result);
        // Only these eight need certificate analysis. Stable sorting keeps
        // earlier candidates first on ties.
        pool.sort((a,b) => b.metrics.score - a.metrics.score);
        if (pool.length > 8) pool.pop();
    }
    if (!pool.length) throw Error('No candidate passed the structural quality screen; increase --candidates');
    let best, bestScore = -Infinity;
    for (const result of pool) {
        result.solution = shorten(result.board, result.solution);
        const usage = result.construction = constructionMetrics(result.board, result.solution);
        const score = result.metrics.score + usage.parkedCards * 4 + usage.releasedCards * 3 +
            usage.earlyEmptyColumns * 3 + usage.peakOccupiedCells * 8;
        if (score > bestScore) { best = result; bestScore = score; }
    }
    verify(best.board, best.solution);
    return { version: 3, seed, candidates, ...best, verified: true };
}

// A separate, bounded forward search. Budget exhaustion is UNKNOWN, not UNSOLVABLE.
export function solve(board, maxNodes = 100000) {
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000000) throw Error('Invalid node budget');
    validate(board);
    const seen = new Set(); let nodes = 0, exhausted = false;
    function visit(input, path) {
        if (++nodes > maxNodes) { exhausted = true; return null; }
        const s = clone(input); const automatic = []; auto(s, automatic); path = [...path, ...automatic];
        if (solved(s)) return path;
        const key = JSON.stringify([s.foundations, s.cells.filter(c => c !== null).sort((a,b)=>a-b), s.columns.map(c=>c.join(',')).sort()]);
        if (seen.has(key)) return null; seen.add(key);
        const sources = [];
        for (let i = 0; i < 8; i++) if (s.columns[i].length) sources.push({ zone: 'column', index: i });
        for (let i = 0; i < 4; i++) if (s.cells[i] !== null) sources.push({ zone: 'cell', index: i });
        const options = [];
        for (const from of sources) {
            const c = from.zone === 'column' ? s.columns[from.index].at(-1) : s.cells[from.index];
            if (rank(c) === s.foundations[suit(c)] + 1) options.push({ from, to: { zone: 'foundation', index: suit(c) } });
            let empty = false;
            for (let i = 0; i < 8; i++) {
                if (from.zone === 'column' && from.index === i) continue;
                if (!s.columns[i].length) {
                    if (empty || (from.zone === 'column' && s.columns[from.index].length === 1)) continue;
                    empty = true;
                }
                if (fits(c, s.columns[i].at(-1))) options.push({ from, to: { zone: 'column', index: i } });
            }
            const cell = s.cells.indexOf(null);
            if (from.zone === 'column' && cell >= 0) options.push({ from, to: { zone: 'cell', index: cell } });
        }
        // Bound recursion separately from total work to avoid a JS stack overflow.
        if (path.length > 400) { exhausted = true; return null; }
        for (const move of options) {
            const next = clone(s); applyMove(next, move);
            const result = visit(next, [...path, move]);
            if (result) return result;
            if (nodes > maxNodes) break;
        }
        return null;
    }
    const solution = visit(board, []);
    if (solution) {
        const replay = clone(board);
        for (const move of solution) { applyMove(replay, move); validate(replay); }
        if (!solved(replay)) throw Error('Independent search replay failed');
    }
    return { status: solution ? 'solved' : exhausted ? 'unknown' : 'unsolvable', nodes, solution };
}


export { suit, rank, fits, clone, solved, auto };
