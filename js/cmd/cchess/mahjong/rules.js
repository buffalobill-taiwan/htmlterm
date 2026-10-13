// Local 32-piece chess mahjong: one meld and one pair, chi only.
export const WINDS = ['東', '南', '西', '北'];
export const TYPES = ['king', 'advisor', 'elephant', 'chariot', 'horse', 'cannon', 'soldier'];
export const SUPPLY = [1, 2, 2, 2, 2, 2, 5, 1, 2, 2, 2, 2, 2, 5];
export const SEQUENCES = [[0, 1, 2], [3, 4, 5], [7, 8, 9], [10, 11, 12]];
const MELDS = [...SEQUENCES, [6, 6, 6], [13, 13, 13]];
export const PAIRS = SUPPLY.flatMap((n, k) => n >= 2 ? [[k, k]] : []);
PAIRS.push([0, 7]);
export const COMPLETE_HANDS = MELDS.flatMap(meld => PAIRS.map(pair => [...meld, ...pair]))
    .filter(hand => SUPPLY.every((n, k) => hand.filter(t => t === k).length <= n))
    .map(hand => hand.sort((a, b) => a - b));

export function newDeck(random = Math.random) {
    const deck = SUPPLY.flatMap((count, kind) => Array.from({ length: count }, (_, copy) => ({
        id: kind * 5 + copy, kind, color: kind < 7 ? 'red' : 'black', type: TYPES[kind % 7],
    })));
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function sortHand(hand) { hand.sort((a, b) => a.kind - b.kind || a.id - b.id); }

export function isWinning(hand, melds = []) {
    if (melds.length > 1) return false;
    for (const meld of melds) {
        const kinds = meld.map(p => p.kind).sort((a, b) => a - b);
        if (kinds.length !== 3 || !SEQUENCES.some(s => s.every((k, i) => k === kinds[i]))) return false;
    }
    const targets = melds.length ? PAIRS : COMPLETE_HANDS;
    const kinds = hand.map(p => p.kind).sort((a, b) => a - b);
    return targets.some(t => t.length === kinds.length && t.every((k, i) => k === kinds[i]));
}

export function chiChoices(hand, melds, tile) {
    if (melds.length) return [];
    return SEQUENCES.filter(s => s.includes(tile.kind)).flatMap(s => {
        const needed = s.filter(k => k !== tile.kind).map(k => hand.find(p => p.kind === k));
        return needed.every(Boolean) ? [needed.map(p => p.id)] : [];
    });
}

export function createRound({ deck = newDeck(), dealer = 0, human = 0, scores = [0, 0, 0, 0], round = 1 } = {}) {
    const state = {
        wall: deck.slice(), players: Array.from({ length: 4 }, () => ({ hand: [], melds: [], discards: [] })),
        dealer, human, scores: scores.slice(), round, turn: dealer, phase: 'self', drawn: null,
        pending: null, responses: [], responseIndex: 0, result: null, last: '莊家先出牌',
        discards: [], // Shared pool in play order; references the per-seat discarded tiles.
    };
    for (let n = 0; n < 4; n++) for (let offset = 0; offset < 4; offset++) {
        state.players[(dealer + offset) % 4].hand.push(state.wall.shift());
    }
    for (const p of state.players) sortHand(p.hand);
    const extra = state.wall.shift();
    state.players[dealer].hand.push(extra);
    state.drawn = extra.id;
    return state;
}

export function actor(state) {
    return state.phase === 'response' ? state.responses[state.responseIndex].seat : state.turn;
}

export function legalActions(state) {
    if (state.phase === 'done') return [];
    const seat = actor(state), p = state.players[seat];
    if (state.phase === 'draw') return [{ type: 'draw' }];
    if (state.phase === 'self') return isWinning(p.hand, p.melds)
        ? [{ type: 'win' }, { type: 'pass' }] : [{ type: 'pass' }];
    if (state.phase === 'discard') return p.hand.map(tile => ({ type: 'discard', id: tile.id }));
    const response = state.responses[state.responseIndex];
    return [...response.actions, { type: 'pass' }];
}

function finish(state, winner = null, source = null) {
    const delta = [0, 0, 0, 0];
    if (winner !== null) {
        for (let seat = 0; seat < 4; seat++) {
            if (seat !== winner && (source === null || seat === source)) { delta[seat]--; delta[winner]++; }
        }
    }
    state.scores = state.scores.map((score, seat) => score + delta[seat]);
    state.result = { winner, source, delta,
        tile: winner === null ? null : source === null ? state.drawn : state.pending.tile.id,
        nextDealer: winner === null || winner === state.dealer ? state.dealer : (state.dealer + 1) % 4 };
    state.phase = 'done';
}

function advanceResponses(state) {
    if (state.responseIndex < state.responses.length) { state.phase = 'response'; return; }
    state.turn = (state.pending.seat + 1) % 4;
    state.pending = null;
    state.phase = 'draw';
}

// Validate at the boundary so UI and AI cannot commit stale/illegal actions.
export function applyAction(state, action) {
    const match = legalActions(state).find(a => a.type === action.type && a.id === action.id &&
        (a.ids || []).join(',') === (action.ids || []).join(','));
    if (!match) throw new Error('象棋麻將：非法動作');
    const seat = actor(state), p = state.players[seat];
    if (action.type === 'win') {
        finish(state, seat, state.phase === 'response' ? state.pending.seat : null);
    } else if (action.type === 'pass') {
        if (state.phase === 'self') state.phase = 'discard';
        else { state.responseIndex++; advanceResponses(state); }
    } else if (action.type === 'draw') {
        if (!state.wall.length) { finish(state); return; }
        sortHand(p.hand);
        const tile = state.wall.shift();
        p.hand.push(tile); state.drawn = tile.id;
        state.phase = 'self'; state.last = `${WINDS[seat]}家摸牌`;
    } else if (action.type === 'discard') {
        const tile = p.hand.splice(p.hand.findIndex(t => t.id === action.id), 1)[0];
        sortHand(p.hand);
        p.discards.push(tile); state.drawn = null;
        state.discards.push(tile);
        state.pending = { seat, tile };
        state.responses = []; state.responseIndex = 0;
        state.last = `${WINDS[seat]}家出牌`;
        for (let offset = 1; offset < 4; offset++) {
            const other = (seat + offset) % 4, player = state.players[other];
            if (isWinning([...player.hand, tile], player.melds)) {
                state.responses.push({ seat: other, actions: [{ type: 'win' }] });
            }
        }
        const next = (seat + 1) % 4, player = state.players[next];
        const choices = chiChoices(player.hand, player.melds, tile);
        if (choices.length) state.responses.push({ seat: next, actions: choices.map(ids => ({ type: 'chi', ids })) });
        advanceResponses(state);
    } else if (action.type === 'chi') {
        const { seat: source, tile } = state.pending;
        const meld = [...p.hand.filter(t => action.ids.includes(t.id)), tile];
        sortHand(meld); p.melds.push(meld);
        p.hand = p.hand.filter(t => !action.ids.includes(t.id));
        state.players[source].discards.pop();
        state.discards.pop();
        state.turn = seat; state.pending = null; state.responses = [];
        state.drawn = null; state.phase = 'discard';
        state.last = `${WINDS[seat]}家吃牌，請出牌`;
    }
}

// The AI receives this projection, never the wall or other concealed hands.
export function publicView(state, seat) {
    const p = state.players[seat];
    const known = [...p.hand];
    for (const player of state.players) known.push(...player.discards, ...player.melds.flat());
    const remaining = SUPPLY.slice();
    for (const tile of known) remaining[tile.kind]--;
    return { hand: p.hand.slice(), melds: p.melds.map(m => m.slice()), remaining,
        pending: state.pending?.tile ?? null };
}
