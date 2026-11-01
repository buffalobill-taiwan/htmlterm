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
// Undo one legal forward move. The reverse SOURCE tableau must allow the
// card to be put back; the reverse DESTINATION tableau may be any card.
// Foundation extractions and free-cell returns need no tableau source check.
export function applyReverseMove(s, { from, to }) {
    for (const ref of [from, to]) {
        if (!ref || !['column', 'cell', 'foundation'].includes(ref.zone) || !Number.isInteger(ref.index) || ref.index < 0 || ref.index >= (ref.zone === 'column' ? 8 : 4)) throw Error('Invalid location');
    }
    if (to.zone === 'foundation' || (from.zone === to.zone && from.index === to.index)) throw Error('Invalid reverse destination');
    const src = pile(s, from);
    const c = src ? src.at(-1) : from.zone === 'cell' ? s.cells[from.index] :
        s.foundations[from.index] ? from.index * 13 + s.foundations[from.index] - 1 : null;
    if (c == null) throw Error('Empty reverse source');
    if (src && !fits(c, src.at(-2))) throw Error('Cannot legally return card to reverse source');
    if (to.zone === 'cell' && s.cells[to.index] !== null) throw Error('Occupied cell');
    if (src) src.pop();
    else if (from.zone === 'cell') s.cells[from.index] = null;
    else s.foundations[from.index]--;
    if (to.zone === 'column') s.columns[to.index].push(c);
    else s.cells[to.index] = c;
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
    return { buriedLow, blockers, builtPairs, sameSuitPairs, automaticCards, closePairs, rankSpan };
}

// A fixed work budget, never a wall-clock cutoff or a required solution length.
const SHUFFLE_CHECKS = 100000;
const WALK_STEPS = 256;
const LOCATIONS = Array.from({ length: 16 }, (_, i) => Object.freeze({
    zone: i < 8 ? 'column' : i < 12 ? 'cell' : 'foundation', index: i < 8 ? i : i < 12 ? i - 8 : i - 12,
}));

// Ignore free-cell and tableau permutations: renaming slots is not more mixing.
function positionKey(s) {
    return s.foundations.join(',') + '|' + s.cells.filter(c => c !== null).sort((a, b) => a - b).join(',') +
        '|' + s.columns.map(col => col.join(',')).sort().join(';');
}
function transfer(s, from, to) {
    const c = from < 8 ? s.columns[from].pop() : s.cells[from - 8];
    if (from >= 8) s.cells[from - 8] = null;
    if (to < 8) s.columns[to].push(c); else s.cells[to - 8] = c;
}

