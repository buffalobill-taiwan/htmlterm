import { Tile } from '../tiles.js';

// ===== Helper Functions =====
const ALL_TILE_TYPES = (function() {
    const tiles = [];
    for (const suit of ['man', 'pin', 'sou']) {
        for (let v = 1; v <= 9; v++) tiles.push(new Tile(suit, v));
    }
    for (let v = 1; v <= 7; v++) tiles.push(new Tile('honor', v));
    return tiles;
})();

function getCounts(tiles) {
    const m = {};
    for (const t of tiles) m[t.key()] = (m[t.key()] || 0) + 1;
    return m;
}

function removeTiles(tiles, key, n) {
    const r = [];
    let rem = n;
    for (const t of tiles) {
        if (rem > 0 && t.key() === key) { rem--; }
        else { r.push(t); }
    }
    return r;
}

function key(suit, value) {
    return suit + value;
}

function findTile(tiles, suit, value) {
    for (const t of tiles) {
        if (t.suit === suit && t.value === value) return t;
    }
    return null;
}

function hasTile(counts, suit, value) {
    return (counts[key(suit, value)] || 0) > 0;
}

// ===== Dora =====
function nextDoraTile(tile) {
    if (tile.suit === 'man' || tile.suit === 'pin' || tile.suit === 'sou') {
        return new Tile(tile.suit, tile.value === 9 ? 1 : tile.value + 1);
    }
    if (tile.value <= 4) {
        return new Tile('honor', tile.value === 4 ? 1 : tile.value + 1);
    }
    const d = { 5: 6, 6: 7, 7: 5 };
    return new Tile('honor', d[tile.value]);
}

function countDora(tiles, doraIndicators) {
    if (!doraIndicators || doraIndicators.length === 0) return 0;
    const counts = getCounts(tiles);
    let dora = 0;
    for (const ind of doraIndicators) {
        const doraT = nextDoraTile(ind);
        dora += counts[doraT.key()] || 0;
    }
    return dora;
}

// Closed-hand eligibility shared by yaku and fu calculations.
function isMenzen(melds) {
    return melds.every(m => !m.open);
}

function getDoraCount(tiles, doraIndicators) {
    return countDora(tiles, doraIndicators);
}

export {
    getCounts, removeTiles, key, ALL_TILE_TYPES, isMenzen, countDora, findTile, hasTile,
    nextDoraTile, getDoraCount,
};
