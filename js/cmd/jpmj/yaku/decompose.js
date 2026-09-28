import { getCounts, removeTiles, key, ALL_TILE_TYPES } from './tiles.js';
import { Tile } from '../tiles.js';

// ===== Hand Decomposition =====
function decomposeMelds(tiles, numMelds) {
    if (numMelds === 0) return tiles.length === 0 ? [[]] : [];
    if (tiles.length < numMelds * 3) return [];

    const results = [];
    const first = tiles[0];
    if (!first) return [];
    const counts = getCounts(tiles);
    const fk = first.key();

    if ((counts[fk] || 0) >= 3) {
        const rem = removeTiles(removeTiles(removeTiles(tiles, fk, 1), fk, 1), fk, 1);
        for (const sub of decomposeMelds(rem, numMelds - 1)) {
            results.push([{ type: 'triplet', tiles: [first, first, first], open: false }, ...sub]);
        }
    }

    if (first.suit !== 'honor' && first.value <= 7) {
        const v = first.value;
        const k2 = key(first.suit, v + 1);
        const k3 = key(first.suit, v + 2);
        if ((counts[k2] || 0) > 0 && (counts[k3] || 0) > 0) {
            let r = removeTiles(tiles, fk, 1);
            r = removeTiles(r, k2, 1);
            r = removeTiles(r, k3, 1);
            const seq = [first, new Tile(first.suit, v + 1), new Tile(first.suit, v + 2)];
            for (const sub of decomposeMelds(r, numMelds - 1)) {
                results.push([{ type: 'sequence', tiles: seq, open: false }, ...sub]);
            }
        }
    }

    return results;
}

function findAllDecompositions(tiles) {
    const counts = getCounts(tiles);
    const results = [];
    const tried = {};

    for (const [k, c] of Object.entries(counts)) {
        if (c < 2 || tried[k]) continue;
        tried[k] = true;

        const pairTile = Tile.fromString(k[0] + k.slice(1));
        const rem = removeTiles(removeTiles(tiles, k, 1), k, 1);
        const meldSets = decomposeMelds(rem, 4);
        for (const melds of meldSets) {
            results.push({ melds, pair: pairTile });
        }
    }

    return results;
}

function findDecompositionsWithOpen(tiles, openMelds) {
    if (openMelds.length === 0) return findAllDecompositions(tiles);
    const closedOnly = tiles.slice();
    const neededMelds = 4 - openMelds.length;
    if (neededMelds < 0) return [];
    const counts = getCounts(closedOnly);
    const results = [];
    const tried = {};
    for (const [k, c] of Object.entries(counts)) {
        if (c < 2 || tried[k]) continue;
        tried[k] = true;
        const pairTile = Tile.fromString(k[0] + k.slice(1));
        const rem = removeTiles(removeTiles(closedOnly, k, 1), k, 1);
        const meldSets = decomposeMelds(rem, neededMelds);
        for (const melds of meldSets) {
            results.push({ melds: openMelds.concat(melds), pair: pairTile });
        }
    }
    return results;
}

// ===== Wait Type Detection =====
function detectWaitType(hand, melds, pair, winTile, winType) {
    let winInMeld = null;
    let winIsPair = false;

    if (pair.equals(winTile)) {
        winIsPair = true;
    } else {
        for (const m of melds) {
            for (const t of m.tiles) {
                if (t.equals(winTile)) {
                    winInMeld = m;
                    break;
                }
            }
            if (winInMeld) break;
        }
    }

    if (winIsPair) return 'tanki';
    if (!winInMeld) return 'unknown';

    if (winInMeld.type === 'triplet') return 'shanpon';

    const seq = winInMeld.tiles;
    const pos = seq.findIndex(t => t.equals(winTile));
    const v = seq[0].value;

    if (pos === 0) return (v === 1 || v === 2) ? 'penchan' : 'ryanmen';
    if (pos === 1) return 'kanchan';
    if (pos === 2) return (v === 7 || v === 8) ? 'penchan' : 'ryanmen';
    return 'unknown';
}

