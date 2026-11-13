import assert from 'node:assert/strict';
import { getSystem, setSystem } from '../js/system/sys.js';
import { SEED_MAX, mulberry32 } from '../js/util/random.js';
import { createDeck } from '../js/cmd/cardgames/deck.js';
import {
    KINGDOM_COUNT, HAND_SIZE, abilityForSuit, createGame, createSeededGame,
    drawOne, drawCards, currentKingdom, requiredWins, trumpSuit, startKingdom,
    revealTopic, legalIndices, canPlay, debateOutcome, playDebate,
    unvisitedSlots, discardCards, availableAbilities, beginAbility,
    commitSpades, finalScore, settleKingdom,
} from '../js/cmd/cardgames/emissary/rules.js';
import { EmissaryView, ALLY_X, KINGDOM_X, handPosition, VISIBLE_HAND } from '../js/cmd/cardgames/emissary/view.js';
import { EmissaryGame } from '../js/cmd/cardgames/emissary/EmissaryGame.js';
import { CardgamesCmd } from '../js/cmd/cardgames/CardgamesCmd.js';
import { cardBuffer } from '../js/cmd/cardgames/cards.js';
import { DISCARD, SCORING } from '../js/cmd/cardgames/emissary/view.js';

const card = (suit, rank) => ({ suit, rank });
const key = card => `${card.suit}:${card.rank}`;

function state(overrides = {}) {
    return {
        kingdoms: Array.from({ length: KINGDOM_COUNT }, (_, index) => ({
            slot: index + 1,
            ruler: card(index % 4, index % 2 ? 13 : 12),
            visited: false,
            conquered: false,
        })),
        advisors: [0, 1, 2, 3].map(suit => ({ card: card(suit, 11), used: false })),
        allies: [], hand: [], deck: [], discard: [], scoring: [],
        wins: 0, current: 0, topic: null, ended: false, result: null, score: 0,
        ...overrides,
    };
}

function fillDebate(game) {
    const cards = createDeck().filter(entry => entry.rank <= 8);
    game.deck = cards.slice(0, 20);
    game.discard = cards.slice(20, 28);
    game.scoring = cards.slice(28, 32);
}

// --- Deck setup and seeded determinism -------------------------------------
assert.ok(CardgamesCmd.usage.includes('emissary'));
assert.ok(CardgamesCmd.help.includes('Emissary'));
assert.equal(abilityForSuit(1), 'hearts');
assert.equal(abilityForSuit(3), 'clubs');
assert.equal(abilityForSuit(0), 'spades');
assert.equal(abilityForSuit(2), 'diamonds');

const seeded = createSeededGame(2024);
const seededAgain = createSeededGame(2024);
assert.deepEqual(seeded, seededAgain);
assert.notDeepEqual(seeded.hand.map(key), createSeededGame(2025).hand.map(key));
assert.equal(KINGDOM_COUNT, 8);
assert.equal(seeded.hand.length, HAND_SIZE);
assert.equal(seeded.deck.length, 24);
assert.equal(seeded.kingdoms.length, 8);
assert.equal(seeded.advisors.length, 4);
assert.ok(seeded.kingdoms.every(kingdom => kingdom.ruler.rank >= 12));
assert.ok(seeded.advisors.every(entry => entry.card.rank === 11));
const debate = [...seeded.hand, ...seeded.deck];
assert.equal(debate.length, 32);
assert.equal(new Set(debate.map(key)).size, 32);
assert.ok(debate.every(entry => entry.rank >= 1 && entry.rank <= 8));
const everyCard = [
    ...debate,
    ...seeded.kingdoms.map(kingdom => kingdom.ruler),
    ...seeded.advisors.map(entry => entry.card),
].map(key);
assert.equal(new Set(everyCard).size, 44);
assert.equal(everyCard.length, 44);

// --- Current kingdom helpers ------------------------------------------------
const framed = state({ current: 1 });
assert.equal(currentKingdom(framed).slot, 1);
assert.equal(requiredWins(framed), 1);
assert.equal(trumpSuit(framed), 0);
framed.current = 0;
assert.equal(requiredWins(framed), 0);

