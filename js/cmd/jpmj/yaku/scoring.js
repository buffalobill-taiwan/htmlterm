import { isMenzen } from './tiles.js';
import { detectWaitTypeSimple } from './decompose.js';

// ===== Fu Calculation =====
function calculateFu(handInfo, gameState) {
    if (handInfo.isChiitoitsu) return 25;

    const { melds, pair } = handInfo;
    const isOpen = !isMenzen(melds);
    const winType = gameState ? gameState.winType : 'ron';
    const winTile = gameState ? gameState.winTile : null;

    let fu = 20;

    if (winType === 'ron' && !isOpen) {
        fu += 10;
    }

    if (winType === 'tsumo') {
        const isPinfuCheck = (() => {
            if (isOpen) return false;
            for (const m of melds) if (m.type !== 'sequence') return false;
            if (pair.isWind || pair.isSangen) return false;
            if (gameState) {
                if (pair.value === (gameState.seatWind || 0) || pair.value === (gameState.roundWind || 0)) return false;
            }
            return true;
        })();
        if (!isPinfuCheck) {
            fu += 2;
        }
    }

    if (pair) {
        if (pair.isSangen) {
            fu += 2;
        } else if (pair.isWind) {
            let windBonus = 0;
            if (gameState && pair.value === gameState.seatWind) windBonus += 2;
            if (gameState && pair.value === gameState.roundWind) windBonus += 2;
            fu += windBonus;
        }
    }

    for (const m of melds) {
        if (m.type === 'sequence') continue;
        const t = m.tiles[0];
        const isTerminal = t.isTerminal;
        const closed = !m.open;

        if (m.type === 'triplet') {
            if (closed && isTerminal) fu += 8;
            else if (closed) fu += 4;
            else if (isTerminal) fu += 4;
            else fu += 2;
        } else if (m.type === 'kan') {
            if (closed && isTerminal) fu += 32;
            else if (closed) fu += 16;
            else if (isTerminal) fu += 16;
            else fu += 8;
        }
    }

    if (winTile) {
        const waitType = detectWaitTypeSimple(handInfo.hand || [], melds, pair, winTile);
        if (waitType === 'tanki' || waitType === 'kanchan' || waitType === 'penchan') {
            fu += 2;
        }
    }

    fu = Math.ceil(fu / 10) * 10;
    return Math.max(fu, 20);
}

// ===== Scoring =====
function calculateBaseScore(han, fu) {
    if (han >= 5) {
        if (han >= 13) return 8000;
        if (han >= 11) return 6000;
        if (han >= 8) return 4000;
        if (han >= 6) return 3000;
        return 2000;
    }
    let base = fu * Math.pow(2, 2 + han);
    if (base > 2000) base = 2000;
    return base;
}

function ceil100(n) {
    return Math.ceil(n / 100) * 100;
}

function getRankLabel(totalHan, fu, isYakuman, yaku) {
    if (isYakuman) {
        const count = yaku.filter(y => y.isYakuman).length;
        if (count >= 2) return count + '倍役満';
        return '役満';
    }
    if (totalHan >= 13) return '数え役満';
    if (totalHan >= 11) return '三倍満';
    if (totalHan >= 8) return '倍満';
    if (totalHan >= 6) return '跳満';
    if (totalHan >= 5 || (totalHan === 4 && fu >= 40) || (totalHan === 3 && fu >= 70)) return '満貫';
    return null;
}

function calculatePayments(handInfo, gameState) {
    const han = handInfo.totalHan;
    const fu = handInfo.fu;
    const isDealer = gameState && gameState.isDealer;
    const isTsumo = gameState && gameState.winType === 'tsumo';
    const isYakuman = handInfo.yaku.some(y => y.isYakuman);

    let base;
    if (isYakuman) {
        const yakumanCount = handInfo.yaku.filter(y => y.isYakuman).reduce((s, y) => s + Math.floor(y.han / 13), 0);
        base = 8000 * yakumanCount;
    } else {
        base = calculateBaseScore(han, fu);
    }

    if (isDealer) {
        if (isTsumo) {
            const pp = ceil100(base * 2);
            return {
                type: 'tsumo',
                total: pp * 3,
                dealerPayment: pp,
                childPayment: pp,
            };
        } else {
            const payment = ceil100(base * 6);
            return {
                type: 'ron',
                total: payment,
                discarderPayment: payment,
            };
        }
    } else {
        if (isTsumo) {
            const dp = ceil100(base * 2);
            const cp = ceil100(base);
            return {
                type: 'tsumo',
                total: dp + cp * 2,
                dealerPayment: dp,
                childPayment: cp,
            };
        } else {
            const payment = ceil100(base * 4);
            return {
                type: 'ron',
                total: payment,
                discarderPayment: payment,
            };
        }
    }
}

export { calculateFu, calculatePayments, getRankLabel };
