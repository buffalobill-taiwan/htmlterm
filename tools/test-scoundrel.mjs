import assert from 'node:assert/strict';
import { mulberry32 } from '../js/util/random.js';
import { setSystem } from '../js/system/sys.js';
import {
    MAX_HP, ROOM_SIZE, applyChoice, beginNextRoom, canFlee, canUseWeapon, cardValue,
    copyState, createDungeon, createGame, describeSlot, fleeRoom, remainingMonsterValue,
} from '../js/cmd/cardgames/scoundrel/rules.js';
import { showEffect } from '../js/cmd/cardgames/scoundrel/effect.js';
import { ScoundrelGame } from '../js/cmd/cardgames/scoundrel/ScoundrelGame.js';
import { FLEE_POSITION, ROOM_X, ROOM_Y } from '../js/cmd/cardgames/scoundrel/view.js';
import { SelectDialog, ShowDialog } from '../js/dialog/index.js';

const frames = new Map(), overlays = new Set(), cleanups = new Set();
let frameId = 0, clock = 0;
globalThis.requestAnimationFrame = cb => { frames.set(++frameId, cb); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const tick = time => {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(time);
};
const advance = ms => {
    const end = clock + ms;
    while (clock < end) { clock += 16; tick(clock); }
};
let lastVB = null;
setSystem({ term: {
    cols: 80, rows: 25, writeVB(vb) { lastVB = vb; }, markRowDirty() {},
    addOverlay: overlay => overlays.add(overlay),
    removeOverlay: overlay => overlays.delete(overlay),
} });

// --- rules -----------------------------------------------------------------
const deck = createDungeon(mulberry32(1));
assert.equal(deck.length, 44);
assert.equal(deck.filter(card => card.suit === 0 || card.suit === 3).length, 26);
assert.equal(deck.filter(card => card.suit === 1).length, 9);
assert.equal(deck.filter(card => card.suit === 2).length, 9);
assert.ok(!deck.some(card => (card.suit === 1 || card.suit === 2) &&
    (card.rank === 1 || card.rank > 10)));
assert.equal(cardValue({ suit: 0, rank: 1 }), 14);
assert.equal(cardValue({ suit: 3, rank: 13 }), 13);
assert.deepEqual(createDungeon(mulberry32(7)).map(c => `${c.suit}:${c.rank}`),
    createDungeon(mulberry32(7)).map(c => `${c.suit}:${c.rank}`));

const card = (suit, rank) => ({ suit, rank });
const fixture = (room, overrides = {}) => {
    const state = createGame(mulberry32(3));
    state.room = room.slice();
    state.dungeon = [card(0, 2)];
    Object.assign(state, overrides);
    return state;
};
let state = fixture([card(2, 7), card(0, 13), card(0, 12), card(3, 12)]);
const copy = copyState(state);
assert.notEqual(copy.room, state.room);
assert.notEqual(copy.stats, state.stats);
assert.equal(describeSlot(state, 0).kind, 'weapon');
assert.equal(describeSlot(state, 1).kind, 'monster');
assert.equal(describeSlot(state, 1).canWeapon, false);
applyChoice(state, 0);
assert.equal(state.weapon.value, 7);
assert.equal(canUseWeapon(state, 14), true);
let event = applyChoice(state, 0, 'weapon')[0];
assert.equal(event.damage, 6);
assert.equal(event.weapon, 7);
assert.equal(state.weapon.lastKill, 13);
assert.equal(canUseWeapon(state, 12), true);   // ≤ last kill is allowed
assert.equal(canUseWeapon(state, 14), false);
assert.equal(describeSlot(state, 0).canWeapon, true);
event = applyChoice(state, 0, 'weapon')[0];
assert.equal(event.damage, 5);
assert.equal(state.weapon.lastKill, 12);
assert.equal(canUseWeapon(state, 12), true);   // equal is allowed again
event = applyChoice(state, 0, 'barehand')[0];
assert.equal(event.mode, 'barehand');
assert.equal(event.damage, 12);
assert.equal(state.weapon.lastKill, 12);       // barehand does not change the ceiling
assert.equal(state.stats.highestKill, 13);
assert.equal(state.stats.monstersSlain, 3);
assert.equal(state.stats.damageTaken, 6 + 5 + 12);

state = fixture([card(1, 8), card(1, 5), card(0, 2), card(0, 2)], { hp: 15 });
event = applyChoice(state, 0)[0];
assert.equal(event.healed, 5);
assert.equal(state.hp, MAX_HP);
event = applyChoice(state, 0)[0];
assert.equal(event.type, 'waste');
assert.equal(state.hp, MAX_HP);
assert.equal(state.stats.potionsWasted, 1);
assert.equal(describeSlot(fixture([card(1, 5)], { hp: 19 }), 0).healed, 1);

state = fixture([card(0, 2)], { hp: 1, dungeon: [] });
applyChoice(state, 0, 'barehand');
assert.equal(state.phase, 'lost');
assert.equal(state.score, 0);
assert.equal(state.hp, 0);
state = fixture([card(0, 2)], { dungeon: [] });
applyChoice(state, 0, 'barehand');
assert.equal(state.phase, 'won');
assert.equal(state.score, 18);
assert.equal(remainingMonsterValue(state), 0);
state = fixture([card(0, 2)], {
    dungeon: [card(2, 3), card(1, 4), card(0, 5)], potionUsed: true, resolved: 3,
});
assert.equal(beginNextRoom(state).length, 3);
assert.equal(state.room.length, 4);
assert.equal(state.roomNo, 1);
assert.equal(state.stats.rooms, 1);
assert.equal(state.resolved, 0);
assert.equal(state.potionUsed, false);

// --- flee rule --------------------------------------------------------------
const deck4 = [card(0, 9), card(0, 8), card(0, 7), card(0, 6), card(0, 5)];
state = fixture([card(1, 3), card(2, 4), card(0, 2), card(3, 2)], {
    dungeon: deck4.slice(),
});
assert.equal(state.room.length, ROOM_SIZE);
assert.equal(canFlee(state), true);
const returned = state.room.slice();
const priorDeck = state.dungeon.slice();
const arrivals = fleeRoom(state);
assert.ok(arrivals.length);
// The four old cards go to the bottom (front) of the dungeon in room order.
assert.deepEqual(state.dungeon.slice(0, 4), returned);
// The fresh room was drawn off the tail; the rest of the deck is untouched.
assert.deepEqual(state.dungeon.slice(4), priorDeck.slice(0, priorDeck.length - arrivals.length));
assert.equal(state.room.length, ROOM_SIZE);
assert.equal(state.resolved, 0);
assert.equal(state.potionUsed, false);
assert.equal(state.lastFled, true);
assert.equal(state.roomNo, 1);
assert.equal(state.stats.rooms, 1);
assert.equal(state.stats.flees, 1);
assert.equal(state.lastAction.type, 'flee');
assert.equal(canFlee(state), false);   // cannot flee twice in a row
applyChoice(state, 0, 'barehand');
beginNextRoom(state);
assert.equal(state.lastFled, false);
assert.equal(canFlee(state), state.room.length === ROOM_SIZE);
assert.equal(fleeRoom(fixture([card(0, 2)], { dungeon: [] })), null);  // empty dungeon
assert.equal(fleeRoom(fixture([card(0, 2), card(0, 3)], { resolved: 1 })), null);

// --- transient effect box ---------------------------------------------------
const fakeCmd = {
    executionGuard: () => () => true,
    addCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); },
};
let completed = 0;
showEffect(fakeCmd, '測試特效', () => completed++);
assert.equal(overlays.size, 1);
assert.equal([...overlays][0].getCell(0, 0).ch, '┌');
tick(clock += 16);
tick(clock += 483);
assert.equal(completed, 0);
assert.equal(overlays.size, 1);
tick(clock += 32);
assert.equal(completed, 1);
assert.equal(overlays.size, 0);
completed = 0;
const cancelEffect = showEffect(fakeCmd, '取消測試', () => completed++);
assert.equal(overlays.size, 1);
cancelEffect();
assert.equal(overlays.size, 0);
assert.equal(completed, 0);