// --- Follow suit and trick resolution --------------------------------------
const trick = state({ current: 1 });
trick.topic = card(1, 5);
trick.hand = [card(1, 2), card(0, 3), card(3, 4)];
assert.deepEqual(legalIndices(trick), [0]);
assert.equal(canPlay(trick, 0), true);
assert.equal(canPlay(trick, 1), false);
assert.equal(playDebate(trick, 1), null);
trick.topic = card(2, 5);
trick.hand = [card(1, 2), card(0, 3), card(3, 4)];
assert.deepEqual(legalIndices(trick), [0, 1, 2]);
assert.equal(canPlay(trick, 1), true);
trick.topic = null;
assert.deepEqual(legalIndices(trick), []);
assert.equal(canPlay(trick, 0), false);

const aces = state({ current: 1 });
aces.topic = card(0, 5);
aces.hand = [card(0, 1)];
assert.equal(debateOutcome(aces, aces.hand[0]), false, 'Ace is low');
aces.topic = card(0, 1);
aces.hand = [card(0, 2)];
assert.equal(debateOutcome(aces, aces.hand[0]), true, 'Two beats an Ace');
aces.topic = card(0, 5);
aces.hand = [card(0, 5)];
assert.equal(debateOutcome(aces, aces.hand[0]), false, 'Equal rank loses');

const trump = state({ current: 1 });
trump.kingdoms[0].ruler = card(0, 13);
trump.topic = card(1, 5);
trump.hand = [card(2, 8), card(0, 1)];
assert.equal(debateOutcome(trump, trump.hand[0]), false, 'Off-suit non-trump loses');
assert.equal(debateOutcome(trump, trump.hand[1]), true, 'Any trump beats a non-trump topic');
trump.topic = card(0, 5);
trump.hand = [card(0, 1), card(0, 6), card(1, 8)];
assert.equal(debateOutcome(trump, trump.hand[0]), false);
assert.equal(debateOutcome(trump, trump.hand[1]), true);
assert.equal(debateOutcome(trump, trump.hand[2]), false, 'Off-suit cannot beat a trump topic');

const played = state({ current: 1 });
played.kingdoms[0].ruler = card(0, 13);
played.topic = card(1, 5);
played.hand = [card(1, 6), card(3, 2)];
const playedWin = playDebate(played, 0);
assert.equal(playedWin.win, true);
assert.deepEqual(played.scoring, [card(1, 6)]);
assert.deepEqual(played.discard, []);
assert.equal(played.wins, 1);
assert.equal(played.topic, null);
assert.equal(played.hand.length, 1);
played.topic = card(1, 5);
const playedLoss = playDebate(played, 0);
assert.equal(playedLoss.win, false);
assert.deepEqual(played.discard, [card(3, 2)]);
assert.equal(played.scoring.length, 1);
assert.equal(played.wins, 1);

// --- Topic reveal and deck recycling ---------------------------------------
const recycle = state();
drawCards(recycle, 0);
recycle.deck = [];
recycle.discard = [card(0, 1), card(0, 2), card(0, 3)];
const first = drawOne(recycle, mulberry32(9));
assert.ok(first);
assert.equal(recycle.deck.length, 2);
assert.equal(recycle.discard.length, 0);
assert.equal(drawCards(recycle, 5).length, 2);
assert.equal(drawOne(recycle), null);
recycle.current = 1;
recycle.deck = [];
recycle.discard = [card(1, 2)];
const topic = revealTopic(recycle, mulberry32(1));
assert.deepEqual(topic, card(1, 2));
assert.deepEqual(recycle.topic, card(1, 2));
assert.deepEqual(recycle.discard, [card(1, 2)]);

// --- Four advisor abilities -------------------------------------------------
const hearts = state({ current: 1 });
hearts.kingdoms[0].ruler = card(0, 13);
hearts.hand = [card(0, 2), card(1, 3), card(0, 4)];
const heartsResult = beginAbility(hearts, { type: 'advisor', index: 1 }, mulberry32(1));
assert.equal(heartsResult.ability, 'hearts');
assert.equal(heartsResult.discarded.length, 2);
assert.deepEqual(hearts.hand, [card(1, 3)]);
assert.deepEqual(hearts.discard, [card(0, 2), card(0, 4)]);
assert.equal(hearts.advisors[1].used, true);
assert.equal(beginAbility(hearts, { type: 'advisor', index: 1 }), null);

