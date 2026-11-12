import assert from 'node:assert/strict';
import { score, natural, outcome, shuffledDeck } from '../js/cmd/cardgames/blackjack.js';
import { cardBuffer, cardFlipFrames } from '../js/cmd/cardgames/cards.js';
import { createGame, dealInitialEnemyRow, returnInitialCombatants, compactEnemyRow, refillEnemyRow,
    beginRound, discardFromHand, drawToFour, captureValue, capture, yieldToEnemy, sacrifice,
    outcome as captureOutcome, hasSafeAction, actionAvailability, playerCardZones } from '../js/cmd/cardgames/capture/rules.js';
import { CaptureGame } from '../js/cmd/cardgames/capture/CaptureGame.js';
import { CaptureView, ENEMY_DECK, ENEMY_CAPTURE, PERSONAL_DECK, PERSONAL_DISCARD,
    ACTION_OPTIONS, ACTION_OPTION_LAYOUT, TARGET_CARDS, targetCardKey,
    enemyPosition, handPosition } from '../js/cmd/cardgames/capture/view.js';
import { CardgamesCmd } from '../js/cmd/cardgames/CardgamesCmd.js';
import { getSystem, setSystem } from '../js/system/sys.js';
assert.ok(CardgamesCmd.usage.includes('capture'));
assert.ok(CardgamesCmd.help.includes('Card Capture'));
assert.equal(ENEMY_DECK.y, 2);
assert.equal(ENEMY_CAPTURE.y, 2);
assert.equal(PERSONAL_DECK.y, 12);
assert.equal(PERSONAL_DISCARD.y, 12);
assert.equal(new CaptureView().vb.height, 24);
assert.deepEqual([0, 1, 2, 3].map(enemyPosition), [
    { x: 52, y: 4 }, { x: 39, y: 4 }, { x: 26, y: 4 }, { x: 13, y: 4 },
]);
assert.deepEqual([0, 1, 2, 3].map(handPosition), [
    { x: 13, y: 14 }, { x: 26, y: 14 }, { x: 39, y: 14 }, { x: 52, y: 14 },
]);
const previousSystem = getSystem();
let renderedView;
setSystem({ term: { writeVB: vb => { renderedView = vb; } } });
const markerView = new CaptureView();
const markerGame = {
    state: {
        round: 1, enemyDeck: [], enemyCapture: [], personalDeck: [], personalDiscard: [],
        enemyRow: [5, 6, 7, 8].map(rank => ({ suit: 0, rank })),
        hand: [2, 3, 4, 2].map(rank => ({ suit: 0, rank })),
    },
    hiddenRow: new Set(), hiddenHand: new Set(), marked: new Set([1]), selection: new Set(),
    capturedTargets: new Set(),
    actionAvailability: { capture: true, sacrifice: false, yield: true },
    phase: 'discard', focus: 'hand', action: 'capture', handCursor: 0, rowCursor: 0, animating: false,
    result: null, status: '選擇要棄掉的手牌；可不棄牌。', instructions: () => 'TEST',
};
markerView.draw(markerGame);
assert.equal(renderedView.getCell(0, 0).ch, 'C');
assert.equal(TARGET_CARDS.length, 16);
assert.deepEqual(TARGET_CARDS.slice(0, 4).map(({ suit, rank }) => `${suit}:${rank}`),
    ['0:11', '0:12', '0:13', '0:1']);
assert.deepEqual(TARGET_CARDS.slice(-4).map(({ suit, rank }) => `${suit}:${rank}`),
    ['3:11', '3:12', '3:13', '3:1']);