// --- controller -------------------------------------------------------------
let quits = 0, menus = 0, exits = 0;
const dialogs = [];
const cmd = {
    executionGuard: () => () => true,
    addCleanup: fn => { cleanups.add(fn); return () => cleanups.delete(fn); },
    openDialog(Class, key, options) {
        dialogs.push({ Class, key, options });
        return { close() { exits++; } };
    },
    _confirmQuit() { quits++; },
    _quit() { quits++; },
    _menu() { menus++; },
};
const game = new ScoundrelGame(cmd);
game.start(123);
assert.equal(game.phase, 'dealing');
assert.equal(game.state.room.length, 4);
// Divider fills row 9; gear cards start one row below it.
assert.equal(lastVB.getCell(9, 0).ch, '=');
assert.equal(lastVB.getCell(9, 79).ch, '=');
// Empty gear slots use CJK labels; a 3-cell box must stay 3 cells wide
// (bufWidth, not String.length) so the right border lands at x+5.
assert.equal(lastVB.getCell(11, 3).ch, '武');
assert.equal(lastVB.getCell(11, 4).ch, undefined);   // wide-char continuation
assert.equal(lastVB.getCell(11, 5).ch, ' ');
assert.equal(lastVB.getCell(11, 6).ch, '│');
advance(4000);
assert.equal(game.phase, 'choose');
assert.equal(game.hiddenRoom.size, 0);
assert.equal(overlays.size, 0);