const clubs = state({ current: 1 });
clubs.hand = [card(3, 2), card(3, 3), card(1, 4)];
clubs.deck = [card(0, 1), card(0, 2), card(0, 3)];
const clubsResult = beginAbility(clubs, { type: 'advisor', index: 3 }, mulberry32(2));
assert.equal(clubsResult.ability, 'clubs');
assert.equal(clubsResult.drawn.length, 2);
assert.deepEqual(clubsResult.indices, [3, 4]);
assert.equal(clubs.hand.length, 5);
assert.equal(clubs.advisors[3].used, true);

const diamonds = state({ current: 1 });
diamonds.hand = [card(1, 2)];
diamonds.deck = [card(0, 1), card(0, 2), card(0, 3), card(0, 4)];
const diamondsResult = beginAbility(diamonds, { type: 'advisor', index: 2 }, mulberry32(3));
assert.equal(diamondsResult.ability, 'diamonds');
assert.equal(diamondsResult.drawn.length, 2);
assert.equal(diamondsResult.needsDiscard, true);
assert.equal(diamonds.hand.length, 3);
assert.equal(discardCards(diamonds, [0]), null);
assert.equal(discardCards(diamonds, [0, 0]), null);
const thrown = discardCards(diamonds, [0, 2]);
assert.equal(thrown.length, 2);
assert.equal(diamonds.hand.length, 1);
assert.equal(diamonds.discard.length, 2);
assert.equal(diamonds.advisors[2].used, true);

const spades = state({ current: 1 });
const currentRuler = spades.kingdoms[0].ruler;
const otherRuler = spades.kingdoms[1].ruler;
const spadeDraft = beginAbility(spades, { type: 'advisor', index: 0 });
assert.equal(spadeDraft.needsTarget, true);
assert.deepEqual(spadeDraft.targets, [2, 3, 4, 5, 6, 7, 8]);
assert.equal(spades.advisors[0].used, false, 'Spades are spent only on confirmation');
const spadeResult = commitSpades(spades, { type: 'advisor', index: 0 }, 2);
assert.equal(spadeResult.swapped, true);
assert.deepEqual(spades.kingdoms[0].ruler, otherRuler);
assert.deepEqual(spades.kingdoms[1].ruler, currentRuler);
assert.equal(spades.advisors[0].used, true);
assert.equal(commitSpades(spades, { type: 'advisor', index: 0 }, 2), null);

const finalKingdom = state({ current: 8 });
finalKingdom.kingdoms.forEach((kingdom, index) => { kingdom.visited = index !== 7; });
assert.deepEqual(unvisitedSlots(finalKingdom), []);
const finalDraft = beginAbility(finalKingdom, { type: 'advisor', index: 0 });
assert.deepEqual(finalDraft.targets, []);
const finalResult = commitSpades(finalKingdom, { type: 'advisor', index: 0 }, null);
assert.equal(finalResult.swapped, false);
assert.equal(finalKingdom.advisors[0].used, true);

// --- Allies, Jack resets, and scoring --------------------------------------
const ally = state({ current: 1 });
ally.advisors.forEach(entry => { entry.used = true; });
ally.kingdoms[0].ruler = card(0, 13);
ally.allies = [{ card: card(1, 12), spent: false }];
assert.deepEqual(availableAbilities(ally).map(entry => entry.type), ['ally']);
assert.equal(beginAbility(ally, { type: 'ally', index: 0 }, mulberry32(1)).ability, 'hearts');
assert.equal(ally.allies[0].spent, true);
assert.equal(beginAbility(ally, { type: 'ally', index: 0 }), null);
assert.deepEqual(availableAbilities(ally), []);

const reset = state();
reset.advisors.forEach(entry => { entry.used = true; });
assert.equal(startKingdom(reset, 1), true);
assert.ok(reset.advisors.every(entry => !entry.used));
assert.equal(startKingdom(reset, 1), false, 'A kingdom can only be visited once');

const scored = state();
scored.kingdoms[0].conquered = true;
scored.kingdoms[1].conquered = true;
scored.allies = [
    { card: card(0, 12), spent: false },
    { card: card(1, 12), spent: true },
    { card: card(2, 13), spent: false },
];
assert.equal(finalScore(scored), 4);