assert.equal(renderedView.getCell(0, 32).ch, '♠');
assert.equal(renderedView.getCell(0, 32).fg, 8);
assert.equal(renderedView.getCell(0, 33).ch, 'Ｊ');
assert.equal(renderedView.getCell(0, 33).fg, 8);
assert.equal(renderedView.getCell(0, 35).ch, '♠');
assert.equal(renderedView.getCell(0, 41).ch, '♠');
assert.equal(renderedView.getCell(0, 44).ch, '♥');
assert.equal(renderedView.getCell(0, 77).ch, '♣');
assert.equal(renderedView.getCell(0, 77).fg, 8);
markerGame.capturedTargets.add(targetCardKey(TARGET_CARDS[0]));
markerGame.capturedTargets.add(targetCardKey(TARGET_CARDS[4]));
markerGame.capturedTargets.add(targetCardKey(TARGET_CARDS.at(-1)));
markerView.draw(markerGame);
assert.equal(renderedView.getCell(0, 32).fg, 15);
assert.equal(renderedView.getCell(0, 44).fg, 9);
assert.equal(renderedView.getCell(0, 77).fg, 15);
markerGame.capturedTargets.clear();
const markerText = (row, col) => Array.from({ length: 5 }, (_, i) => renderedView.getCell(row, col + i)?.ch ?? ' ').join('');
assert.equal(Array.from({ length: 80 }, (_, i) => renderedView.getCell(8, i)?.ch).join(''), '='.repeat(80));
assert.equal(Array.from({ length: 80 }, (_, i) => renderedView.getCell(11, i)?.ch).join(''), '='.repeat(80));
assert.equal(Array.from({ length: 80 }, (_, i) => renderedView.getCell(19, i)?.ch ?? ' ').join(''), ' '.repeat(80));
assert.equal(markerText(17, 13), '>[ ] ');
assert.equal(markerText(17, 26), ' [X] ');
assert.equal(markerText(7, 52), '     ');
assert.equal(renderedView.getCell(22, 38).ch, 'T');
markerGame.phase = 'actionOptions';
markerGame.actionCursor = 0;
markerView.draw(markerGame);
const optionLine = (row, col, width) =>
    Array.from({ length: width }, (_, i) => renderedView.getCell(row, col + i)?.ch ?? ' ').join('');
const optionText = (row, col, width) =>
    Array.from({ length: width }, (_, i) => renderedView.getCell(row, col + i))
        .filter(cell => cell && cell.width !== 0).map(cell => cell.ch).join('');
assert.equal(ACTION_OPTIONS.length, 3);
assert.equal(optionLine(18, 30, 20), `╔${'═'.repeat(18)}╗`);
assert.equal(optionLine(21, 30, 20), `╚${'═'.repeat(18)}╝`);
assert.equal(renderedView.getCell(19, 8).bg, 24);
assert.equal(renderedView.getCell(19, 30).bg, 52);
assert.ok(optionText(20, 30, 20).includes('犧牲兩張換任一張'));
assert.ok(optionText(23, 0, 80).includes('R 重玩'));
markerGame.actionAvailability = { capture: false, sacrifice: false, yield: false };
markerGame.phase = 'gameOver';
markerView.draw(markerGame);
assert.equal(renderedView.getCell(19, 8).bg, 52);
markerGame.phase = 'gameOverPrompt';
markerView.draw(markerGame);
assert.equal(renderedView.getCell(19, 8).bg, 0);
assert.equal(renderedView.getCell(8, 22).ch, 'G');
assert.equal(renderedView.getCell(8, 22).clipScale, 4);
assert.ok(optionText(22, 0, 80).includes('TEST'));
const personalCards = [];
for (let suit = 0; suit < 4; suit++)
    for (let rank = 2; rank <= 4; rank++) personalCards.push({ suit, rank });