class ReverseWalk {
    constructor(rng) {
        this.rng = rng;
        this.state = { columns: Array.from({ length: 8 }, () => []), cells: Array(4).fill(null), foundations: Array(4).fill(13) };
        this.trace = [];
        this.seen = new Set([positionKey(this.state)]);
        this.pairs = [];
        this.weights = [];
        this.stats = { transitionChecks: 0, reverseMoves: 0, peakColumnLength: 0 };
    }
    remember(move) {
        this.trace.push(move);
        this.seen.add(positionKey(this.state));
        this.stats.reverseMoves++;
        for (const col of this.state.columns) this.stats.peakColumnLength = Math.max(this.stats.peakColumnLength, col.length);
    }
    move(from, to) {
        applyReverseMove(this.state, { from: LOCATIONS[from], to: LOCATIONS[to] });
        this.remember({ from: LOCATIONS[to], to: LOCATIONS[from] });
    }
    step() {
        const s = this.state, pairs = this.pairs, weights = this.weights;
        pairs.length = 0; weights.length = 0;
        let total = 0;
        const emptyCell = s.cells.indexOf(null);
        for (let from = 0; from < 12; from++) {
            const col = from < 8 ? s.columns[from] : null;
            const card = col ? col.at(-1) : s.cells[from - 8];
            if (card == null || (col && !fits(card, col.at(-2)))) continue;
            for (let to = 0; to < 12; to++) {
                if (from === to) continue;
                if (to >= 8 && (from >= 8 || to !== emptyCell + 8)) continue;
                const dst = to < 8 ? s.columns[to] : null;
                if (col?.length === 1 && dst?.length === 0) continue;
                // Overflow is allowed only on a legal descending run. It can
                // always be peeled back into vacancies when closing the walk.
                if (dst && dst.length >= LIMITS[to] && !fits(card, dst.at(-1))) continue;
                // Keep reversible runs mobile longer before freezing new
                // arbitrary adjacencies. This weights moves, never whole deals.
                const weight = !dst ? 4 : fits(card, dst.at(-1)) ? 64 : 1;
                pairs.push(from, to); weights.push(weight); total += weight;
            }
        }
        // Weighted sampling without replacement; only checked successors consume
        // the global budget. Failed probes are undone without changing the trace.
        while (weights.length && this.stats.transitionChecks < SHUFFLE_CHECKS) {
            let pick = this.rng() * total, index = 0;
            while (index < weights.length - 1 && (pick -= weights[index]) >= 0) index++;
            const from = pairs[index * 2], to = pairs[index * 2 + 1];
            total -= weights[index];
            weights[index] = weights.at(-1); weights.pop();
            pairs[index * 2] = pairs.at(-2); pairs[index * 2 + 1] = pairs.at(-1); pairs.length -= 2;
            transfer(s, from, to);
            this.stats.transitionChecks++;
            const visited = this.seen.has(positionKey(s));
            transfer(s, to, from);
            if (visited) continue;
            this.move(from, to);
            return true;
        }
        return false;
    }
    // Overflow cards are removable by construction. Together with the free
    // cells, their count cannot exceed the remaining standard-layout vacancies.
    settle() {
        const s = this.state;
        for (let from = 0; from < 12; from++) {
            while (from < 8 ? s.columns[from].length > LIMITS[from] : s.cells[from - 8] !== null) {
                const slots = [];
                for (let i = 0; i < 8; i++) if (s.columns[i].length < LIMITS[i]) slots.push(i);
                if (!slots.length) throw Error('Reverse walk lost its closing vacancies');
                this.move(from, slots[Math.floor(this.rng() * slots.length)]);
            }
        }
    }
}

function construct(rng) {
    const walk = new ReverseWalk(rng), s = walk.state;
    const destinations = [], weights = [];
    for (let dealt = 0; dealt < 52; dealt++) {
        for (let step = 0; step < WALK_STEPS; step++) if (!walk.step()) break;
        const suits = [0, 1, 2, 3].filter(i => s.foundations[i]);
        const su = suits[Math.floor(rng() * suits.length)];
        const card = su * 13 + s.foundations[su] - 1;
        destinations.length = 0; weights.length = 0;
        let total = 0;
        for (let i = 0; i < 8; i++) {
            const col = s.columns[i], matches = fits(card, col.at(-1));
            // Do not freeze an unremovable card beyond the final column size.
            // Long reversible suffixes may persist across foundation extractions.
            if (col.length >= LIMITS[i] && !matches) continue;
            const weight = matches ? 64 : 1;
            destinations.push(i); weights.push(weight); total += weight;
        }
        const emptyCell = s.cells.indexOf(null);
        if (emptyCell >= 0) { destinations.push(emptyCell + 8); weights.push(4); total += 4; }
        let pick = rng() * total, index = 0;
        while (index < weights.length - 1 && (pick -= weights[index]) >= 0) index++;
        walk.move(su + 12, destinations[index]);
    }
    // Keep mixing after the last extraction; restore standard dimensions only
    // once, at the end. Overflow runs peel into the guaranteed vacant slots.
    for (let step = 0; step < WALK_STEPS; step++) if (!walk.step()) break;
    walk.settle();
    return { board: s, solution: walk.trace.reverse(), shuffle: walk.stats };
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
// Count distinct cards/columns so repeated detours do not inflate resource usage.
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

export function generate(seed) {
    if (parseSeed(seed) === null) throw Error('Invalid seed');
    const result = construct(mulberry32(seed));
    result.solution = shorten(result.board, result.solution);
    result.shuffle.effectiveMoves = result.solution.length - 52;
    verify(result.board, result.solution);
    return { version: 4, seed, ...result, metrics: metrics(result.board),
        construction: constructionMetrics(result.board, result.solution), verified: true };
}

export { suit, rank, fits, clone, solved, auto };
