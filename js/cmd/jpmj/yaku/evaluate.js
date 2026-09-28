import { Tile } from '../tiles.js';
import { checkChiitoitsuDecomp, checkKokushiDecomp, findDecompositionsWithOpen } from './decompose.js';
import { checkAllYaku, checkStandaloneYaku } from './checkers.js';
import { countDora } from './tiles.js';
import { calculateFu, calculatePayments } from './scoring.js';

// ===== Main Evaluation =====
function evaluateHand(hand, openMelds, winTile, winType, gameState) {
    let allTiles;
    if (winTile) {
        allTiles = hand.concat([winTile]);
    } else {
        allTiles = hand.slice();
    }
    allTiles = Tile.sortTiles(allTiles);

    const candidates = [];

    const chiitoitsu = checkChiitoitsuDecomp(allTiles);
    if (chiitoitsu && openMelds.length === 0) {
        const handInfo = {
            melds: [],
            pair: null,
            hand: allTiles,
            tiles: allTiles,
            isChiitoitsu: true,
            isKokushi: false,
        };
        const yaku = checkAllYaku(handInfo, { ...gameState, winType, winTile });
        const standaloneYaku = checkStandaloneYaku(handInfo, { ...gameState, winType, winTile });
        const fu = 25;
        const doraHan = gameState && gameState.doraIndicators ? countDora(allTiles, gameState.doraIndicators) : 0;
        const uraDoraHan = gameState && gameState.uraDoraIndicators && gameState.isRiichi ? countDora(allTiles, gameState.uraDoraIndicators) : 0;
        const totalHan = yaku.reduce((s, y) => s + y.han, 0) + doraHan + uraDoraHan;
        handInfo.yaku = yaku;
        handInfo.standaloneYaku = standaloneYaku;
        handInfo.fu = fu;
        handInfo.totalHan = totalHan;
        handInfo.doraHan = doraHan;
        handInfo.uraDoraHan = uraDoraHan;
        candidates.push(handInfo);
    }

    const kokushi = checkKokushiDecomp(allTiles);
    if (kokushi && openMelds.length === 0) {
        const handInfo = {
            melds: [],
            pair: kokushi.pair,
            hand: allTiles,
            tiles: allTiles,
            isChiitoitsu: false,
            isKokushi: true,
        };
        const yaku = checkAllYaku(handInfo, { ...gameState, winType, winTile });
        const standaloneYaku = checkStandaloneYaku(handInfo, { ...gameState, winType, winTile });
        const fu = 20;
        const doraHan = 0;
        const totalHan = yaku.reduce((s, y) => s + y.han, 0) + doraHan;
        handInfo.yaku = yaku;
        handInfo.standaloneYaku = standaloneYaku;
        handInfo.fu = fu;
        handInfo.totalHan = totalHan;
        handInfo.doraHan = doraHan;
        handInfo.uraDoraHan = 0;
        candidates.push(handInfo);
    }

    const decomps = findDecompositionsWithOpen(allTiles, openMelds);
    for (const decomp of decomps) {
        const handInfo = {
            melds: decomp.melds,
            pair: decomp.pair,
            hand: allTiles,
            tiles: allTiles,
            isChiitoitsu: false,
            isKokushi: false,
        };
        const yaku = checkAllYaku(handInfo, { ...gameState, winType, winTile });
        const standaloneYaku = checkStandaloneYaku(handInfo, { ...gameState, winType, winTile });
        const fu = calculateFu(handInfo, { ...gameState, winType, winTile });
        const meldTiles = openMelds.flatMap(m => m.tiles);
        const allTilesForDora = allTiles.concat(meldTiles);
        const doraHan = gameState && gameState.doraIndicators ? countDora(allTilesForDora, gameState.doraIndicators) : 0;
        const uraDoraHan = gameState && gameState.uraDoraIndicators && gameState.isRiichi ? countDora(allTilesForDora, gameState.uraDoraIndicators) : 0;
        const totalHan = yaku.reduce((s, y) => s + y.han, 0) + doraHan + uraDoraHan;
        handInfo.yaku = yaku;
        handInfo.standaloneYaku = standaloneYaku;
        handInfo.fu = fu;
        handInfo.totalHan = totalHan;
        handInfo.doraHan = doraHan;
        handInfo.uraDoraHan = uraDoraHan;
        candidates.push(handInfo);
    }

    const validCandidates = candidates.filter(c => c.standaloneYaku.length > 0);
    if (validCandidates.length === 0) return null;

    validCandidates.sort((a, b) => {
        if (a.totalHan !== b.totalHan) return b.totalHan - a.totalHan;
        return b.fu - a.fu;
    });

    const best = validCandidates[0];
    const payments = calculatePayments(best, { ...gameState, winType, winTile });
    const isYakuman = best.yaku.some(y => y.isYakuman);

    return {
        yaku: best.yaku,
        totalHan: best.totalHan,
        fu: best.fu,
        melds: best.melds,
        pair: best.pair,
        payments,
        isYakuman,
        doraHan: best.doraHan,
        uraDoraHan: best.uraDoraHan || 0,
    };
}

export { evaluateHand };