personalCards.push({ suit: -1, rank: 0 }, { suit: -1, rank: 0 });
const summaryState = {
    round: 7,
    hand: personalCards.slice(0, 2),
    personalDeck: personalCards.slice(2, 7),
    personalDiscard: personalCards.slice(7, 12),
    enemyCapture: [...personalCards.slice(12), { suit: 0, rank: 5 }],
    enemyDeck: [], enemyRow: [null, null, null, null],
};
const cardZones = playerCardZones(summaryState);
assert.deepEqual(cardZones.map(zone => zone.cards.length), [2, 5, 5, 2]);
assert.equal(cardZones.reduce((count, zone) => count + zone.cards.length, 0), 14);
const summaryView = new CaptureView();
summaryView.draw({
    state: summaryState, phase: 'winSummary',
    actionCounts: { captures: 4, sacrifices: 2, yields: 3 },
    instructions: () => '',
});
assert.ok(optionText(1, 0, 80).includes('Card Capture — 勝利結算'));
assert.ok(optionText(4, 4, 30).includes('回合數：7'));
assert.ok(optionText(6, 4, 76).includes('捕獲次數：4'));
assert.ok(optionText(10, 4, 76).includes('手牌（2）'));
assert.ok(optionText(11, 4, 76).includes('♠２'));
assert.ok(optionText(20, 4, 76).includes('小丑'));
assert.ok(optionText(19, 4, 76).includes('移入敵方移除堆的玩家牌（2）'));
assert.ok(optionText(22, 0, 80).includes('Enter 新局'));
markerGame.phase = 'capture';
markerGame.focus = 'row';
markerGame.rowCursor = 0;
markerView.draw(markerGame);
assert.equal(markerText(7, 52), '>[ ] ');
assert.equal(markerText(17, 13), '     ');
markerGame.rowCursor = 1;
markerView.draw(markerGame);
assert.equal(markerText(7, 52), ' [ ] ');
assert.equal(markerText(7, 39), '>[ ] ');
assert.notEqual(renderedView.getCell(5, 40).bg, 3);
markerGame.focus = 'hand';
markerView.draw(markerGame);
assert.equal(renderedView.getCell(5, 40).bg, 3);
assert.notEqual(renderedView.getCell(5, 53).bg, 3);
markerGame.action = 'sacrifice';
markerView.draw(markerGame);
assert.equal(renderedView.getCell(5, 40).bg, 3);
markerGame.action = 'yield';
markerView.draw(markerGame);
assert.equal(renderedView.getCell(5, 53).bg, 3);
assert.notEqual(renderedView.getCell(5, 40).bg, 3);
markerGame.phase = 'actionOptions';
markerView.draw(markerGame);
assert.notEqual(renderedView.getCell(5, 53).bg, 3);
markerGame.phase = 'capture';
markerGame.action = 'capture';
markerGame.focus = 'row';
markerGame.animating = true;
markerView.draw(markerGame);
assert.equal(markerText(7, 52), '     ');
markerGame.animating = false;
markerGame.state.personalDiscard = [{ suit: 0, rank: 3 }];
markerView.draw(markerGame);
assert.equal(markerText(15, 72), '     ');
markerGame.bannerText = '敵方階段';
markerView.draw(markerGame);
assert.equal(renderedView.getCell(9, 32).ch, '敵');
assert.equal(renderedView.getCell(9, 32).clipScale, 2);
assert.equal(renderedView.getCell(10, 32).clipOffY, -1);
setSystem(previousSystem);

