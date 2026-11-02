import { parseSeed } from '../../../util/random.js';

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

// Describe this certificate, not the minimum resources required by all solutions.
// Count distinct cards/columns so repeated detours do not inflate resource usage.
export function constructionMetrics(board, solution) {
    const state = clone(board), parked = new Set(), released = new Set(), staging = new Set();
    let peakOccupiedCells = 0;
    for (const move of solution) {
        const { from, to } = move;
        const c = from.zone === 'column' ? state.columns[from.index].at(-1) : state.cells[from.index];
        if (to.zone === 'cell' && rank(c) > state.foundations[suit(c)] + 1) parked.add(c);
        if (from.zone === 'cell' && (to.zone === 'column' || to.zone === 'foundation') && parked.has(c)) released.add(c);
        if (to.zone === 'column' && !state.columns[to.index].length &&
            state.foundations.reduce((a, b) => a + b, 0) < 26) staging.add(to.index);
        applyMove(state, move);
        peakOccupiedCells = Math.max(peakOccupiedCells, state.cells.filter(c => c !== null).length);
    }
    return { parkedCards: parked.size, releasedCards: released.size,
        earlyEmptyColumns: staging.size, peakOccupiedCells };
}

// Microsoft C runtime RNG and rank-major clubs/diamonds/hearts/spades deck.
// Deal left to right, replacing each selected card with the last remaining card.
export function generate(seed) {
    const parsed = parseSeed(seed);
    if (parsed === null) throw Error('Invalid seed');
    let state = parsed;
    const deck = Array.from({ length: 52 }, (_, i) => [3, 2, 1, 0][i % 4] * 13 + Math.floor(i / 4));
    const board = { columns: Array.from({ length: 8 }, () => []),
        cells: [null, null, null, null], foundations: [0, 0, 0, 0] };
    for (let i = 0; i < 52; i++) {
        state = (Math.imul(state, 214013) + 2531011) >>> 0;
        const index = ((state >>> 16) & 0x7fff) % deck.length;
        board.columns[i % 8].push(deck[index]);
        deck[index] = deck[deck.length - 1];
        deck.pop();
    }
    validate(board, true);
    return { version: 9, generator: 'microsoft', seed: parsed, board, metrics: metrics(board) };
}

export { suit, rank, fits, clone, solved, auto };
