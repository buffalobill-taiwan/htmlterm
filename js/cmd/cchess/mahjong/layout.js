import { makeCell } from '../../../util/sgr.js';

export const TABLE_W = 54, SEAT_W = 24;
export const HAND_X = 4, DRAWN_X = 13;
export const DISCARD_X = 15, DISCARD_Y = 13, DISCARD_LABEL_Y = 11, DISCARD_COLS = 8;
export const WALL_X = DISCARD_X, WALL_Y = 6, WALL_COLS = 8;
export const BACK = makeCell('⬤', 10, 0, false, 2);
export const BACK_CONT = makeCell(' ', 10, 0, false, 0);

export const POSITIONS = [
    { x: 28, y: 17, label: '玩家' }, { x: 28, y: 2, label: '下家' },
    { x: 2, y: 2, label: '對家' }, { x: 2, y: 17, label: '上家' },
];

export function wallPosition(index) {
    return { x: WALL_X + (index % WALL_COLS) * 3, y: WALL_Y + Math.floor(index / WALL_COLS) };
}

export function discardPosition(index) {
    return { x: DISCARD_X + (index % DISCARD_COLS) * 3, y: DISCARD_Y + Math.floor(index / DISCARD_COLS) };
}

export function handPosition(state, seat, tileId) {
    const relative = (seat - state.human + 4) % 4;
    const { x, y } = POSITIONS[relative];
    let handIndex = 0;
    for (const tile of state.players[seat].hand) {
        const slot = tile.id === state.drawn ? DRAWN_X : handIndex++ * 3;
        if (tile.id === tileId) return { x: x + HAND_X + slot, y: y + 1 };
    }
    return null;
}

export function meldPosition(state, seat, tileIndex) {
    const relative = (seat - state.human + 4) % 4;
    const { x, y } = POSITIONS[relative];
    const meld = state.players[seat].melds[0];
    if (!meld || tileIndex < 0 || tileIndex >= meld.length) return null;
    const meldX = x + Math.floor((SEAT_W - (3 + meld.length * 3 - 1)) / 2);
    return { x: meldX + 3 + tileIndex * 3, y: y + 2 };
}

export function dealOrder(state) {
    const hands = state.players.map((player, seat) => player.hand.filter(tile =>
        seat !== state.dealer || tile.id !== state.drawn));
    const queue = [];
    for (let round = 0; round < 4; round++) {
        for (let offset = 0; offset < 4; offset++) {
            const seat = (state.dealer + offset) % 4;
            queue.push({ seat, tile: hands[seat][round] });
        }
    }
    queue.push({
        seat: state.dealer,
        tile: state.players[state.dealer].hand.find(tile => tile.id === state.drawn),
    });
    return queue;
}

export function tilePositions(state) {
    const positions = [];
    state.wall.forEach((tile, index) => positions.push({ tile, from: wallPosition(index) }));
    for (let seat = 0; seat < state.players.length; seat++) {
        const player = state.players[seat];
        for (const tile of player.hand) {
            positions.push({ tile, from: handPosition(state, seat, tile.id) });
        }
        player.melds.forEach((meld, meldIndex) => meld.forEach((tile, tileIndex) => {
            if (meldIndex === 0) positions.push({ tile, from: meldPosition(state, seat, tileIndex) });
        }));
    }
    state.discards.forEach((tile, index) => positions.push({ tile, from: discardPosition(index) }));
    return positions;
}