const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
const rafCallbacks = [];
const bannerOverlays = new Set();
globalThis.requestAnimationFrame = callback => { rafCallbacks.push(callback); return rafCallbacks.length; };
globalThis.cancelAnimationFrame = () => {};
setSystem({ term: {
    cols: 80, rows: 25, markRowDirty() {},
    addOverlay: overlay => bannerOverlays.add(overlay),
    removeOverlay: overlay => bannerOverlays.delete(overlay),
} });
const bannerController = new CaptureGame({
    executionGuard: () => () => true,
    addCleanup: () => () => {},
});
bannerController.view.draw = () => {};
bannerController.bannerText = '遊戲開始';
let bannerCompleted = false;
bannerController.animateBanner('敵方階段', () => { bannerCompleted = true; }, 500);
const advanceFrame = timestamp => {
    const callback = rafCallbacks.shift();
    assert.ok(callback);
    callback(timestamp);
};
advanceFrame(0);
advanceFrame(16);
assert.equal(bannerOverlays.size, 1);
let bannerOverlay = [...bannerOverlays][0];
assert.equal(bannerOverlay.getCell(0, 32).ch, '遊');
advanceFrame(516);
advanceFrame(766);
bannerOverlay = [...bannerOverlays][0];
assert.equal(bannerOverlay.getCell(0, 8).ch, '遊');
assert.equal(bannerOverlay.getCell(0, 56).ch, '敵');
advanceFrame(1015);
assert.equal(bannerCompleted, false);
advanceFrame(1016);
assert.equal(bannerCompleted, false);
advanceFrame(1032);
assert.equal(bannerCompleted, true);
assert.equal(bannerController.bannerText, '敵方階段');
assert.equal(bannerOverlays.size, 0);
bannerController.dispose();
const unavailableChoiceController = new CaptureGame({
    _quit() {}, _menu() {},
});
unavailableChoiceController.view.draw = () => {};
unavailableChoiceController.state = {
    round: 1, personalDeck: [], personalDiscard: [],
    hand: [{ suit: 0, rank: 2 }], enemyDeck: [],
    enemyRow: [{ suit: 1, rank: 5 }, null, null, null], enemyCapture: [],
};
unavailableChoiceController.enterActionPhase(unavailableChoiceController.state);
assert.deepEqual(unavailableChoiceController.actionAvailability,
    { capture: false, sacrifice: false, yield: true });
assert.equal(unavailableChoiceController.actionCursor, 2);
unavailableChoiceController.key('\x1b[D');
assert.equal(unavailableChoiceController.actionCursor, 2);
unavailableChoiceController.actionCursor = 0;
unavailableChoiceController.selectAction();
assert.equal(unavailableChoiceController.phase, 'actionOptions');
unavailableChoiceController.actionCursor = 2;
unavailableChoiceController.key('\r');
assert.equal(unavailableChoiceController.action, 'yield');
unavailableChoiceController.key('\x1B');
assert.equal(unavailableChoiceController.phase, 'actionOptions');
unavailableChoiceController.dispose();

let quitDuringGameOver = 0;
const gameOverController = new CaptureGame({
    _quit() { quitDuringGameOver++; }, _menu() {},
    executionGuard: () => () => true,
    addCleanup: () => () => {},
});
gameOverController.view.draw = () => {};
gameOverController.state = {
    round: 1, personalDeck: [], personalDiscard: [],
    hand: [{ suit: -1, rank: 0 }], enemyDeck: [],
    enemyRow: [{ suit: 0, rank: 11 }, null, null, null], enemyCapture: [],
};
gameOverController.enterActionPhase(gameOverController.state);
assert.equal(gameOverController.phase, 'gameOver');
assert.deepEqual(gameOverController.actionAvailability,
    { capture: false, sacrifice: false, yield: false });
assert.equal(bannerOverlays.size, 1);
gameOverController.key('q');
gameOverController.key('\x1B');
assert.equal(quitDuringGameOver, 0);
const gameOverOverlay = [...bannerOverlays][0];
const blackCellCount = () => ACTION_OPTION_LAYOUT.x.reduce((total, x) => {
    for (let row = ACTION_OPTION_LAYOUT.y; row < ACTION_OPTION_LAYOUT.y + ACTION_OPTION_LAYOUT.height; row++)
        for (let col = x; col < x + ACTION_OPTION_LAYOUT.width; col++)
            if (gameOverOverlay.getCell(row, col)?.bg === 0) total++;
    return total;
}, 0);
advanceFrame(0);
advanceFrame(16);
advanceFrame(815);
assert.equal(blackCellCount(), 0);
advanceFrame(816);
assert.equal(blackCellCount(), 0);
advanceFrame(1816);
assert.equal(blackCellCount(), 120);
advanceFrame(2816);
assert.equal(blackCellCount(), 240);
assert.equal(gameOverController.phase, 'gameOverPrompt');
gameOverController.key('\x1b[C');
assert.equal(gameOverController.phase, 'gameOverPrompt');
gameOverController.key('\r');
assert.equal(gameOverController.phase, 'transition');
gameOverController.dispose();
if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
setSystem(previousSystem);
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