function detectWaitTypeSimple(hand, melds, pair, winTile) {
    if (pair.equals(winTile)) return 'tanki';
    for (const m of melds) {
        if (m.type === 'triplet' && m.tiles[0].equals(winTile)) {
            return 'shanpon';
        }
        if (m.type === 'sequence') {
            const idx = m.tiles.findIndex(t => t.equals(winTile));
            if (idx >= 0) {
                const v = m.tiles[0].value;
                if (idx === 0) {
                    if (v === 7) return 'penchan';
                    return 'ryanmen';
                } else if (idx === 1) {
                    return 'kanchan';
                } else {
                    if (v === 1) return 'penchan';
                    return 'ryanmen';
                }
            }
        }
    }
    return 'unknown';
}

// ===== Special Decompositions =====
function checkChiitoitsuDecomp(tiles) {
    const counts = getCounts(tiles);
    const keys = Object.keys(counts);
    if (keys.length !== 7) return null;
    for (const c of Object.values(counts)) {
        if (c !== 2) return null;
    }
    return { melds: [], pair: null, isChiitoitsu: true };
}

function checkKokushiDecomp(tiles) {
    const honors = [1, 2, 3, 4, 5, 6, 7].map(v => key('honor', v));
    const terminals = [];
    for (const s of ['man', 'pin', 'sou']) {
        terminals.push(key(s, 1));
        terminals.push(key(s, 9));
    }
    const allOrphans = [...terminals, ...honors];
    const counts = getCounts(tiles);
    const keys = Object.keys(counts);
    if (keys.length !== allOrphans.length) {
        const missing = allOrphans.filter(k => !counts[k]);
        const extra = keys.filter(k => !allOrphans.includes(k));
        if (extra.length > 0) return null;
        if (missing.length === 1 && keys.length === allOrphans.length - 1) {
            const dupTile = keys.find(k => counts[k] === 2);
            if (!dupTile) return null;
            for (const k of keys) {
                if (k !== dupTile && (!allOrphans.includes(k) || counts[k] !== 1)) return null;
            }
            return { melds: [], pair: Tile.fromString(dupTile[0] + dupTile.slice(1)), isKokushi: true };
        }
        if (missing.length === 0) {
            const dupTile = keys.find(k => counts[k] === 2);
            if (!dupTile) return null;
            if (keys.length !== allOrphans.length) return null;
            for (const k of allOrphans) {
                if (!counts[k] || counts[k] < 1 || counts[k] > 2) return null;
            }
            let dupCount = 0;
            for (const k of allOrphans) {
                if (counts[k] === 2) dupCount++;
            }
            if (dupCount !== 1) return null;
            return { melds: [], pair: Tile.fromString(dupTile[0] + dupTile.slice(1)), isKokushi: true };
        }
    } else {
        const dupTile = keys.find(k => counts[k] === 2);
        if (!dupTile) return null;
        for (const k of allOrphans) {
            if (!counts[k]) return null;
        }
        return { melds: [], pair: Tile.fromString(dupTile[0] + dupTile.slice(1)), isKokushi: true };
    }
    return null;
}

function canFormCompleteHand(hand, openMelds, winTile) {
    const allTiles = Tile.sortTiles(hand.concat([winTile]));
    if (openMelds.length === 0) {
        if (checkChiitoitsuDecomp(allTiles)) return true;
        if (checkKokushiDecomp(allTiles)) return true;
    }
    return findDecompositionsWithOpen(allTiles, openMelds).length > 0;
}

function isWinningHand(hand, openMelds) {
    const allTiles = Tile.sortTiles(hand);
    if (openMelds.length === 0) {
        const c = checkChiitoitsuDecomp(allTiles);
        if (c) return true;
        const k = checkKokushiDecomp(allTiles);
        if (k) return true;
    }
    const decomps = findDecompositionsWithOpen(allTiles, openMelds);
    return decomps.length > 0;
}

function getWaitingTiles(hand, openMelds) {
    const waits = [];
    for (const testTile of ALL_TILE_TYPES) {
        const testHand = hand.concat([testTile]);
        if (isWinningHand(testHand, openMelds)) {
            waits.push(testTile);
        }
    }
    return waits;
}

function checkTenpai(hand, openMelds) {
    return getWaitingTiles(hand, openMelds).length > 0;
}

export {
    detectWaitTypeSimple, checkChiitoitsuDecomp, checkKokushiDecomp, findDecompositionsWithOpen,
    decomposeMelds, findAllDecompositions, detectWaitType, canFormCompleteHand, isWinningHand,
    getWaitingTiles, checkTenpai,
};