// --- Exact-win settlement, loss, and perfect score ------------------------
const success = state();
success.current = 1;
success.kingdoms[0].visited = true;
success.wins = 1;
success.advisors.forEach(entry => { entry.used = true; });
fillDebate(success);
const successRuler = success.kingdoms[0].ruler;
const successResult = settleKingdom(success, mulberry32(4));
assert.equal(successResult.result, 'continue');
assert.equal(success.kingdoms[0].conquered, true);
assert.equal(success.kingdoms[0].ruler, null);
assert.deepEqual(success.allies, [{ card: successRuler, spent: false }]);
assert.equal(success.current, 0);
assert.equal(success.hand.length, HAND_SIZE);
assert.equal(success.deck.length, 32 - HAND_SIZE);
assert.equal(success.discard.length, 0);
assert.equal(success.scoring.length, 0);
assert.ok(success.advisors.every(entry => !entry.used), 'Jacks reset after a kingdom');
assert.equal(success.score, 2);

// If ability draws leave cards in hand when the deck runs dry, settlement
// discards them instead of growing the next hand.
const stranded = state();
stranded.current = 1;
stranded.kingdoms[0].visited = true;
stranded.wins = 1;
const strandedCards = createDeck().filter(entry => entry.rank <= 8);
stranded.hand = strandedCards.slice(0, 5);
stranded.deck = [];
stranded.discard = [];
stranded.scoring = strandedCards.slice(5);
const strandedResult = settleKingdom(stranded, mulberry32(7));
assert.equal(strandedResult.result, 'continue');
assert.equal(stranded.hand.length, HAND_SIZE);
assert.equal(stranded.deck.length, 32 - HAND_SIZE);
assert.equal(stranded.discard.length, 0);
assert.equal(stranded.scoring.length, 0);

const failure = state();
failure.current = 1;
failure.kingdoms[0].visited = true;
failure.kingdoms[1].conquered = true;
failure.wins = 2;
fillDebate(failure);
const failureResult = settleKingdom(failure, mulberry32(5));
assert.equal(failureResult.result, 'lost');
assert.equal(failure.ended, true);
assert.equal(failure.result, 'lost');
assert.equal(failure.current, 0);
assert.equal(failure.score, 1);
assert.equal(failure.hand.length, 0);

const perfect = state();
for (let index = 0; index < 7; index++) {
    perfect.kingdoms[index].conquered = true;
    perfect.kingdoms[index].ruler = null;
}
perfect.allies = Array.from({ length: 7 }, (_, index) => ({ card: card(index % 4, 12), spent: false }));
perfect.current = 8;
perfect.kingdoms[7].visited = true;
perfect.wins = 8;
fillDebate(perfect);
const perfectResult = settleKingdom(perfect, mulberry32(6));
assert.equal(perfectResult.result, 'won');
assert.equal(perfect.ended, true);
assert.equal(perfect.result, 'won');
assert.equal(perfect.score, 16);
assert.equal(perfect.hand.length, 0);

// --- Controller phases, abilities, and disposal ----------------------------
const dialogs = [];
const fakeCommand = {
    _confirmQuit() { this.quits = (this.quits || 0) + 1; },
    _menu() { this.menus = (this.menus || 0) + 1; },
    _quit() { this.exits = (this.exits || 0) + 1; },
    openDialog(DialogClass, name, options) {
        const dialog = { name, options, closed: false, close() { this.closed = true; } };
        dialogs.push(dialog);
        return dialog;
    },
};

const controller = new EmissaryGame(fakeCommand);
controller.view.draw = () => {};
controller.draw = () => {};
controller.dealHand = done => { controller.dealing = false; done(); };
controller.runFlights = (moves, { done = () => {} } = {}) => {
    controller.animating = false;
    done();
};
controller.start(4242);
assert.equal(controller.seed, 4242);
assert.equal(controller.phase, 'selectKingdom');
assert.equal(controller.state.hand.length, 8);
assert.equal(controller.state.current, 0);
controller.state.kingdoms[0].ruler = card(0, 13);
controller.kingdomCursor = 0;
controller.key('\r');
assert.equal(controller.phase, 'between');
assert.equal(controller.state.current, 1);
assert.equal(controller.state.kingdoms[0].visited, true);