const captureGame = createGame(() => 0.5);
assert.equal(captureGame.personalDeck.length, 14);
assert.equal(captureGame.personalDeck.filter(card => card.rank === 0).length, 2);
for (const rank of [2, 3, 4])
    assert.equal(captureGame.personalDeck.filter(card => card.rank === rank).length, 4);
assert.equal(captureGame.enemyDeck.length, 40);
assert.deepEqual(captureGame.enemyRow, [null, null, null, null]);
assert.equal(captureGame.round, 0);
const cardsInGame = [
    ...captureGame.personalDeck, ...captureGame.personalDiscard, ...captureGame.hand,
    ...captureGame.enemyDeck, ...captureGame.enemyRow.filter(Boolean), ...captureGame.enemyCapture,
];
assert.equal(cardsInGame.length, 54);
assert.equal(new Set(cardsInGame).size, 54);

const initialDeal = {
    enemyDeck: [{ suit: 3, rank: 13 }, { suit: 2, rank: 7 }, { suit: 1, rank: 11 }, { suit: 0, rank: 4 }],
    enemyRow: [null, null, null, null],
};
assert.deepEqual(dealInitialEnemyRow(initialDeal).map(move => move.index), [0, 1, 2, 3]);
assert.equal(initialDeal.enemyDeck.length, 0);
const returned = returnInitialCombatants(initialDeal);
assert.deepEqual(returned.map(move => move.index), [1, 3]);
assert.equal(initialDeal.enemyDeck.length, 2);
assert.deepEqual(initialDeal.enemyRow.map(card => card?.rank ?? null), [4, null, 7, null]);

const target = { suit: 2, rank: 7 };
const playerState = {
    hand: [{ suit: 2, rank: 3 }, { suit: -1, rank: 0 }, { suit: 2, rank: 4 }, { suit: 1, rank: 2 }],
    personalDeck: [], personalDiscard: [], enemyDeck: [],
    enemyRow: [null, target, null, null], enemyCapture: [],
};
assert.equal(captureValue(playerState, [0, 1], target), 7);
assert.equal(captureValue(playerState, [0, 3], target), null);
assert.equal(captureValue({ ...playerState, hand: [{ suit: -1, rank: 0 }] }, [0], target), null);
assert.equal(captureValue({ hand: [{ suit: 2, rank: 1 }] }, [0], target), 14);
assert.equal(captureValue({ hand: [{ suit: 2, rank: 12 }] }, [0], target), 12);
assert.equal(capture(playerState, 1, [0, 1]), true);
assert.equal(playerState.enemyRow[1], null);
assert.equal(playerState.hand.length, 2);
assert.equal(playerState.personalDiscard.length, 3);
assert.ok(playerState.personalDiscard.includes(target));

const cyclingState = {
    hand: [{ suit: 0, rank: 2 }],
    personalDeck: [],
    personalDiscard: [{ suit: 1, rank: 3 }, { suit: 2, rank: 4 }],
};
assert.equal(discardFromHand(cyclingState, [0, 0]), false);
assert.equal(cyclingState.hand.length, 1);
assert.equal(discardFromHand(cyclingState, [0]), true);
const drawResult = drawToFour(cyclingState, () => 0);
assert.equal(cyclingState.hand.length, 3);
assert.equal(cyclingState.personalDiscard.length, 0);
assert.equal(drawResult.recycled.length, 3);
assert.equal(drawResult.recycledDeck.length, 3);
assert.equal(drawResult.drawn.length, 3);

