// Scoundrel rules: DOM-free state machine shared by the controller, view and
// offline tests. Card shape is the same { suit, rank } used by the other card
// games (suit 0=♠ 1=♥ 2=♦ 3=♣, rank 1=A .. 13=K).

export const MAX_HP = 20;
export const ROOM_SIZE = 4;
export const PLAY_PER_ROOM = 3;

export const cardValue = card => card.rank === 1 ? 14 : card.rank;
export const isMonster = card => card.suit === 0 || card.suit === 3;
export const cardLabel = card => '♠♥♦♣'[card.suit] + ['', 'Ａ', '２', '３', '４', '５', '６', '７', '８', '９', '10', 'Ｊ', 'Ｑ', 'Ｋ'][card.rank];

export function shuffled(cards, rng) {
    const result = cards.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// 44 cards: all 26 black monsters, ♦2–10 weapons and ♥2–10 potions.
export function createDungeon(rng = Math.random) {
    const cards = [];
    for (let suit = 0; suit < 4; suit++) {
        const red = suit === 1 || suit === 2;
        for (let rank = 1; rank <= 13; rank++) {
            if (red && (rank === 1 || rank > 10)) continue;
            cards.push({ suit, rank });
        }
    }
    return shuffled(cards, rng);
}

export function copyState(state) {
    return {
        ...state,
        dungeon: state.dungeon.slice(),
        room: state.room.slice(),
        discard: state.discard.slice(),
        slain: state.slain.slice(),
        weapon: state.weapon ? { ...state.weapon } : null,
        stats: { ...state.stats },
    };
}

export function createGame(rng = Math.random) {
    return {
        dungeon: createDungeon(rng),
        room: [],
        discard: [],
        slain: [],
        weapon: null,
        hp: MAX_HP,
        potionUsed: false,
        resolved: 0,
        roomNo: 0,
        lastFled: false,
        phase: 'playing',
        score: 0,
        lastAction: null,
        stats: {
            rooms: 0, cardsPlayed: 0, monstersSlain: 0, highestKill: 0,
            weaponsEquipped: 0, potionsDrunk: 0, potionsWasted: 0,
            hpHealed: 0, damageBare: 0, damageWeapon: 0, damageTaken: 0, flees: 0,
        },
    };
}

function draw(state, count) {
    const drawn = [];
    while (drawn.length < count && state.dungeon.length) drawn.push(state.dungeon.pop());
    return drawn;
}

export function dealInitialRoom(state) {
    const drawn = draw(state, ROOM_SIZE);
    state.room.push(...drawn);
    state.roomNo = 1;
    state.stats.rooms = 1;
    return drawn;
}

export function beginNextRoom(state) {
    state.resolved = 0;
    state.potionUsed = false;
    state.lastFled = false;
    const drawn = draw(state, Math.max(0, ROOM_SIZE - state.room.length));
    state.room.push(...drawn);
    if (drawn.length) {
        state.roomNo++;
        state.stats.rooms++;
    }
    return drawn;
}

// A flee is only offered while the room is untouched (all four cards present)
// and the previous room was not fled, so you cannot flee twice in a row.
export function canFlee(state) {
    return state.phase === 'playing' && !state.lastFled &&
        state.resolved === 0 && state.room.length === ROOM_SIZE &&
        state.dungeon.length > 0;
}

// Put the four untouched room cards at the bottom of the dungeon, then deal a
// fresh room of four. `draw()` pops from the tail, so the bottom is the front:
// unshift keeps room[0] as the deepest card. Returns the newly drawn cards.
export function fleeRoom(state) {
    if (!canFlee(state)) return null;
    const returned = state.room.slice();
    state.dungeon.unshift(...returned);
    state.room = [];
    state.resolved = 0;
    state.potionUsed = false;
    state.lastFled = true;
    state.roomNo++;
    state.stats.rooms++;
    state.stats.flees++;
    const drawn = draw(state, ROOM_SIZE);
    state.room.push(...drawn);
    state.lastAction = { type: 'flee', returned, drawn };
    return drawn;
}

// A used weapon remains equipped but only works on monsters no stronger than
// its last kill. A fresh weapon (lastKill === null) can fight anything.
export function canUseWeapon(state, monsterValue) {
    return !!state.weapon &&
        (state.weapon.lastKill === null || monsterValue <= state.weapon.lastKill);
}

export function describeSlot(state, index) {
    const card = state.room[index];
    if (!card) return null;
    const value = cardValue(card);
    if (card.suit === 2) return { kind: 'weapon', card, value };
    if (card.suit === 1) return {
        kind: 'potion', card, value,
        healed: state.potionUsed ? 0 : Math.min(value, MAX_HP - state.hp),
        wasted: state.potionUsed,
    };
    return {
        kind: 'monster', card, value,
        canWeapon: canUseWeapon(state, value),
        weaponDamage: state.weapon ? Math.max(0, value - state.weapon.value) : 0,
        bareDamage: value,
    };
}

// Mutates `state`; returns the ordered events that drive animation and status.
export function applyChoice(state, index, mode = 'barehand') {
    if (state.phase !== 'playing') return null;
    const card = state.room[index];
    if (!card) return null;
    const value = cardValue(card);
    state.room.splice(index, 1);
    state.stats.cardsPlayed++;
    let event;

    if (card.suit === 2) {
        const previous = state.weapon;
        if (previous) state.discard.push(previous.card, ...state.slain);
        state.weapon = { card, value, lastKill: null };
        state.slain = [];
        state.stats.weaponsEquipped++;
        event = { type: 'equip', card, value };
    } else if (card.suit === 1) {
        if (!state.potionUsed) {
            const healed = Math.min(value, MAX_HP - state.hp);
            state.hp += healed;
            state.potionUsed = true;
            state.stats.potionsDrunk++;
            state.stats.hpHealed += healed;
            event = { type: 'heal', card, value, healed };
        } else {
            state.stats.potionsWasted++;
            event = { type: 'waste', card, value };
        }
        state.discard.push(card);
    } else {
        if (mode === 'weapon' && canUseWeapon(state, value)) {
            const damage = Math.max(0, value - state.weapon.value);
            state.weapon.lastKill = value;
            state.slain.push(card);
            state.stats.damageWeapon += damage;
            event = { type: 'fight', mode: 'weapon', card, value,
                weapon: state.weapon.value, damage, lastKill: value };
        } else {
            const damage = value;
            state.stats.damageBare += damage;
            state.discard.push(card);
            event = { type: 'fight', mode: 'barehand', card, value, damage };
        }
        state.hp = Math.max(0, state.hp - event.damage);
        state.stats.damageTaken += event.damage;
        state.stats.monstersSlain++;
        state.stats.highestKill = Math.max(state.stats.highestKill, value);
    }

    state.resolved++;
    state.lastAction = event;
    if (state.hp <= 0) {
        state.phase = 'lost';
        state.score = 0;
    } else if (!state.dungeon.length && !state.room.length) {
        state.phase = 'won';
        state.score = state.hp;
    }
    return [event];
}

export function remainingMonsters(state) {
    return [...state.dungeon, ...state.room].filter(isMonster);
}

export function remainingMonsterValue(state) {
    return remainingMonsters(state).reduce((sum, card) => sum + cardValue(card), 0);
}