controller.state.hand = [card(3, 2), card(3, 3), card(1, 4), card(2, 5), card(2, 6)];
controller.handCursor = 0;
controller.handScroll = 0;
controller.state.wins = 0;

const openAbilities = () => {
    const before = dialogs.length;
    controller.key('a');
    assert.equal(dialogs.length, before + 1);
    return dialogs[dialogs.length - 1];
};
const heartsDialog = openAbilities();
assert.equal(heartsDialog.name, 'emissary-abilities');
assert.equal(heartsDialog.options.options.length, 4);
heartsDialog.options.onSelect(1);
assert.equal(controller.phase, 'between');
assert.equal(controller.state.advisors[1].used, true);

const diamondsDialog = openAbilities();
assert.equal(diamondsDialog.options.options.length, 3);
const beforeDiamonds = controller.state.hand.length;
diamondsDialog.options.onSelect(1);
assert.equal(controller.phase, 'discardTwo');
assert.equal(controller.state.hand.length, beforeDiamonds + 2);
controller.discardMarked = new Set([0, 1]);
controller.key('\r');
assert.equal(controller.phase, 'between');
assert.equal(controller.state.hand.length, beforeDiamonds);

const spadesDialog = openAbilities();
spadesDialog.options.onSelect(0);
assert.equal(controller.phase, 'swap');
assert.deepEqual(controller.swapTargets, [2, 3, 4, 5, 6, 7, 8]);
controller.key('\x1B');
assert.equal(controller.phase, 'between');
assert.equal(controller.state.advisors[0].used, false, 'Cancelling leaves the Jack unused');

const commitDialog = openAbilities();
const beforeSwap = controller.state.kingdoms.map(kingdom => kingdom.ruler);
commitDialog.options.onSelect(0);
assert.equal(controller.phase, 'swap');
assert.equal(controller.swapCursor, 2);
controller.key('\r');
assert.equal(controller.phase, 'between');
assert.deepEqual(controller.state.kingdoms[0].ruler, beforeSwap[1]);
assert.deepEqual(controller.state.kingdoms[1].ruler, beforeSwap[0]);
assert.equal(controller.state.advisors[0].used, true);

const clubsDialog = openAbilities();
assert.equal(clubsDialog.options.options.length, 1);
clubsDialog.options.onSelect(0);
assert.equal(controller.phase, 'between');
assert.deepEqual(availableAbilities(controller.state), []);

controller.key('n');
assert.equal(fakeCommand.menus, 1);
controller.key('q');
assert.equal(fakeCommand.quits, 1);
controller.dispose();
assert.equal(controller.disposed, true);
assert.equal(controller.state, null);
assert.equal(controller.cmd, null);
controller.key('a');

const randomStart = new EmissaryGame(fakeCommand);
randomStart.view.draw = () => {};
randomStart.draw = () => {};
randomStart.dealHand = done => { randomStart.dealing = false; done(); };
randomStart.start();
assert.ok(randomStart.seed >= 0 && randomStart.seed <= SEED_MAX);
randomStart.start(4242);
const originalDeal = JSON.stringify(randomStart.state);
randomStart.key('r');
assert.deepEqual(dialogs.at(-1).options.options, ['相同種子', '新隨機種子', '取消']);
dialogs.at(-1).options.onSelect(0);
assert.equal(randomStart.seed, 4242);
assert.equal(JSON.stringify(randomStart.state), originalDeal);
const savedRandom = Math.random;
try {
    Math.random = () => 0.5;
    randomStart.key('r');
    dialogs.at(-1).options.onSelect(1);
    assert.equal(randomStart.seed, Math.floor(0.5 * (SEED_MAX + 1)));
    assert.equal(randomStart.phase, 'selectKingdom');
    assert.notEqual(JSON.stringify(randomStart.state), originalDeal);
} finally {
    Math.random = savedRandom;
}
const retainedState = randomStart.state;
const retainedSeed = randomStart.seed;
for (const cancel of [options => options.onSelect(2), options => options.onCancel()]) {
    randomStart.key('r');
    cancel(dialogs.at(-1).options);
    assert.equal(randomStart.state, retainedState);
    assert.equal(randomStart.seed, retainedSeed);
    assert.equal(randomStart.dialog, null);
}
randomStart.phase = 'lost';
randomStart.key('\r');
assert.equal(randomStart.seed, retainedSeed, 'Enter after game over retains seed');
randomStart.dispose();