const yieldState = {
    hand: [{ suit: 0, rank: 2 }],
    enemyDeck: [],
    enemyRow: [{ suit: 3, rank: 11 }, null, null, null],
    enemyCapture: [],
};
assert.equal(yieldToEnemy(yieldState, 0), true);
assert.equal(captureOutcome(yieldState), 'loss');

const sacrificeTarget = { suit: 1, rank: 5 };
const sacrificeState = {
    hand: [{ suit: 0, rank: 3 }, { suit: -1, rank: 0 }, { suit: 0, rank: 12 }],
    enemyRow: [sacrificeTarget, null, null, null],
    enemyDeck: [], enemyCapture: [],
};
assert.equal(sacrifice(sacrificeState, 0, [0, 2]), false);
assert.equal(sacrifice(sacrificeState, 0, [0, 1]), true);
assert.equal(sacrificeState.enemyDeck[0], sacrificeTarget);
assert.equal(sacrificeState.hand.length, 1);
assert.equal(sacrificeState.enemyCapture.length, 2);
assert.equal(hasSafeAction({
    hand: [{ suit: 0, rank: 2 }],
    enemyRow: [{ suit: 0, rank: 3 }, null, null, null],
}), true);
assert.equal(hasSafeAction({
    hand: [{ suit: 0, rank: 2 }],
    enemyRow: [{ suit: 0, rank: 11 }, null, null, null],
}), false);
assert.deepEqual(actionAvailability({
    hand: [{ suit: 0, rank: 2 }],
    enemyRow: [{ suit: 1, rank: 5 }, null, null, null],
}), { capture: false, sacrifice: false, yield: true });
assert.deepEqual(actionAvailability({
    hand: [{ suit: -1, rank: 0 }],
    enemyRow: [{ suit: 0, rank: 11 }, null, null, null],
}), { capture: false, sacrifice: false, yield: false });
assert.equal(captureOutcome({ enemyDeck: [], enemyRow: [null, null, null, null], enemyCapture: [] }), 'win');
assert.equal(captureOutcome({ enemyDeck: [], enemyRow: [null, null, null, null], enemyCapture: [{ suit: 2, rank: 1 }] }), 'loss');
const refillOne = { suit: 2, rank: 7 }, refillTwo = { suit: 3, rank: 8 };
const roundState = {
    round: 1,
    enemyRow: [null, { suit: 0, rank: 3 }, null, { suit: 1, rank: 6 }],
    enemyDeck: [refillOne, refillTwo],
};
const roundTransition = beginRound(roundState);
assert.deepEqual(roundState.enemyRow, [
    { suit: 0, rank: 3 }, { suit: 1, rank: 6 }, refillOne, refillTwo,
]);
assert.equal(roundState.round, 2);
assert.deepEqual(roundTransition.moves, [
    { card: roundState.enemyRow[0], fromIndex: 1, toIndex: 0 },
    { card: roundState.enemyRow[1], fromIndex: 3, toIndex: 1 },
]);
assert.deepEqual(roundTransition.arrivals, [
    { card: refillTwo, index: 3 }, { card: refillOne, index: 2 },
]);

const sparseRow = {
    enemyRow: [null, { suit: 0, rank: 3 }, null, { suit: 1, rank: 6 }],
    enemyDeck: [refillOne, refillTwo],
};
assert.deepEqual(compactEnemyRow(sparseRow), [
    { card: sparseRow.enemyRow[0], fromIndex: 1, toIndex: 0 },
    { card: sparseRow.enemyRow[1], fromIndex: 3, toIndex: 1 },
]);
assert.deepEqual(refillEnemyRow(sparseRow), [
    { card: refillTwo, index: 3 }, { card: refillOne, index: 2 },
]);
console.log('Card Capture deck, actions, and win/loss rules passed');

