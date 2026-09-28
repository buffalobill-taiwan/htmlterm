import { detectWaitTypeSimple } from './decompose.js';
import { isMenzen, getCounts, removeTiles } from './tiles.js';
import { Tile } from '../tiles.js';

function checkDaisangen(handInfo, gameState) {
    let count = 0;
    for (const m of handInfo.melds) {
        if ((m.type === 'triplet' || m.type === 'kan') && m.tiles[0].isSangen) count++;
    }
    return count === 3 ? [{ name: '大三元', han: 13, isYakuman: true }] : [];
}

function checkSuuankou(handInfo, gameState) {
    if (handInfo.isKokushi || handInfo.isChiitoitsu) return [];
    let closedTriplets = 0;
    for (const m of handInfo.melds) {
        if ((m.type === 'triplet' || m.type === 'kan') && !m.open) {
            closedTriplets++;
        }
    }

    const waitType = detectWaitTypeSimple(handInfo.hand || [], handInfo.melds, handInfo.pair, gameState ? gameState.winTile : null);

    if (gameState && gameState.winType === 'ron' && waitType === 'shanpon') {
        closedTriplets--;
    }

    if (closedTriplets === 4) {
        if (waitType === 'tanki') return [{ name: '四暗刻単騎', han: 26, isYakuman: true }];
        return [{ name: '四暗刻', han: 13, isYakuman: true }];
    }
    return [];
}

function checkTsuuiisou(handInfo, gameState) {
    const allTiles = [...(handInfo.hand || handInfo.tiles), ...handInfo.melds.flatMap(m => m.tiles)];
    if (allTiles.every(t => t.isHonor)) {
        return [{ name: '字一色', han: 13, isYakuman: true }];
    }
    return [];
}

function checkRyuuiisou(handInfo, gameState) {
    const allTiles = [...(handInfo.hand || handInfo.tiles), ...handInfo.melds.flatMap(m => m.tiles)];
    const greenKeys = ['sou2', 'sou3', 'sou4', 'sou6', 'sou8', 'honor6'];
    if (allTiles.every(t => greenKeys.includes(t.key()))) {
        return [{ name: '緑一色', han: 13, isYakuman: true }];
    }
    return [];
}

function checkChinroutou(handInfo, gameState) {
    const allTiles = [...(handInfo.hand || handInfo.tiles), ...handInfo.melds.flatMap(m => m.tiles)];
    if (allTiles.every(t => t.isTerminal && !t.isHonor)) {
        return [{ name: '清老頭', han: 13, isYakuman: true }];
    }
    return [];
}

function checkChuurenPoutou(handInfo, gameState) {
    if (!isMenzen(handInfo.melds)) return [];
    const allTiles = Tile.sortTiles([...(handInfo.hand || handInfo.tiles)]);
    const suit = allTiles[0].suit;
    if (suit === 'honor') return [];
    if (!allTiles.every(t => t.suit === suit)) return [];

    const counts = getCounts(allTiles);
    if ((counts[suit + 1] || 0) < 3 || (counts[suit + 9] || 0) < 3) return [];
    for (let v = 2; v <= 8; v++) {
        if ((counts[suit + v] || 0) < 1) return [];
    }

    const winTile = gameState ? gameState.winTile : null;
    if (winTile) {
        const handBefore = removeTiles(allTiles, winTile.key(), 1);
        const cBefore = getCounts(handBefore);
        if (cBefore[suit + 1] === 3 && cBefore[suit + 9] === 3) {
            let junsei = true;
            for (let v = 2; v <= 8; v++) if (cBefore[suit + v] !== 1) junsei = false;
            if (junsei) return [{ name: '純正九蓮宝燈', han: 26, isYakuman: true }];
        }
    }

    return [{ name: '九蓮宝燈', han: 13, isYakuman: true }];
}

function checkSuukantsu(handInfo, gameState) {
    let kans = 0;
    for (const m of handInfo.melds) {
        if (m.type === 'kan') kans++;
    }
    return kans === 4 ? [{ name: '四槓子', han: 13, isYakuman: true }] : [];
}

function checkDaisuushii(handInfo, gameState) {
    const windValues = new Set();
    for (const m of handInfo.melds) {
        if ((m.type === 'triplet' || m.type === 'kan') && m.tiles[0].isWind) {
            windValues.add(m.tiles[0].value);
        }
    }
    return (windValues.has(1) && windValues.has(2) && windValues.has(3) && windValues.has(4))
        ? [{ name: '大四喜', han: 13, isYakuman: true }] : [];
}

function checkShousuushii(handInfo, gameState) {
    const windValues = new Set();
    for (const m of handInfo.melds) {
        if ((m.type === 'triplet' || m.type === 'kan') && m.tiles[0].isWind) {
            windValues.add(m.tiles[0].value);
        }
    }
    if (windValues.size !== 3) return [];
    const pair = handInfo.pair;
    if (pair && pair.isWind && !windValues.has(pair.value)) {
        return [{ name: '小四喜', han: 13, isYakuman: true }];
    }
    return [];
}

function checkTenhou(handInfo, gameState) {
    if (gameState && gameState.isTenhou) {
        return [{ name: '天和', han: 13, isYakuman: true }];
    }
    return [];
}

function checkChiihou(handInfo, gameState) {
    if (gameState && gameState.isChiihou) {
        return [{ name: '地和', han: 13, isYakuman: true }];
    }
    return [];
}

function checkKokushi(handInfo, gameState) {
    if (handInfo.isKokushi) {
        return [{ name: '国士無双', han: 13, isYakuman: true }];
    }
    return [];
}

export {
    checkKokushi, checkDaisangen, checkSuuankou, checkTsuuiisou, checkRyuuiisou, checkChinroutou,
    checkChuurenPoutou, checkSuukantsu, checkDaisuushii, checkShousuushii, checkTenhou,
    checkChiihou,
};
