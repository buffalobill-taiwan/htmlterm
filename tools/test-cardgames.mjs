import assert from 'node:assert/strict';
import { score, natural, outcome, shuffledDeck } from '../js/cmd/cardgames/blackjack.js';
import { cardBuffer, cardFlipFrames } from '../js/cmd/cardgames/cards.js';
const hand = ranks => ranks.map(rank => ({ suit: 0, rank }));
assert.equal(score(hand([1, 1, 9])), 21);
assert.equal(score(hand([1, 6, 10])), 17);
assert.equal(score(hand([10, 10, 2])), 22);
assert.equal(natural(hand([1, 13])), true);
assert.equal(natural(hand([7, 7, 7])), false);
assert.equal(outcome(hand([1, 13]), hand([7, 7, 7])), 'win');
assert.equal(outcome(hand([1, 13]), hand([1, 10])), 'draw');
assert.equal(outcome(hand([10, 10, 2]), hand([10, 10, 3])), 'loss');
assert.equal(outcome(hand([10, 8]), hand([10, 7])), 'win');
assert.equal(outcome(hand([10, 6]), hand([10, 7])), 'loss');
const deck = shuffledDeck();
assert.equal(new Set(deck.map(c => `${c.suit}:${c.rank}`)).size, 52);
for (const c of [...deck, null, { suit: 1, rank: 0 }]) {
    const vb = cardBuffer(c);
    assert.equal(vb.width, 5); assert.equal(vb.height, 3);
    assert.equal(vb.getCell(1, 0).ch, '│'); assert.equal(vb.getCell(1, 4).ch, '│');
    assert.equal(cardBuffer(c), vb);
}
console.log('Cardgames rules and card rendering passed');

for (const card of deck) {
    const frames = cardFlipFrames(card);
    assert.equal(frames.length, 6);
    assert.equal(cardFlipFrames(card), frames);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
        assert.equal(frames[0].getCell(r, c), cardBuffer(null).getCell(r, c));
        for (let step = 1; step <= 5; step++) {
            const cell = frames[step].getCell(r, c);
            assert.ok(cell);
            if (c >= step) assert.equal(cell, cardBuffer(null).getCell(r, c));
        }
    }
    if (card.rank !== 10) {
        assert.equal(frames[3].getCell(1, 2).clipScale, 1);
        assert.equal(frames[4].getCell(1, 3).clipOffX, -1);
        assert.equal(cardBuffer(card).getCell(1, 2).width, 2);
    }
}
console.log('Cached flip frames and wide-rank slices passed');
