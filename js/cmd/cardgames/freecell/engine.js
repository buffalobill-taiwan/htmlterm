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

// Bold reverse construction with mixed one-, two- and three-card middle chains.
// Each of the four 7-card Ace columns holds a 2- to 4-card base, the Ace, one to
// three middle cards, and a lock card. Each paired 6-card normal column holds
// five ordinary cards and a destination. For chain length L, the middle ranks
// alternate r, r-1, ... and the base size is 5-L. The top middle fits the
// destination (opposite colour, one rank higher), and each lower middle fits the
// one above it. The four lock cards use seed-fixed rank patterns from 7, 9, 11
// and 13, with one or two kings; every pair differs by at least two ranks, so no
// lock card can be placed on the tableau or on another lock. The opening forces
// four lock-to-cell moves before any middle can be reached. Ordinary cards fill
// the bases and five-card normal tops with a random spread of ranks, which keeps
// the columns irregular while rank-by-rank collection stays legal. The
// certificate is built and replayed, never searched.
const ATTEMPTS = 16;
const CHAIN_PATTERNS = [
    [3, 2, 1, 1],
    [3, 1, 1, 1],
    [3, 2, 2, 1],
    [3, 3, 1, 1],
    [3, 3, 2, 1],
    [3, 2, 2, 2],
];
const LOCK_PATTERNS = [
    [7, 9, 11, 13],
    [7, 11, 13, 13],
    [9, 11, 13, 13],
    [7, 9, 13, 13],
];
const descending = (a, b) => rank(b) - rank(a) || a - b;
const suitsOfColor = c => c === 0 ? [0, 3] : [1, 2];
const cardOf = (s, r) => s * 13 + r - 1;
function shuffleInPlace(cards, rng) {
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

// Read-only structural description used to rank deterministic candidates.
// It is a heuristic, not a solver or a proof that a deal needs a given move.
export function difficulty(board) {
    let blockers = 0, sameSuitHard = 0, buriedLow = 0, builtPairs = 0, nearPairs = 0;
    for (const col of board.columns) {
        for (let i = 0; i < col.length; i++) {
            if (rank(col[i]) <= 3) buriedLow += col.length - i - 1;
            for (let j = i + 1; j < col.length; j++) {
                if (rank(col[j]) > rank(col[i])) blockers++;
                if (suit(col[i]) === suit(col[j]) && rank(col[j]) > rank(col[i])) sameSuitHard++;
                if (nearRank(col[i], col[j])) nearPairs++;
            }
            if (i && fits(col[i], col[i - 1])) builtPairs++;
        }
    }
    return { blockers, sameSuitHard, buriedLow, builtPairs, nearPairs,
        score: blockers * 6 + sameSuitHard * 10 + buriedLow * 5 - builtPairs * 12 - nearPairs };
}

function construct(seed, chainPattern, lockPattern) {
    const rng = mulberry32(seed);
    const lengths = shuffleInPlace([...(chainPattern || CHAIN_PATTERNS[seed % CHAIN_PATTERNS.length])], rng);
    const lockRanks = lockPattern || LOCK_PATTERNS[(seed >>> 4) % LOCK_PATTERNS.length];
    const used = new Set();
    const lockCards = [];
    for (const r of lockRanks) {
        const candidates = [0, 1, 2, 3].map(s => cardOf(s, r)).filter(c => !used.has(c));
        const c = candidates[Math.floor(rng() * candidates.length)];
        used.add(c);
        lockCards.push(c);
    }
    shuffleInPlace(lockCards, rng);
    const lockSet = new Set(lockCards);

    const available = new Set();
    for (let c = 0; c < 52; c++) {
        const r = rank(c);
        if (r === 1 || lockSet.has(c)) continue;
        available.add(c);
    }

    const chains = lengths.map((length, i) => ({ length, aceColumn: i, normalColumn: 4 + i }));
    shuffleInPlace(chains, rng);

    const destinationRanks = [];
    for (const chain of chains) {
        let picked = null;
        const ranks = [];
        for (let r = chain.length + 1; r <= 6; r++) ranks.push(r);
        shuffleInPlace(ranks, rng);
        for (const r of ranks) {
            // Never let all four normal columns share one bottom rank.
            if (destinationRanks.length === 3 && destinationRanks.every(x => x === r + 1)) continue;
            const colors = shuffleInPlace([0, 1], rng);
            for (const destinationColor of colors) {
                const middleColor = destinationColor === 0 ? 1 : 0;
                const destinations = shuffleInPlace([...suitsOfColor(destinationColor)], rng);
                const middles = shuffleInPlace([...suitsOfColor(middleColor)], rng);
                const seconds = chain.length >= 2 ? shuffleInPlace([...suitsOfColor(destinationColor)], rng) : [];
                const thirds = chain.length >= 3 ? shuffleInPlace([...suitsOfColor(middleColor)], rng) : [];
                for (const ds of destinations) {
                    const destination = cardOf(ds, r + 1);
                    if (!available.has(destination)) continue;
                    for (const ms of middles) {
                        const top = cardOf(ms, r);
                        if (!available.has(top)) continue;
                        if (chain.length === 1) { picked = { r, destination, top, second: null, third: null }; break; }
                        for (const ss of seconds) {
                            const second = cardOf(ss, r - 1);
                            if (!available.has(second)) continue;
                            if (chain.length === 2) { picked = { r, destination, top, second, third: null }; break; }
                            for (const ts of thirds) {
                                const third = cardOf(ts, r - 2);
                                if (!available.has(third)) continue;
                                picked = { r, destination, top, second, third };
                                break;
                            }
                            if (picked) break;
                        }
                        if (picked) break;
                    }
                    if (picked) break;
                }
                if (picked) break;
            }
            if (picked) break;
        }
        if (!picked) return null;
        available.delete(picked.destination);
        available.delete(picked.top);
        if (picked.second !== null) available.delete(picked.second);
        if (picked.third !== null) available.delete(picked.third);
        destinationRanks.push(picked.r + 1);
        Object.assign(chain, picked);
    }

    // Fill each normal top with five distinct ranks above its destination. A
    // random spread keeps the columns from looking like contiguous run-outs.
    const normalGroups = new Map();
    const ordered = [...chains].sort((a, b) => rank(b.destination) - rank(a.destination));
    for (const chain of ordered) {
        const eligible = [...available].filter(c => rank(c) > rank(chain.destination));
        const byRank = new Map();
        for (const c of eligible) {
            const r = rank(c);
            if (!byRank.has(r)) byRank.set(r, []);
            byRank.get(r).push(c);
        }
        const ranks = [...byRank.keys()];
        if (ranks.length < 5) return null;
        shuffleInPlace(ranks, rng);
        const group = [];
        for (const r of ranks.slice(0, 5)) {
            const bucket = byRank.get(r);
            shuffleInPlace(bucket, rng);
            group.push(bucket[0]);
        }
        for (const c of group) available.delete(c);
        normalGroups.set(chain.normalColumn, group.sort(descending));
    }

    const remaining = [...available];
    const extra = chains.reduce((n, chain) => n + chain.length - 1, 0);
    if (remaining.length !== 16 - extra) return null;
    shuffleInPlace(remaining, rng);
    const baseGroups = new Map();
    const chainByAce = new Map(chains.map(chain => [chain.aceColumn, chain]));
    let cursor = 0;
    for (let i = 0; i < 4; i++) {
        const size = 5 - chainByAce.get(i).length;
        baseGroups.set(i, remaining.slice(cursor, cursor + size).sort(descending));
        cursor += size;
    }

    const aces = shuffleInPlace([0, 13, 26, 39], rng);
    const columns = Array.from({ length: 8 }, () => []);
    for (let i = 0; i < 4; i++) {
        const chain = chainByAce.get(i);
        const middles = [];
        if (chain.third !== null) middles.push(chain.third);
        if (chain.second !== null) middles.push(chain.second);
        middles.push(chain.top);
        columns[i] = [...baseGroups.get(i), aces[i], ...middles, lockCards[i]];
    }
    for (const chain of chains) {
        columns[chain.normalColumn] = [...normalGroups.get(chain.normalColumn), chain.destination];
    }
    const board = { columns, cells: [null, null, null, null], foundations: [0, 0, 0, 0] };

    try {
        const state = clone(board);
        const solution = [];
        const push = move => { applyMove(state, move); solution.push(move); };
        for (let i = 0; i < 4; i++) {
            push({ from: { zone: 'column', index: i }, to: { zone: 'cell', index: i } });
        }
        for (const chain of chains) {
            push({ from: { zone: 'column', index: chain.aceColumn }, to: { zone: 'column', index: chain.normalColumn } });
            if (chain.second !== null) {
                push({ from: { zone: 'column', index: chain.aceColumn }, to: { zone: 'column', index: chain.normalColumn } });
            }
            if (chain.third !== null) {
                push({ from: { zone: 'column', index: chain.aceColumn }, to: { zone: 'column', index: chain.normalColumn } });
            }
        }
        for (let i = 0; i < 4; i++) {
            push({ from: { zone: 'column', index: i }, to: { zone: 'foundation', index: suit(aces[i]) } });
        }
        for (let r = 2; r <= 13; r++) {
            // Free a lock card before the same rank's column cards can need the
            // next rank of that suit.
            for (let i = 0; i < 4; i++) {
                const card = state.cells[i];
                if (card !== null && rank(card) === r) {
                    push({ from: { zone: 'cell', index: i }, to: { zone: 'foundation', index: suit(card) } });
                }
            }
            let progress = true;
            while (progress) {
                progress = false;
                for (let column = 0; column < 8; column++) {
                    const card = state.columns[column].at(-1);
                    if (card !== undefined && rank(card) === r) {
                        push({ from: { zone: 'column', index: column }, to: { zone: 'foundation', index: suit(card) } });
                        progress = true;
                    }
                }
            }
        }
        if (!solved(state)) return null;
        verify(board, solution);
        return { board, solution, chains, lockCards, extra };
    } catch {
        return null;
    }
}

function candidateSeed(seed, attempt) {
    return (seed ^ Math.imul(attempt + 1, 0x9e3779b1)) >>> 0;
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

export function generate(seed) {
    const parsed = parseSeed(seed);
    if (parsed === null) throw Error('Invalid seed');
    const chainPattern = CHAIN_PATTERNS[parsed % CHAIN_PATTERNS.length];
    const lockPattern = LOCK_PATTERNS[(parsed >>> 4) % LOCK_PATTERNS.length];
    let best = null, valid = 0;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const candidate = construct(candidateSeed(seed, attempt), chainPattern, lockPattern);
        if (!candidate) continue;
        valid++;
        const score = difficulty(candidate.board).score;
        if (!best || score > best.score) best = { ...candidate, score, attempt };
    }
    // Structural fallback. Selection never rejects a valid candidate on quality.
    if (!best) {
        const candidate = construct(seed, chainPattern, lockPattern);
        if (!candidate) throw Error('Bold construction failed');
        best = { ...candidate, score: difficulty(candidate.board).score, attempt: ATTEMPTS };
    }
    const solution = best.solution;
    const boardMetrics = metrics(best.board);
    if (boardMetrics.automaticCards !== 0) throw Error('Bold construction exposed a safe card');
    verify(best.board, solution);
    const lockRanks = best.lockCards.map(rank).sort((a, b) => a - b);
    const middleCounts = [1, 2, 3].map(n => best.chains.filter(chain => chain.length === n).length);
    return { version: 8, seed, board: best.board, solution,
        selection: { attempts: ATTEMPTS, valid, chosen: best.attempt, score: best.score,
            effectiveMoves: solution.length - 52,
            middleColumns: { 1: middleCounts[0], 2: middleCounts[1], 3: middleCounts[2] },
            extraMiddleCards: best.extra, lockCards: [...best.lockCards].sort((a, b) => a - b),
            lockRanks,
            peakColumnLength: Math.max(...best.board.columns.map(col => col.length)) },
        metrics: boardMetrics, construction: constructionMetrics(best.board, solution), verified: true };
}

export { suit, rank, fits, clone, solved, auto };
