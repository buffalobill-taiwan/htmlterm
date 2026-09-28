import { isMenzen } from './tiles.js';
import { detectWaitTypeSimple } from './decompose.js';

function checkRiichi(handInfo, gameState) {
    if (gameState && gameState.isDoubleRiichi) return [];
    return (gameState && gameState.isRiichi) ? [{ name: '立直', han: 1 }] : [];
}

function checkIppatsu(handInfo, gameState) {
    return (gameState && gameState.isIppatsu) ? [{ name: '一発', han: 1 }] : [];
}

function checkMenzenTsumo(handInfo, gameState) {
    if (gameState && gameState.winType === 'tsumo' && isMenzen(handInfo.melds)) {
        return [{ name: '門前清自摸和', han: 1 }];
    }
    return [];
}

function checkPinfu(handInfo, gameState) {
    const { melds } = handInfo;
    if (!isMenzen(melds)) return [];
    for (const m of melds) {
        if (m.type !== 'sequence') return [];
    }
    const pair = handInfo.pair;
    if (!pair) return [];

    if (pair.isSangen) return [];
    if (pair.isWind) {
        if (gameState) {
            if (pair.value === (gameState.seatWind || 0)) return [];
            if (pair.value === (gameState.roundWind || 0)) return [];
        } else {
            return [];
        }
    }

    const waitType = detectWaitTypeSimple(handInfo.hand, melds, pair, gameState ? gameState.winTile : null);
    if (waitType !== 'ryanmen') return [];
    return [{ name: '平和', han: 1 }];
}

function checkTanyao(handInfo, gameState) {
    for (const m of handInfo.melds) {
        for (const t of m.tiles) {
            if (t.isTerminal) return [];
        }
    }
    if (handInfo.pair && handInfo.pair.isTerminal) return [];
    if (handInfo.pair === null && handInfo.isChiitoitsu) return [];
    return [{ name: '断么九', han: 1 }];
}

function checkIipeikou(handInfo, gameState) {
    if (!isMenzen(handInfo.melds)) return [];
    if (checkRyanpeikou(handInfo, gameState).length > 0) return [];
    const seqs = handInfo.melds.filter(m => m.type === 'sequence');
    if (seqs.length < 2) return [];
    for (let i = 0; i < seqs.length; i++) {
        for (let j = i + 1; j < seqs.length; j++) {
            const a = seqs[i].tiles;
            const b = seqs[j].tiles;
            if (a[0].equals(b[0]) && a[1].equals(b[1]) && a[2].equals(b[2])) {
                return [{ name: '一盃口', han: 1 }];
            }
        }
    }
    return [];
}

function checkRyanpeikou(handInfo, gameState) {
    if (!isMenzen(handInfo.melds)) return [];
    const seqs = handInfo.melds.filter(m => m.type === 'sequence');
    if (seqs.length < 4) return [];
    const used = new Array(seqs.length).fill(false);
    let pairs = 0;
    for (let i = 0; i < seqs.length; i++) {
        if (used[i]) continue;
        for (let j = i + 1; j < seqs.length; j++) {
            if (used[j]) continue;
            const a = seqs[i].tiles;
            const b = seqs[j].tiles;
            if (a[0].equals(b[0]) && a[1].equals(b[1]) && a[2].equals(b[2])) {
                used[i] = used[j] = true;
                pairs++;
                break;
            }
        }
    }
    return pairs === 2 ? [{ name: '二盃口', han: 3 }] : [];
}

function checkYakuhai(handInfo, gameState) {
    const yaku = [];
    for (const m of handInfo.melds) {
        if (m.type !== 'triplet' && m.type !== 'kan') continue;
        const t = m.tiles[0];
        if (!t.isHonor) continue;
        if (t.isSangen) {
            yaku.push({ name: t.name + ' (役牌)', han: 1 });
        } else if (t.isWind) {
            let isSeat = false, isRound = false;
            if (gameState && t.value === gameState.seatWind) isSeat = true;
            if (gameState && t.value === gameState.roundWind) isRound = true;
            if (isSeat && isRound) {
                yaku.push({ name: t.name + '風' + t.name, han: 2 });
            } else if (isSeat) {
                yaku.push({ name: t.name + '(自風)', han: 1 });
            } else if (isRound) {
                yaku.push({ name: t.name + '(門風)', han: 1 });
            }
        }
    }
    return yaku;
}

