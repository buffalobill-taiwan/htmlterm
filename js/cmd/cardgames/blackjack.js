import { createDeck } from './deck.js';
import { shuffle } from '../../util/random.js';

export function score(hand) {
    let total = 0, aces = 0;
    for (const card of hand) {
        total += card.rank === 1 ? 11 : Math.min(10, card.rank);
        if (card.rank === 1) aces++;
    }
    while (total > 21 && aces--) total -= 10;
    return total;
}
export function natural(hand) { return hand.length === 2 && score(hand) === 21; }
export function outcome(player, dealer) {
    const p = score(player), d = score(dealer);
    if (p > 21) return 'loss';
    if (d > 21) return 'win';
    if (natural(player) !== natural(dealer)) return natural(player) ? 'win' : 'loss';
    return p === d ? 'draw' : p > d ? 'win' : 'loss';
}
export function shuffledDeck() {
    return shuffle(createDeck());
}
