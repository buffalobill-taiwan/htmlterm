// The Emissary (Isaludo, Wil Su) — pure rules.
//
// A standard 52-card deck without jokers is split into:
//   9s/10s  → eight kingdom slots (placeholders, not tracked as cards)
//   K/Q     → eight rulers, one per kingdom
//   J       → four advisors, reusable once per kingdom
//   A–8     → the 32-card debate deck
//
// Nothing here touches the DOM, so the seeded deal viewer and tests can import
// this module directly.

import { createDeck } from '../deck.js';
import { mulberry32, shuffle } from '../../../util/random.js';

export const KINGDOM_COUNT = 8;
export const HAND_SIZE = 8;
export const ADVISOR_COUNT = 4;

// Suit indexes follow deck.js: 0 ♠, 1 ♥, 2 ♦, 3 ♣.
export function abilityForSuit(suit) {
    if (suit === 1) return 'hearts';
    if (suit === 3) return 'clubs';
    if (suit === 0) return 'spades';
    return 'diamonds';
}

export function createGame(random = Math.random) {
    const cards = createDeck();
    const rulers = shuffle(cards.filter(card => card.rank >= 12), random);
    const advisors = cards.filter(card => card.rank === 11)
        .map(card => ({ card, used: false }));
    const deck = shuffle(cards.filter(card => card.rank <= 8), random);
    const game = {
        kingdoms: Array.from({ length: KINGDOM_COUNT }, (_, i) => ({
            slot: i + 1,
            ruler: rulers[i],
            visited: false,
            conquered: false,
        })),
        advisors,
        allies: [],
        hand: [],
        deck,
        discard: [],
        scoring: [],
        wins: 0,
        current: 0,
        topic: null,
        ended: false,
        result: null,
        score: 0,
    };
    drawCards(game, HAND_SIZE, random);
    return game;
}

export function createSeededGame(seed) {
    return createGame(mulberry32(seed));
}

export function drawOne(game, random = Math.random) {
    if (!game.deck.length) {
        if (!game.discard.length) return null;
        game.deck = shuffle(game.discard.splice(0), random);
    }
    return game.deck.pop() || null;
}

export function drawCards(game, count, random = Math.random) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
        const card = drawOne(game, random);
        if (!card) break;
        game.hand.push(card);
        drawn.push(card);
    }
    return drawn;
}

export function currentKingdom(game) {
    return game.current ? game.kingdoms[game.current - 1] : null;
}

export function requiredWins(game) {
    return currentKingdom(game)?.slot || 0;
}

export function trumpSuit(game) {
    return currentKingdom(game)?.ruler?.suit ?? null;
}

export function startKingdom(game, slot) {
    const kingdom = game.kingdoms[slot - 1];
    if (!kingdom || kingdom.visited || game.current || game.ended) return false;
    kingdom.visited = true;
    game.current = slot;
    game.wins = 0;
    game.topic = null;
    game.scoring.length = 0;
    for (const advisor of game.advisors) advisor.used = false;
    return true;
}

export function revealTopic(game, random = Math.random) {
    if (!game.current || game.topic) return null;
    const card = drawOne(game, random);
    if (!card) return null;
    game.topic = card;
    game.discard.push(card);
    return card;
}

export function legalIndices(game) {
    if (!game.topic) return [];
    const follow = game.hand.some(card => card.suit === game.topic.suit);
    const result = [];
    game.hand.forEach((card, index) => {
        if (!follow || card.suit === game.topic.suit) result.push(index);
    });
    return result;
}

export function canPlay(game, index) {
    const card = game.hand[index];
    return !!card && !!game.topic && legalIndices(game).includes(index);
}

export function debateOutcome(game, card) {
    if (!game.topic) return false;
    const trump = trumpSuit(game);
    if (card.suit === game.topic.suit) return card.rank > game.topic.rank;
    return card.suit === trump && game.topic.suit !== trump;
}

export function playDebate(game, index) {
    const card = game.hand[index];
    if (!card || !canPlay(game, index)) return null;
    const topic = game.topic;
    const win = debateOutcome(game, card);
    game.hand.splice(index, 1);
    if (win) {
        game.scoring.push(card);
        game.wins++;
    } else {
        game.discard.push(card);
    }
    game.topic = null;
    return { card, topic, win };
}

export function unvisitedSlots(game) {
    return game.kingdoms
        .filter(kingdom => !kingdom.visited && kingdom.slot !== game.current)
        .map(kingdom => kingdom.slot);
}

export function discardCards(game, indices) {
    const unique = [...new Set(indices)]
        .filter(index => Number.isInteger(index) && index >= 0 && index < game.hand.length);
    const need = Math.min(2, game.hand.length);
    if (unique.length !== need) return null;
    unique.sort((a, b) => b - a);
    const discarded = unique.map(index => ({ card: game.hand.splice(index, 1)[0], index }));
    game.discard.push(...discarded.map(entry => entry.card));
    return discarded;
}

function sourceEntry(game, source) {
    if (!source) return null;
    if (source.type === 'advisor') return game.advisors[source.index] || null;
    if (source.type === 'ally') return game.allies[source.index] || null;
    return null;
}