// --- Topic reveal, debate resolution, and settlement flow ------------------
const flowCommand = {
    _confirmQuit() { this.quits = (this.quits || 0) + 1; },
    _menu() { this.menus = (this.menus || 0) + 1; },
    _quit() { this.exits = (this.exits || 0) + 1; },
    openDialog(DialogClass, name, options) {
        return { name, options, closed: false, close() { this.closed = true; } };
    },
};
function makeFlow(seed = 777) {
    const flow = new EmissaryGame(flowCommand);
    flow.view.draw = () => {};
    flow.draw = () => {};
    flow.dealHand = done => { flow.dealing = false; done(); };
    flow.runFlights = (moves, { done = () => {} } = {}) => { flow.animating = false; done(); };
    flow.flyCard = (card, from, to, options, done) => { done(); return () => {}; };
    flow.kingdomResults = [];
    flow.results = [];
    flow.showKingdomResult = result => flow.kingdomResults.push(result);
    flow.showResult = result => flow.results.push(result);
    flow.start(seed);
    return flow;
}

const flow = makeFlow();
flow.state = state({ current: 1 });
flow.state.kingdoms[0] = { slot: 1, ruler: card(0, 13), visited: true, conquered: false };
flow.state.hand = [card(1, 6), card(1, 2), card(3, 4)];
flow.state.deck = [card(1, 4)];
flow.phase = 'between';

flow.key('\r');
assert.equal(flow.phase, 'debate');
assert.deepEqual(flow.state.topic, card(1, 4));
assert.deepEqual(flow.topicDisplay, card(1, 4));
assert.equal(flow.animating, false);
assert.equal(flow.handCursor, 0, 'cursor jumps to the first legal card');
assert.deepEqual(flow.state.discard, [card(1, 4)]);

flow.key('\r');
assert.equal(flow.phase, 'between');
assert.equal(flow.state.wins, 1);
assert.equal(flow.state.hand.length, 2);
assert.equal(flow.topicDisplay, null);
assert.deepEqual(flow.state.scoring, [card(1, 6)]);

flow.state.deck = [card(1, 3)];
flow.key('\r');
assert.equal(flow.phase, 'debate');
assert.deepEqual(flow.state.topic, card(1, 3));
flow.key('\r');
assert.equal(flow.phase, 'between');
assert.equal(flow.state.wins, 1, 'A lost debate adds no win');
assert.equal(flow.state.hand.length, 1);
assert.deepEqual(flow.state.discard.at(-1), card(1, 2));

// A response that does not follow suit is rejected without consuming a card.
flow.phase = 'debate';
flow.state.topic = card(1, 5);
flow.state.hand = [card(0, 2), card(1, 7)];
flow.handCursor = 0;
flow.key('\r');
assert.equal(flow.state.hand.length, 2);
assert.equal(flow.phase, 'debate');
assert.ok(flow.status.includes('跟隨'));

// An empty hand with exactly the required wins continues to a new kingdom.
flow.state = state({ current: 1, wins: 1 });
flow.state.kingdoms[0].visited = true;
flow.state.advisors.forEach(entry => { entry.used = true; });
fillDebate(flow.state);
flow.phase = 'between';
flow.settle();
assert.equal(flow.kingdomResults.length, 1);
assert.equal(flow.results.length, 0);
assert.equal(flow.phase, 'between');
assert.equal(flow.state.kingdoms[0].conquered, true);
assert.equal(flow.state.current, 0);
assert.equal(flow.state.hand.length, HAND_SIZE);
assert.equal(flow.state.allies.length, 1);
assert.ok(flow.state.advisors.every(entry => !entry.used), 'Jacks reset on success');

// Continuing from the kingdom result deals the next hand.
flow.startNextKingdom();
assert.equal(flow.phase, 'selectKingdom');
assert.equal(flow.state.hand.length, HAND_SIZE);

// An empty hand with the wrong number of wins ends the run.
flow.state = state({ current: 1, wins: 2 });
flow.state.kingdoms[0].visited = true;
flow.phase = 'between';
fillDebate(flow.state);
flow.settle();
assert.equal(flow.results.length, 1);
assert.equal(flow.results[0].result, 'lost');
assert.equal(flow.phase, 'lost');
assert.equal(flow.state.ended, true);