game.key('ArrowRight');
assert.equal(game.cursor, 1);
game.key('Home');
assert.equal(game.cursor, 0);
game.state.room = [card(2, 7), card(0, 13), card(1, 5), card(3, 4)];
game.state.dungeon = [card(0, 2), card(0, 3), card(0, 4)];
game.cursor = 0;
game.key('\r');                                   // equip 7♦
advance(1200);
assert.equal(game.state.weapon.value, 7);
assert.equal(game.state.hp, 20);
game.cursor = 0;                                  // 7♦ left; K♠ is now slot 0
game.key('\r');                                   // both fight options legal
assert.equal(dialogs.length, 1);
assert.equal(dialogs[0].Class, SelectDialog);
assert.equal(dialogs[0].key, 'scoundrel-combat');
assert.equal(dialogs[0].options.options.length, 2);
assert.ok(dialogs[0].options.options[0].description.includes('扣 6 HP'));
dialogs[0].options.onSelect(0);
advance(1200);
assert.equal(game.state.weapon.lastKill, 13);
assert.equal(game.state.hp, 14);
assert.equal(game.state.resolved, 2);
assert.equal(game.phase, 'choose');

game.key('h');
assert.equal(dialogs.at(-1).Class, ShowDialog);
assert.equal(dialogs.at(-1).key, 'scoundrel-rules');
dialogs.at(-1).options.onExit();
assert.equal(game.dialog, null);

game.state.room = [card(0, 2)];
game.state.dungeon = [];
game.cursor = 0;
game.key('\r');
if (game.dialog) dialogs.at(-1).options.onSelect(1);   // barehand
advance(1200);
assert.equal(game.phase, 'won');
assert.equal(game.state.score, 12);
game.key('\r');
assert.equal(dialogs.at(-1).key, 'scoundrel-result');
assert.deepEqual(dialogs.at(-1).options.options, ['新遊戲', '回選單']);
dialogs.at(-1).options.onSelect(1);
assert.equal(menus, 1);
game.key('q');
assert.equal(quits, 1);
game.dispose();
assert.equal(exits, 0);
assert.equal(overlays.size, 0);
assert.equal(frames.size, 0);

const restarted = new ScoundrelGame(cmd);
restarted.start(5);
advance(4000);
restarted.state.phase = 'won';
restarted.phase = 'won';
restarted.key('\r');
dialogs.at(-1).options.onSelect(0);
assert.equal(restarted.phase, 'dealing');
restarted.dispose();
assert.equal(overlays.size, 0);
assert.equal(frames.size, 0);
assert.equal(cleanups.size, 0);