function sourceAvailable(entry, source) {
    return !!entry && (source.type === 'advisor' ? !entry.used : !entry.spent);
}

function spendSource(game, source) {
    const entry = sourceEntry(game, source);
    if (!entry) return;
    if (source.type === 'advisor') entry.used = true;
    else entry.spent = true;
}

export function availableAbilities(game) {
    if (!game.current || game.topic) return [];
    const list = [];
    game.advisors.forEach((entry, index) => {
        if (!entry.used) list.push({
            type: 'advisor', index, card: entry.card,
            ability: abilityForSuit(entry.card.suit),
        });
    });
    game.allies.forEach((entry, index) => {
        if (!entry.spent) list.push({
            type: 'ally', index, card: entry.card,
            ability: abilityForSuit(entry.card.suit),
        });
    });
    return list;
}

function resolveAbility(game, ability, random) {
    if (ability === 'hearts') {
        const trump = trumpSuit(game);
        const discarded = [];
        for (let index = 0; index < game.hand.length; index++) {
            if (game.hand[index].suit === trump) discarded.push({ card: game.hand[index], index });
        }
        for (let index = game.hand.length - 1; index >= 0; index--) {
            if (game.hand[index].suit === trump) game.hand.splice(index, 1);
        }
        game.discard.push(...discarded.map(entry => entry.card));
        return { ability, discarded, drawn: [], needsDiscard: false };
    }
    if (ability === 'clubs') {
        const count = game.hand.filter(card => card.suit === 3).length;
        const start = game.hand.length;
        const drawn = drawCards(game, count, random);
        return {
            ability, discarded: [], drawn, needsDiscard: false,
            indices: drawn.map((_, i) => start + i),
        };
    }
    if (ability === 'diamonds') {
        const start = game.hand.length;
        const drawn = drawCards(game, 2, random);
        return {
            ability, discarded: [], drawn, needsDiscard: true,
            indices: drawn.map((_, i) => start + i),
        };
    }
    return { ability, discarded: [], drawn: [], needsDiscard: false, needsTarget: true };
}

// Resolve a non-spade ability and consume its source. Spades return
// needsTarget and stay unused until commitSpades() receives a target.
export function beginAbility(game, source, random = Math.random) {
    if (!game.current || game.topic) return null;
    const entry = sourceEntry(game, source);
    if (!sourceAvailable(entry, source)) return null;
    const ability = abilityForSuit(entry.card.suit);
    if (ability === 'spades') {
        return {
            ability, card: entry.card, source,
            needsTarget: true, targets: unvisitedSlots(game),
        };
    }
    spendSource(game, source);
    return { card: entry.card, source, ...resolveAbility(game, ability, random) };
}

export function commitSpades(game, source, targetSlot = null) {
    if (!game.current || game.topic) return null;
    const entry = sourceEntry(game, source);
    if (!sourceAvailable(entry, source)) return null;
    const current = currentKingdom(game);
    let target = null;
    if (targetSlot != null) {
        target = game.kingdoms[targetSlot - 1];
        if (!target || target.visited || target.slot === current.slot) return null;
    }
    spendSource(game, source);
    if (!target) return { ability: 'spades', card: entry.card, swapped: false };
    const from = current.ruler;
    current.ruler = target.ruler;
    target.ruler = from;
    return {
        ability: 'spades', card: entry.card, swapped: true,
        fromSlot: current.slot, toSlot: target.slot,
    };
}

export function finalScore(game) {
    return game.kingdoms.filter(kingdom => kingdom.conquered).length +
        game.allies.filter(ally => !ally.spent).length;
}

// Call when the hand is empty. Returns a result object for the controller and
// mutates the game: successes recycle the debate deck and draw the next hand.
export function settleKingdom(game, random = Math.random) {
    const kingdom = currentKingdom(game);
    if (!kingdom) return null;
    const required = kingdom.slot;
    const wins = game.wins;
    const ruler = kingdom.ruler;
    if (wins !== required) {
        game.ended = true;
        game.result = 'lost';
        game.current = 0;
        game.topic = null;
        game.score = finalScore(game);
        return { result: 'lost', required, wins, ruler, slot: kingdom.slot, allWon: false };
    }

    kingdom.conquered = true;
    kingdom.ruler = null;
    if (ruler) game.allies.push({ card: ruler, spent: false });
    game.current = 0;
    game.topic = null;
    // Normally the hand is empty here. If abilities pulled every remaining
    // debate card into hand, discard the leftovers so the next deal still has
    // exactly HAND_SIZE cards and the 32-card pool stays intact.
    game.discard.push(...game.hand);
    game.hand.length = 0;
    game.deck.push(...game.discard, ...game.scoring);
    game.discard.length = 0;
    game.scoring.length = 0;
    game.deck = shuffle(game.deck, random);
    game.wins = 0;
    for (const advisor of game.advisors) advisor.used = false;

    const allWon = game.kingdoms.every(entry => entry.conquered);
    if (allWon) {
        game.ended = true;
        game.result = 'won';
    } else {
        drawCards(game, HAND_SIZE, random);
    }
    game.score = finalScore(game);
    return {
        result: allWon ? 'won' : 'continue',
        required, wins, ruler, slot: kingdom.slot, allWon,
    };
}