// Conquering the eighth kingdom wins the game.
flow.results.length = 0;
flow.state = state({ current: 8, wins: 8 });
flow.state.kingdoms.forEach((kingdom, index) => {
    kingdom.visited = true;
    if (index < 7) { kingdom.conquered = true; kingdom.ruler = null; }
});
flow.state.allies = Array.from({ length: 7 }, (_, index) => ({
    card: card(index % 4, 12), spent: false,
}));
flow.phase = 'between';
fillDebate(flow.state);
flow.settle();
assert.equal(flow.results.length, 1);
assert.equal(flow.results[0].result, 'won');
assert.equal(flow.phase, 'won');
assert.equal(flow.state.score, 16);
flow.dispose();
assert.equal(flow.disposed, true);

// --- View geometry and rendering ------------------------------------------
assert.equal(new EmissaryView().vb.height, 24);
assert.equal(VISIBLE_HAND, 12);
assert.equal(handPosition(0).x, 2);
assert.equal(handPosition(11).x, 2 + 11 * 6);
assert.ok(handPosition(11).x + 5 <= 80);
assert.equal(new Set(KINGDOM_X).size, 8);
assert.ok(KINGDOM_X.every(x => x + 5 <= 80));

const previousSystem = getSystem();
let rendered = null;
setSystem({ term: { writeVB: vb => { rendered = vb; } } });
const view = new EmissaryView();
const viewGame = {
    state: createSeededGame(5),
    phase: 'selectKingdom',
    kingdomCursor: 0,
    swapCursor: 0,
    handScroll: 0,
    handCursor: 0,
    hiddenHand: new Set(),
    hiddenKingdoms: new Set(),
    hiddenTopic: false,
    hiddenAlly: null,
    topicDisplay: null,
    dealing: false,
    animating: false,
    status: '',
    seed: 5,
};
viewGame.state.current = 1;
view.draw(viewGame);
assert.ok(rendered);
assert.equal(rendered.width, 80);
assert.equal(rendered.height, 24);
assert.equal(rendered.getCell(2, KINGDOM_X[0]).ch, '┌');
assert.equal(rendered.getCell(17, 2).ch, '┌');
assert.equal(rendered.getCell(10, 2).ch, '牌');
assert.equal(rendered.getCell(15, 7).ch, '顧', 'support header moved up');
assert.equal(rendered.getCell(16, 2).ch, ' ', 'cursor row is free of header text');
assert.equal(rendered.getCell(12, 7).bg, 8, 'Jacks are grey while not usable');
// Both face-up piles must preserve white-backed artwork for every suit.
for (let suit = 0; suit < 4; suit++) {
    const top = card(suit, 8);
    viewGame.state.discard = [card((suit + 1) % 4, 1), top];
    viewGame.state.scoring = [card((suit + 1) % 4, 2), top];
    view.draw(viewGame);
    const expected = cardBuffer(top);
    for (const pile of [DISCARD, SCORING]) {
        for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
            assert.deepEqual(rendered.getCell(pile.y + y, pile.x + x), expected.getCell(y, x),
                `pile at ${pile.x}, suit ${suit}, cell ${x},${y}`);
        }
        assert.equal(rendered.getCell(pile.y, pile.x).bg, 7);
        assert.equal(rendered.getCell(pile.y, pile.x).fg, 0);
    }
}
// A presented topic is excluded by identity, even when a losing response
// has already been appended above it during the outgoing-card animation.
const priorDiscard = card(0, 3);
const presentedTopic = card(1, 6);
const losingResponse = card(1, 2);
function assertDiscardPresentation(expectedTop, count) {
    view.draw(viewGame);
    if (expectedTop) {
        const expected = cardBuffer(expectedTop);
        for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++)
            assert.deepEqual(rendered.getCell(DISCARD.y + y, DISCARD.x + x), expected.getCell(y, x));
    } else assert.equal(rendered.getCell(DISCARD.y + 1, DISCARD.x + 1).ch, ' ');
    const label = Array.from({ length: 10 }, (_, x) => rendered.getCell(10, DISCARD.x + x))
        .filter(cell => cell.width !== 0).map(cell => cell.ch).join('').trim();
    assert.equal(label, `棄牌 ${count}`);
}
viewGame.state.topic = presentedTopic;
viewGame.state.discard = [presentedTopic];
viewGame.hiddenTopic = true;
assertDiscardPresentation(null, 0);
viewGame.hiddenTopic = false;
assertDiscardPresentation(null, 0);
viewGame.state.discard = [priorDiscard, presentedTopic];
assertDiscardPresentation(priorDiscard, 1);
viewGame.state.topic = null;
viewGame.topicDisplay = presentedTopic;
assertDiscardPresentation(priorDiscard, 1);
viewGame.topicDisplay = null;
assertDiscardPresentation(presentedTopic, 2);
viewGame.topicDisplay = presentedTopic;
viewGame.state.discard.push(losingResponse);
assertDiscardPresentation(losingResponse, 2);
assert.deepEqual(viewGame.state.discard, [priorDiscard, presentedTopic, losingResponse]);
viewGame.topicDisplay = null;
assertDiscardPresentation(losingResponse, 3);
viewGame.state.discard = [];
viewGame.state.scoring = [];
view.draw(viewGame);
for (const pile of [DISCARD, SCORING]) {
    assert.equal(rendered.getCell(pile.y, pile.x).ch, '┌');
    assert.equal(rendered.getCell(pile.y + 1, pile.x + 1).ch, ' ');
}
viewGame.phase = 'between';
view.draw(viewGame);
assert.notEqual(rendered.getCell(12, 7).bg, 8, 'usable Jacks are not grey');
viewGame.state.advisors[0].used = true;
view.draw(viewGame);
assert.equal(rendered.getCell(12, 7).bg, 8, 'used Jacks are grey');
viewGame.state.advisors[0].used = false;
viewGame.state.allies = [{ card: card(1, 12), spent: true }];
view.draw(viewGame);
assert.equal(rendered.getCell(12, ALLY_X[0]).bg, 8, 'spent allies are grey');
viewGame.state.allies = [];
assert.ok(Array.from({ length: 80 }, (_, x) => rendered.getCell(23, x)?.ch ?? ' ')
    .join('').includes('H'));