function checkSanshokuDoujun(handInfo, gameState) {
    for (let i = 0; i < handInfo.melds.length; i++) {
        if (handInfo.melds[i].type !== 'sequence') continue;
        const v = handInfo.melds[i].tiles[0].value;
        const suits = {};
        suits[handInfo.melds[i].tiles[0].suit] = true;
        for (let j = 0; j < handInfo.melds.length; j++) {
            if (i === j || handInfo.melds[j].type !== 'sequence') continue;
            if (handInfo.melds[j].tiles[0].value === v) {
                suits[handInfo.melds[j].tiles[0].suit] = true;
            }
        }
        if (suits.man && suits.pin && suits.sou) {
            const han = isMenzen(handInfo.melds) ? 2 : 1;
            return [{ name: '三色同順', han }];
        }
    }
    return [];
}

function checkIttsuu(handInfo, gameState) {
    for (const s of ['man', 'pin', 'sou']) {
        const seqs = handInfo.melds.filter(
            m => m.type === 'sequence' && m.tiles[0].suit === s
        );
        if (seqs.length < 3) continue;
        const vals = seqs.map(m => m.tiles[0].value);
        if (vals.includes(1) && vals.includes(4) && vals.includes(7)) {
            const han = isMenzen(handInfo.melds) ? 2 : 1;
            return [{ name: '一気通貫', han }];
        }
    }
    return [];
}

function checkChanta(handInfo, gameState) {
    if (handInfo.isKokushi || handInfo.isChiitoitsu) return [];
    if (checkJunchan(handInfo, gameState).length > 0) return [];
    for (const m of handInfo.melds) {
        let hasTerminal = false;
        for (const t of m.tiles) {
            if (t.isTerminal) { hasTerminal = true; break; }
        }
        if (!hasTerminal) return [];
    }
    if (!handInfo.pair || !handInfo.pair.isTerminal) return [];
    const han = isMenzen(handInfo.melds) ? 2 : 1;
    return [{ name: '混全帯么九', han }];
}

function checkJunchan(handInfo, gameState) {
    if (handInfo.isKokushi || handInfo.isChiitoitsu) return [];
    for (const m of handInfo.melds) {
        let hasTerm = false;
        for (const t of m.tiles) {
            if (t.isTerminal) { hasTerm = true; break; }
        }
        if (!hasTerm) return [];
        for (const t of m.tiles) {
            if (t.isHonor) return [];
        }
    }
    if (!handInfo.pair || handInfo.pair.isHonor || !handInfo.pair.isTerminal) return [];
    const han = isMenzen(handInfo.melds) ? 3 : 2;
    return [{ name: '純全帯么九', han }];
}

function checkToitoi(handInfo, gameState) {
    if (handInfo.isKokushi || handInfo.isChiitoitsu) return [];
    for (const m of handInfo.melds) {
        if (m.type !== 'triplet' && m.type !== 'kan') return [];
    }
    return [{ name: '対々和', han: 2 }];
}

function checkSanankou(handInfo, gameState) {
    if (handInfo.isKokushi || handInfo.isChiitoitsu) return [];
    let closedTriplets = 0;
    for (const m of handInfo.melds) {
        if ((m.type === 'triplet' || m.type === 'kan') && !m.open) closedTriplets++;
    }

    const waitType = detectWaitTypeSimple(handInfo.hand || [], handInfo.melds, handInfo.pair, gameState ? gameState.winTile : null);
    if (gameState && gameState.winType === 'ron' && waitType === 'shanpon') {
        closedTriplets--;
    }

    return closedTriplets >= 3 ? [{ name: '三暗刻', han: 2 }] : [];
}

function checkHonroutou(handInfo, gameState) {
    if (handInfo.isKokushi || handInfo.isChiitoitsu) return [];
    for (const m of handInfo.melds) {
        if (m.type === 'sequence') return [];
        for (const t of m.tiles) {
            if (!t.isTerminal) return [];
        }
    }
    if (handInfo.pair && !handInfo.pair.isTerminal) return [];
    return [{ name: '混老頭', han: 2 }];
}

