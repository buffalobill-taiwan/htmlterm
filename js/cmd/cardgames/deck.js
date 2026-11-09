// Pure card data shared by the card games. Nothing here touches rendering, so
// rules and AI modules can import it without pulling in VirtualBuffer.

export const SUITS = '♠♥♦♣';
export const RANKS = ['', 'Ａ', '２', '３', '４', '５', '６', '７', '８', '９', '10', 'Ｊ', 'Ｑ', 'Ｋ'];
export const RANK_COUNT = 13;
export const DECK_SIZE = 52;

// Card ids are 0-based and suit-major: ♠A..K = 0..12, ♥A..K = 13..25, ...
export function cardFromId(id) {
    return { suit: Math.floor(id / RANK_COUNT), rank: id % RANK_COUNT + 1 };
}

export function cardId(card) {
    return card.suit * RANK_COUNT + card.rank - 1;
}

export function createDeck() {
    return Array.from({ length: DECK_SIZE }, (_, id) => cardFromId(id));
}