const fakeCommand = { _quit() {}, _menu() {} };
const captureController = new CaptureGame(fakeCommand);
captureController.view.draw = () => {};
const flightBatches = [];
const slideBatches = [];
const bannerTransitions = [];
captureController.animateBanner = (text, done, holdMs = 0) => {
    bannerTransitions.push({ text, holdMs });
    captureController.bannerText = text;
    captureController.animating = false;
    done();
};
captureController.runFlights = (moves, { onStart, onLand, done }) => {
    flightBatches.push(moves);
    moves.forEach((move, index) => {
        onStart(move, index);
        onLand(move, index);
    });
    captureController.animating = false;
    done();
};
captureController.animateSlide = (moves, _area, done) => {
    slideBatches.push(moves);
    done();
};
captureController.start();
assert.equal(captureController.state.hand.length, 4);
assert.equal(captureController.state.round, 1);
assert.equal(captureController.state.enemyRow.filter(Boolean).length, 4);
assert.equal(captureController.phase, 'discard');
assert.deepEqual(bannerTransitions, [
    { text: '敵方階段', holdMs: 500 },
    { text: '抽棄階段', holdMs: 0 },
]);
captureController.phase = 'capture';
captureController.focus = 'row';
captureController.key('\x1b[D');
assert.equal(captureController.rowCursor, 1);
captureController.key('\x1b[C');
assert.equal(captureController.rowCursor, 0);
flightBatches.length = 0;
slideBatches.length = 0;
captureController.state = {
    round: 1, personalDeck: [{ suit: 0, rank: 4 }], personalDiscard: [],
    hand: [{ suit: 0, rank: 3 }, { suit: 1, rank: 2 }],
    enemyDeck: [], enemyRow: [{ suit: 0, rank: 3 }, null, null, null], enemyCapture: [],
};
captureController.phase = 'discard';
captureController.key('\x1b[C');
assert.equal(captureController.handCursor, 1);
captureController.key('\x1b[D');
assert.equal(captureController.handCursor, 0);
captureController.state.hand = [{ suit: 0, rank: 2 }, { suit: 0, rank: 3 }];
captureController.handCursor = 3;
captureController.key('\x1b[D');
assert.equal(captureController.handCursor, 1);
captureController.handCursor = 3;
captureController.phase = 'capture';
captureController.focus = 'hand';
captureController.action = 'capture';
captureController.key(' ');
assert.equal(captureController.handCursor, 1);
assert.equal(captureController.selection.has(3), false);
assert.equal(captureController.selection.has(1), true);
captureController.handCursor = 0;
captureController.phase = 'discard';
captureController.focus = 'hand';
captureController.state.hand = [{ suit: 0, rank: 3 }, { suit: 1, rank: 2 }];
captureController.selection.clear();
captureController.key(' ');
captureController.key('\r');
assert.equal(captureController.phase, 'actionOptions');
assert.deepEqual(captureController.state.hand.map(card => card.rank), [2, 4, 3]);
assert.equal(bannerTransitions[2].text, '行動階段');
assert.equal(flightBatches[0].length, 1);
assert.equal(slideBatches.length, 1);
assert.equal(flightBatches[1].length, 1);
assert.equal(flightBatches[2].length, 2);
captureController.key('\x1b[C');
assert.equal(captureController.actionCursor, 1);
captureController.key('\r');
assert.equal(captureController.phase, 'capture');
assert.equal(captureController.action, 'sacrifice');
captureController.key('\x1B');
assert.equal(captureController.phase, 'actionOptions');
assert.equal(captureController.actionCursor, 1);
captureController.key('\x1b[D');
captureController.key('\x1b[D');
assert.equal(captureController.actionCursor, 0);
captureController.key('\x1b[D');
assert.equal(captureController.actionCursor, 0);
captureController.key('\x1b[C');
captureController.key('\x1b[C');
captureController.key('\x1b[C');
assert.equal(captureController.actionCursor, 2);
captureController.key('\x1b[D');
captureController.key('\x1b[D');
captureController.key('\r');
assert.equal(captureController.action, 'capture');
captureController.key('\r');
captureController.key('\x1b[C');
captureController.key('\x1b[C');
captureController.key(' ');
captureController.key('\r');
assert.equal(captureController.result, 'win');
assert.equal(captureController.phase, 'winSummary');
assert.deepEqual(captureController.actionCounts, { captures: 1, sacrifices: 0, yields: 0 });
assert.equal(captureController.capturedTargets.size, 0);
assert.equal(flightBatches[3].length, 2);
captureController.key('\r');
assert.equal(captureController.phase, 'discard');
assert.deepEqual(captureController.actionCounts, { captures: 0, sacrifices: 0, yields: 0 });
const continuingState = {
    round: captureController.state.round, personalDeck: [], personalDiscard: [],
    hand: [{ suit: 0, rank: 2 }], enemyDeck: [],
    enemyRow: [{ suit: 1, rank: 5 }, null, null, null], enemyCapture: [],
};
captureController.finishAction(continuingState);
assert.deepEqual(bannerTransitions.slice(-2).map(transition => transition.text), ['敵方階段', '抽棄階段']);
assert.equal(captureController.phase, 'discard');
captureController.state = {
    round: captureController.state.round, personalDeck: [], personalDiscard: [],
    hand: [{ suit: 0, rank: 2 }], enemyDeck: [],
    enemyRow: [{ suit: 1, rank: 11 }, null, null, null], enemyCapture: [],
};
captureController.phase = 'actionOptions';
captureController.actionCursor = 2;
captureController.key('\r');
assert.equal(captureController.action, 'yield');
assert.equal(captureController.focus, 'hand');
captureController.key(' ');
captureController.key('\r');
assert.equal(captureController.result, 'loss');
assert.equal(captureController.actionCounts.yields, 1);
captureController.result = null;
captureController.phase = 'capture';
captureController.state = {
    round: 2, personalDeck: [], personalDiscard: [],
    hand: [{ suit: 0, rank: 2 }, { suit: 1, rank: 3 }],
    enemyDeck: [], enemyRow: [{ suit: 2, rank: 5 }, null, null, null], enemyCapture: [],
};
captureController.action = 'sacrifice';
captureController.selection = new Set([0, 1]);
const animateBanner = captureController.animateBanner;
captureController.animateBanner = () => {};
captureController.performSacrifice();
captureController.animateBanner = animateBanner;
assert.deepEqual(captureController.actionCounts, { captures: 1, sacrifices: 1, yields: 1 });
captureController.dispose();
console.log('Card Capture action selector and keyboard flow passed');

const rosterController = new CaptureGame(fakeCommand);
rosterController.view.draw = () => {};
rosterController.state = {
    round: 1, personalDeck: [], personalDiscard: [],
    hand: [{ suit: 0, rank: 2 }, { suit: 0, rank: 3 }, { suit: 0, rank: 4 }, { suit: 0, rank: 4 }],
    enemyDeck: [], enemyRow: [{ suit: 0, rank: 11 }, null, null, null], enemyCapture: [],
};
rosterController.phase = 'capture';
rosterController.action = 'capture';
rosterController.selection = new Set([0, 1, 2, 3]);
rosterController.runFlights = (moves, { onStart, onLand, done }) => {
    moves.forEach((move, index) => {
        onStart(move, index);
        onLand(move, index);
    });
    done();
};
rosterController.performCapture();
assert.deepEqual([...rosterController.capturedTargets], ['0:11']);
rosterController.stopAnimations = () => {};
rosterController.startEnemyPhase = () => {};
rosterController.animateBanner = (_text, done) => done();
rosterController.capturedTargets.add('1:12');
rosterController.start();
assert.equal(rosterController.capturedTargets.size, 0);
rosterController.dispose();
console.log('Card Capture target roster tracking passed');
