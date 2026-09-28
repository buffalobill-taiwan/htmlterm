import {
    checkKokushi, checkDaisangen, checkSuuankou, checkTsuuiisou, checkRyuuiisou, checkChinroutou,
    checkChuurenPoutou, checkSuukantsu, checkDaisuushii, checkShousuushii, checkTenhou,
    checkChiihou,
} from './yakuman.js';
import {
    checkChiitoitsu, checkRiichi, checkDoubleRiichi, checkIppatsu, checkMenzenTsumo, checkPinfu,
    checkTanyao, checkIipeikou, checkRyanpeikou, checkYakuhai, checkSanshokuDoujun,
    checkSanshokuDoukou, checkIttsuu, checkChanta, checkJunchan, checkToitoi, checkSanankou,
    checkHonroutou, checkShousangen, checkSankantsu, checkHonitsu, checkChinitsu, checkHaitei,
    checkHoutei, checkRinshanKaihou, checkChankan,
} from './standard.js';

const STANDALONE_YAKU = [
    checkKokushi, checkChiitoitsu,
    checkDaisangen, checkSuuankou, checkTsuuiisou, checkRyuuiisou, checkChinroutou, checkChuurenPoutou, checkSuukantsu,
    checkDaisuushii, checkShousuushii,
    checkRiichi, checkDoubleRiichi, checkIppatsu, checkMenzenTsumo,
    checkPinfu, checkTanyao, checkIipeikou, checkRyanpeikou,
    checkYakuhai,
    checkSanshokuDoujun, checkSanshokuDoukou, checkIttsuu,
    checkChanta, checkJunchan,
    checkToitoi, checkSanankou, checkHonroutou,
    checkShousangen, checkSankantsu,
    checkHonitsu, checkChinitsu,
];

const BONUS_YAKU = [
    checkTenhou, checkChiihou,
    checkHaitei, checkHoutei, checkRinshanKaihou, checkChankan,
];

const YAKU_CHECKERS = STANDALONE_YAKU.concat(BONUS_YAKU);

function filterContainedYaku(yaku) {
    const names = new Set(yaku.map(y => y.name));
    return yaku.filter(y => {
        if ((names.has('四暗刻') || names.has('四暗刻単騎')) && (y.name === '対々和' || y.name === '三暗刻')) return false;
        if (names.has('四槓子') && y.name === '三槓子') return false;
        if (names.has('清老頭') && y.name === '対々和') return false;
        if ((names.has('大三元') || names.has('小三元')) && /^(中|發|白) \(役牌\)$/.test(y.name)) return false;
        if (names.has('大四喜') && y.name === '対々和') return false;
        if ((names.has('大四喜') || names.has('小四喜')) && /^(東|南|西|北)(\(自風\)|\(門風\)|風(東|南|西|北))$/.test(y.name)) return false;
        return true;
    });
}

function checkAllYaku(handInfo, gameState) {
    const yaku = [];
    for (const checker of YAKU_CHECKERS) {
        const result = checker(handInfo, gameState);
        for (const y of result) yaku.push(y);
    }
    return filterContainedYaku(yaku);
}

function checkStandaloneYaku(handInfo, gameState) {
    const yaku = [];
    for (const checker of STANDALONE_YAKU) {
        const result = checker(handInfo, gameState);
        for (const y of result) yaku.push(y);
    }
    return yaku;
}

export { checkAllYaku, checkStandaloneYaku };
