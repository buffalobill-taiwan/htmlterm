import { createDeck } from '../deck.js';

const isCombatant = card => card && (card.rank === 1 || card.rank >= 11);
const valueOf = rank => rank === 1 ? 14 : rank;
const isSafeCost = card => card.rank === 0 || (card.rank >= 2 && card.rank <= 10);
const isPersonalCard = card => card && (card.rank === 0 || (card.rank >= 2 && card.rank <= 4));

function shuffle(cards, random) {
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

export function createGame(random = Math.random) {
    const allCards = [...createDeck(), { suit: -1, rank: 0 }, { suit: -1, rank: 0 }];
    const personalDeck = shuffle(allCards.filter(card => card.rank === 0 || (card.rank >= 2 && card.rank <= 4)), random);
    const enemyDeck = shuffle(allCards.filter(card => card.rank === 1 || card.rank >= 5), random);
    return {
        round: 0,
        personalDeck,
        personalDiscard: [],
        hand: [],
        enemyDeck,
        enemyRow: Array(4).fill(null),
        enemyCapture: [],
    };
}

export function dealInitialEnemyRow(state) {
    const dealt = [];
    for (let index = 0; index < state.enemyRow.length && state.enemyDeck.length; index++) {
        const card = state.enemyDeck.pop();
        state.enemyRow[index] = card;
        dealt.push({ card, index });
    }
    return dealt;
}

export function returnInitialCombatants(state) {
    const returned = [];
    for (let index = 0; index < state.enemyRow.length; index++) {
        const card = state.enemyRow[index];
        if (!isCombatant(card)) continue;
        returned.push({ card, index });
        state.enemyRow[index] = null;
    }
    state.enemyDeck.unshift(...returned.map(move => move.card));
    return returned;
}

export function compactEnemyRow(state) {
    // Index 0 is Position 1; survivors shift toward it, then draws fill from Position 4.
    const surviving = state.enemyRow
        .map((card, fromIndex) => card ? { card, fromIndex } : null)
        .filter(Boolean);
    state.enemyRow = Array(4).fill(null);
    const moves = [];
    surviving.forEach(({ card, fromIndex }, toIndex) => {
        state.enemyRow[toIndex] = card;
        if (fromIndex !== toIndex) moves.push({ card, fromIndex, toIndex });
    });
    return moves;
}

export function refillEnemyRow(state) {
    const arrivals = [];
    for (let index = 3; index >= 0 && state.enemyDeck.length; index--) {
        if (state.enemyRow[index]) continue;
        const card = state.enemyDeck.pop();
        state.enemyRow[index] = card;
        arrivals.push({ card, index });
    }
    return arrivals;
}

export function beginRound(state) {
    state.round++;
    const moves = compactEnemyRow(state);
    const arrivals = refillEnemyRow(state);
    return { moves, arrivals };
}

export function discardFromHand(state, indices) {
    const selected = new Set(indices);
    if (selected.size !== indices.length ||
        [...selected].some(index => !Number.isInteger(index) || index < 0 || index >= state.hand.length)) return false;
    const kept = [];
    for (let i = 0; i < state.hand.length; i++) {
        if (selected.has(i)) state.personalDiscard.push(state.hand[i]);
        else kept.push(state.hand[i]);
    }
    state.hand = kept;
    return true;
}

export function drawToFour(state, random = Math.random) {
    const recycled = [];
    const drawn = [];
    let recycledDeck = null;
    while (state.hand.length < 4) {
        if (!state.personalDeck.length) {
            if (!state.personalDiscard.length) break;
            state.personalDeck = shuffle(state.personalDiscard.splice(0), random);
            recycledDeck = state.personalDeck.slice();
            recycled.push(...recycledDeck);
        }
        const card = state.personalDeck.pop();
        state.hand.push(card);
        drawn.push(card);
    }
    return { recycled, recycledDeck, drawn };
}

export function captureValue(state, indices, target) {
    if (!target || !Array.isArray(indices) || !indices.length) return null;
    const selected = new Set(indices);
    if (selected.size !== indices.length ||
        [...selected].some(index => !Number.isInteger(index) || index < 0 || index >= state.hand.length)) return null;

    let total = 0;
    for (const index of selected) {
        const card = state.hand[index];
        if (card.rank === 0) {
            const copyValue = Math.max(0, ...state.hand
                .filter((other, otherIndex) => otherIndex !== index && other.rank !== 0 && other.suit === target.suit)
                .map(other => valueOf(other.rank)));
            if (!copyValue) return null;
            total += copyValue;
        } else {
            if (card.suit !== target.suit) return null;
            total += valueOf(card.rank);
        }
    }
    return total;
}

export function capture(state, rowIndex, handIndices) {
    const target = state.enemyRow[rowIndex];
    if (!target) return false;
    const value = captureValue(state, handIndices, target);
    if (value === null || value < valueOf(target.rank)) return false;

    const spent = new Set(handIndices);
    state.personalDiscard.push(target);
    for (let i = 0; i < state.hand.length; i++) {
        if (spent.has(i)) state.personalDiscard.push(state.hand[i]);
    }
    state.hand = state.hand.filter((_, index) => !spent.has(index));
    state.enemyRow[rowIndex] = null;
    return true;
}

export function yieldToEnemy(state, handIndex) {
    const target = state.enemyRow[0];
    if (!target || !Number.isInteger(handIndex) || handIndex < 0 || handIndex >= state.hand.length) return false;
    state.enemyCapture.push(target, state.hand[handIndex]);
    state.enemyRow[0] = null;
    state.hand.splice(handIndex, 1);
    return true;
}

export function sacrifice(state, rowIndex, handIndices) {
    const target = state.enemyRow[rowIndex];
    const selected = new Set(handIndices);
    if (!target || selected.size !== 2 || selected.size !== handIndices.length ||
        [...selected].some(index => !Number.isInteger(index) || index < 0 || index >= state.hand.length ||
            !isSafeCost(state.hand[index]))) return false;

    for (let i = 0; i < state.hand.length; i++) {
        if (selected.has(i)) state.enemyCapture.push(state.hand[i]);
    }
    state.hand = state.hand.filter((_, index) => !selected.has(index));
    state.enemyDeck.unshift(target);
    state.enemyRow[rowIndex] = null;
    return true;
}

export function actionAvailability(state) {
    let captureAvailable = false;
    for (let rowIndex = 0; rowIndex < state.enemyRow.length && !captureAvailable; rowIndex++) {
        const target = state.enemyRow[rowIndex];
        if (!target) continue;
        for (let mask = 1; mask < (1 << state.hand.length); mask++) {
            const indices = [];
            for (let i = 0; i < state.hand.length; i++) if (mask & (1 << i)) indices.push(i);
            const value = captureValue(state, indices, target);
            if (value !== null && value >= valueOf(target.rank)) {
                captureAvailable = true;
                break;
            }
        }
    }

    return {
        capture: captureAvailable,
        sacrifice: state.hand.filter(isSafeCost).length >= 2 && state.enemyRow.some(Boolean),
        yield: !!state.enemyRow[0] && !isCombatant(state.enemyRow[0]) &&
            state.hand.some(card => !isCombatant(card)),
    };
}

export function outcome(state) {
    if (state.enemyCapture.some(isCombatant)) return 'loss';
    if (!state.enemyDeck.length && state.enemyRow.every(card => !card)) return 'win';
    return null;
}

export function hasSafeAction(state) {
    return Object.values(actionAvailability(state)).some(Boolean);
}

export function playerCardZones(state) {
    return [
        { key: 'hand', cards: state.hand },
        { key: 'deck', cards: state.personalDeck },
        { key: 'discard', cards: state.personalDiscard },
        { key: 'enemyRemoval', cards: state.enemyCapture.filter(isPersonalCard) },
    ];
}