// A wide ★ inside an empty card must not push the right border out.
viewGame.state.kingdoms[0].conquered = true;
viewGame.state.kingdoms[0].ruler = null;
view.draw(viewGame);
assert.equal(rendered.getCell(3, KINGDOM_X[0]).ch, '│');
assert.equal(rendered.getCell(3, KINGDOM_X[0] + 1).ch, '★');
assert.equal(rendered.getCell(3, KINGDOM_X[0] + 4).ch, '│', 'empty card right border at x+4');
assert.equal(rendered.getCell(3, KINGDOM_X[0] + 5).ch, ' ', 'wide ★ stays inside the card');
viewGame.state.kingdoms[0].conquered = false;

viewGame.phase = 'won';
viewGame.state.ended = true;
viewGame.state.result = 'won';
viewGame.state.score = 16;
for (const kingdom of viewGame.state.kingdoms) {
    kingdom.conquered = true;
    kingdom.ruler = null;
}
viewGame.state.allies = Array.from({ length: 8 }, (_, index) => ({
    card: card(index % 4, 12), spent: false,
}));
view.draw(viewGame);
assert.ok(Array.from({ length: 80 }, (_, x) => rendered.getCell(4, x)?.ch ?? ' ')
    .join('').includes('勝'));

// ★/✗ (wide) and · (narrow) must align their status text at the same column.
viewGame.state.kingdoms[1].conquered = false;
viewGame.state.kingdoms[1].visited = true;
viewGame.state.kingdoms[2].conquered = false;
viewGame.state.kingdoms[2].visited = false;
view.draw(viewGame);
assert.equal(rendered.getCell(12, 21).ch, '★');
assert.equal(rendered.getCell(12, 24).ch, '已', 'conquered status aligned');
assert.equal(rendered.getCell(13, 21).ch, '✗');
assert.equal(rendered.getCell(13, 24).ch, '未', 'failed status aligned');
assert.equal(rendered.getCell(14, 21).ch, '·');
assert.equal(rendered.getCell(14, 24).ch, '未', 'unvisited status aligned');
setSystem(previousSystem);

console.log('The Emissary deck, trick rules, abilities, settlement, score, controller, and view passed');