// A room refill's incoming cards must live in the main buffer, not only in the
// flight overlay: after landing, the slot shows a suit glyph rather than the
// empty placeholder. This regressed when the refill drew from the old state.
const refill = new ScoundrelGame(cmd);
refill.start(77);
advance(4000);
refill.state.resolved = 3;
refill.state.room = [card(0, 5)];
refill.state.dungeon = [card(2, 6), card(1, 7), card(3, 8)];
refill.cursor = 0;
refill.phase = 'choose';
refill.dealNextRoom();
assert.equal(refill.hiddenRoom.size, 3);
assert.equal(lastVB.getCell(ROOM_Y + 1, ROOM_X[1] + 1).ch, ' ');  // placeholder in flight
advance(4000);
assert.equal(refill.hiddenRoom.size, 0);
assert.equal(refill.phase, 'choose');
assert.ok('♠♥♦♣'.includes(lastVB.getCell(ROOM_Y + 1, ROOM_X[1] + 1).ch));
refill.dispose();
assert.equal(overlays.size, 0);
assert.equal(frames.size, 0);

// After drinking, the remaining potions in the room turn grey (fg 8) while
// other cards keep their normal red face (fg 1).
const dim = new ScoundrelGame(cmd);
dim.start(55);
advance(4000);
dim.state.room = [card(1, 5), card(1, 7), card(0, 3), card(0, 4)];
dim.state.potionUsed = true;
dim.draw();
assert.equal(lastVB.getCell(ROOM_Y + 1, ROOM_X[0] + 1).fg, 8);
assert.equal(lastVB.getCell(ROOM_Y + 1, ROOM_X[1] + 1).fg, 8);
dim.state.potionUsed = false;
dim.draw();
assert.equal(lastVB.getCell(ROOM_Y + 1, ROOM_X[0] + 1).fg, 1);
dim.dispose();

// The flee box sits to the right of the fourth card while the room is
// untouched; selecting it deals a fresh room and cannot be repeated.
const fleeGame = new ScoundrelGame(cmd);
fleeGame.start(99);
advance(4000);
assert.equal(fleeGame.phase, 'choose');
fleeGame.state.room = [card(0, 2), card(3, 3), card(1, 4), card(2, 5)];
fleeGame.state.dungeon = [card(0, 6), card(0, 7), card(0, 8), card(0, 9), card(0, 10)];
fleeGame.state.resolved = 0;
fleeGame.state.lastFled = false;
fleeGame.cursor = 0;
fleeGame.draw();
assert.equal(lastVB.getCell(FLEE_POSITION.y + 1, FLEE_POSITION.x + 1).ch, '逃');
// Unselected: white text on black (fg 7, bg 0).
assert.equal(lastVB.getCell(FLEE_POSITION.y + 1, FLEE_POSITION.x).fg, 7);
assert.equal(lastVB.getCell(FLEE_POSITION.y + 1, FLEE_POSITION.x).bg, 0);
fleeGame.key('End');
assert.equal(fleeGame.cursor, 4);   // room.length -> the flee option
assert.equal(lastVB.getCell(FLEE_POSITION.y - 1, FLEE_POSITION.x + 2).ch, '▼');
// Selected: black text on yellow (fg 0, bg 3) across the whole box.
assert.equal(lastVB.getCell(FLEE_POSITION.y, FLEE_POSITION.x).fg, 0);
assert.equal(lastVB.getCell(FLEE_POSITION.y + 1, FLEE_POSITION.x).fg, 0);
assert.equal(lastVB.getCell(FLEE_POSITION.y + 2, FLEE_POSITION.x).bg, 3);
fleeGame.key('\r');
assert.equal(fleeGame.phase, 'dealing');
assert.equal(fleeGame.hiddenRoom.size, 4);
advance(4000);
assert.equal(fleeGame.phase, 'choose');
assert.equal(fleeGame.hiddenRoom.size, 0);
assert.equal(fleeGame.state.lastFled, true);
assert.equal(fleeGame.state.stats.flees, 1);
assert.equal(canFlee(fleeGame.state), false);
assert.notEqual(lastVB.getCell(FLEE_POSITION.y + 1, FLEE_POSITION.x + 1).ch, '逃');
fleeGame.dispose();
assert.equal(overlays.size, 0);
assert.equal(frames.size, 0);

setSystem(null);
console.log('Scoundrel rules, effect box and settlement flow passed');