function checkShousangen(handInfo, gameState) {
    let dragonTriplets = 0;
    let dragonPair = false;
    for (const m of handInfo.melds) {
        if ((m.type === 'triplet' || m.type === 'kan') && m.tiles[0].isSangen) {
            dragonTriplets++;
        }
    }
    if (handInfo.pair && handInfo.pair.isSangen) dragonPair = true;
    if (dragonTriplets === 2 && dragonPair) {
        return [{ name: '小三元', han: 2 }];
    }
    return [];
}

function checkSanshokuDoukou(handInfo, gameState) {
    for (let i = 0; i < handInfo.melds.length; i++) {
        if (handInfo.melds[i].type !== 'triplet' && handInfo.melds[i].type !== 'kan') continue;
        const v = handInfo.melds[i].tiles[0].value;
        const suits = {};
        suits[handInfo.melds[i].tiles[0].suit] = true;
        for (let j = 0; j < handInfo.melds.length; j++) {
            if (i === j || (handInfo.melds[j].type !== 'triplet' && handInfo.melds[j].type !== 'kan')) continue;
            if (handInfo.melds[j].tiles[0].value === v) {
                suits[handInfo.melds[j].tiles[0].suit] = true;
            }
        }
        if (suits.man && suits.pin && suits.sou) {
            return [{ name: '三色同刻', han: 2 }];
        }
    }
    return [];
}

function checkSankantsu(handInfo, gameState) {
    let kans = 0;
    for (const m of handInfo.melds) {
        if (m.type === 'kan' || m.type === 'chakan' || m.type === 'ankan') kans++;
    }
    return kans >= 3 ? [{ name: '三槓子', han: 2 }] : [];
}

function checkChiitoitsu(handInfo, gameState) {
    if (handInfo.isChiitoitsu) {
        return [{ name: '七対子', han: 2 }];
    }
    return [];
}

function checkHonitsu(handInfo, gameState) {
    const suits = {};
    const allTiles = [...(handInfo.hand || handInfo.tiles), ...handInfo.melds.flatMap(m => m.tiles)];
    for (const t of allTiles) {
        if (t.suit !== 'honor') suits[t.suit] = true;
    }
    if (Object.keys(suits).length === 1) {
        const hasHonors = allTiles.some(t => t.isHonor);
        if (hasHonors) {
            const han = isMenzen(handInfo.melds) ? 3 : 2;
            return [{ name: '混一色', han }];
        }
    }
    return [];
}

function checkChinitsu(handInfo, gameState) {
    const suits = {};
    const allTiles = [...(handInfo.hand || handInfo.tiles), ...handInfo.melds.flatMap(m => m.tiles)];
    for (const t of allTiles) {
        suits[t.suit] = true;
    }
    if (Object.keys(suits).length === 1 && !suits.honor) {
        const han = isMenzen(handInfo.melds) ? 6 : 5;
        return [{ name: '清一色', han }];
    }
    return [];
}

function checkDoubleRiichi(handInfo, gameState) {
    return (gameState && gameState.isDoubleRiichi) ? [{ name: 'ダブル立直', han: 2 }] : [];
}

function checkRinshanKaihou(handInfo, gameState) {
    return (gameState && gameState.isRinshan) ? [{ name: '嶺上開花', han: 1 }] : [];
}

function checkChankan(handInfo, gameState) {
    return (gameState && gameState.isChankan) ? [{ name: '槍槓', han: 1 }] : [];
}

function checkHaitei(handInfo, gameState) {
    return (gameState && gameState.isHaitei) ? [{ name: '海底摸月', han: 1 }] : [];
}

function checkHoutei(handInfo, gameState) {
    return (gameState && gameState.isHoutei) ? [{ name: '河底撈魚', han: 1 }] : [];
}

export {
    checkChiitoitsu, checkRiichi, checkDoubleRiichi, checkIppatsu, checkMenzenTsumo, checkPinfu,
    checkTanyao, checkIipeikou, checkRyanpeikou, checkYakuhai, checkSanshokuDoujun,
    checkSanshokuDoukou, checkIttsuu, checkChanta, checkJunchan, checkToitoi, checkSanankou,
    checkHonroutou, checkShousangen, checkSankantsu, checkHonitsu, checkChinitsu, checkHaitei,
    checkHoutei, checkRinshanKaihou, checkChankan,
};
