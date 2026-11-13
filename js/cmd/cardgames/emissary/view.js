import { term } from '../../../system/sys.js';
import { displayWidth } from '../../../util/display-width.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { cardBuffer, cardBufferVariant, mutedCardBuffer, stampCard } from '../cards.js';
import { RANKS, SUITS } from '../deck.js';
import { legalIndices } from './rules.js';

export const KINGDOM_X = [4, 13, 22, 31, 40, 49, 58, 67];
export const KINGDOM_Y = 2;
export const DECK = { x: 2, y: 7 };
export const TOPIC = { x: 13, y: 7 };
export const DISCARD = { x: 24, y: 7 };
export const SCORING = { x: 35, y: 7 };
export const ADVISOR_X = [7, 13, 19, 25];
export const ALLY_X = [31, 37, 43, 49, 55, 61, 67, 73];
export const SUPPORT_Y = 12;
export const HAND_X = 2;
export const HAND_STEP = 6;
export const HAND_Y = 17;
export const VISIBLE_HAND = 12;

export const kingdomPosition = index => ({ x: KINGDOM_X[index], y: KINGDOM_Y });
export const allyPosition = index => ({ x: ALLY_X[index], y: SUPPORT_Y });
export const handPosition = (index, scroll = 0) =>
    ({ x: HAND_X + (index - scroll) * HAND_STEP, y: HAND_Y });

const kind = card => card ? `${SUITS[card.suit]}${RANKS[card.rank]}` : '';
const cardName = card => card ? `${kind(card)}` : '—';

function tint(face, key, bg) {
    return cardBufferVariant(face, key, buffer => {
        for (let row = 0; row < buffer.height; row++)
            for (let col = 0; col < buffer.width; col++)
                buffer.setCell(row, col, { ...buffer.getCell(row, col), bg });
    });
}

function drawEmpty(vb, x, y, label = '', bg = null) {
    const style = bg == null ? '\x1B[90m' : `\x1B[37;${40 + bg}m`;
    const inner = label + ' '.repeat(Math.max(0, 3 - displayWidth(label)));
    vb.writeStr(y, x, style + '┌───┐\x1B[0m');
    vb.writeStr(y + 1, x, style + '│' + inner + '│\x1B[0m');
    vb.writeStr(y + 2, x, style + '└───┘\x1B[0m');
}

function drawPile(vb, count, x, y, face = null) {
    if (!count) {
        drawEmpty(vb, x, y);
        return;
    }
    stampCard(vb, cardBuffer(face), x, y);
}

function drawKingdom(vb, game, kingdom, index) {
    const state = game.state;
    const x = KINGDOM_X[index], y = KINGDOM_Y;
    const current = state.current === kingdom.slot;
    const selected = game.phase === 'selectKingdom' && game.kingdomCursor === index;
    const swapSelected = game.phase === 'swap' && game.swapCursor === kingdom.slot;

    if (selected || swapSelected) vb.writeStr(1, x + 2, '\x1B[33m▼\x1B[0m');

    const bg = kingdom.conquered ? 2 : current ? 4 : kingdom.visited ? 1 : null;
    if (game.hiddenKingdoms.has(index)) {
        drawEmpty(vb, x, y, '', bg);
    } else if (kingdom.conquered || !kingdom.ruler) {
        drawEmpty(vb, x, y, '★', bg);
    } else {
        let face = cardBuffer(kingdom.ruler);
        if (bg != null) face = tint(face, `emissary-kingdom-${bg}`, bg);
        stampCard(vb, face, x, y);
    }

    vb.writeStr(5, x, `需${kingdom.slot}勝`);

}

function drawPiles(vb, game) {
    const state = game.state;
    const hiddenTopic = game.hiddenTopic;
    // Rules put the topic in discard immediately, but it remains visually
    // separate until its reveal/debate presentation has finished.
    const presentedTopic = state.topic || game.topicDisplay;
    const topicIndex = presentedTopic ? state.discard.lastIndexOf(presentedTopic) : -1;
    const discardCount = state.discard.length - (topicIndex >= 0 ? 1 : 0);
    let topIndex = state.discard.length - 1;
    if (topIndex === topicIndex) topIndex--;
    const topic = !hiddenTopic ? presentedTopic : null;

    drawPile(vb, state.deck.length, DECK.x, DECK.y);
    vb.writeStr(10, DECK.x, `牌堆 ${state.deck.length}`);
    if (topic) stampCard(vb, cardBuffer(topic), TOPIC.x, TOPIC.y);
    else drawEmpty(vb, TOPIC.x, TOPIC.y);
    vb.writeStr(10, TOPIC.x, topic ? `話題 ${SUITS[topic.suit]}` : '話題');
    drawPile(vb, discardCount, DISCARD.x, DISCARD.y,
        discardCount ? state.discard[topIndex] : null);
    vb.writeStr(10, DISCARD.x, `棄牌 ${discardCount}`);
    drawPile(vb, state.scoring.length, SCORING.x, SCORING.y,
        state.scoring.length ? state.scoring[state.scoring.length - 1] : null);
    vb.writeStr(10, SCORING.x, `計分牌 ${state.scoring.length}`);
}

function drawSupports(vb, game) {
    const state = game.state;
    const usable = game.phase === 'between' && !game.animating && !game.dealing && !state.topic;
    const cursor = game.supportCursor ?? 0;
    drawEmpty(vb, 1, SUPPORT_Y, '', usable && cursor === 0 ? 3 : null);
    if (usable) vb.writeStr(SUPPORT_Y - 1, 3 + cursor * 6, '\x1B[33m▼\x1B[0m');
    const faceFor = (card, unusable) =>
        unusable ? mutedCardBuffer(cardBuffer(card)) : cardBuffer(card);
    state.advisors.forEach((entry, index) => {
        const x = ADVISOR_X[index];
        if (!entry) {
            drawEmpty(vb, x, SUPPORT_Y);
            return;
        }
        const face = faceFor(entry.card, entry.used || !usable);
        stampCard(vb, usable && !entry.used && cursor === index + 1
            ? tint(face, 'emissary-support-selected', 3) : face, x, SUPPORT_Y);
    });
    state.allies.forEach((entry, index) => {
        const x = ALLY_X[index];
        if (!entry || game.hiddenAlly === index) {
            drawEmpty(vb, x, SUPPORT_Y);
            return;
        }
        const face = faceFor(entry.card, entry.spent || !usable);
        stampCard(vb, usable && !entry.spent && cursor === index + 5
            ? tint(face, 'emissary-support-selected', 3) : face, x, SUPPORT_Y);
    });
}

function drawHand(vb, game) {
    const state = game.state;
    const legal = game.phase === 'debate' ? new Set(legalIndices(state)) : null;
    const start = game.handScroll;
    const end = Math.min(state.hand.length, start + VISIBLE_HAND);

    vb.writeStr(15, 0, '\x1B[90m' + '─'.repeat(80) + '\x1B[0m');
    vb.writeStr(15, 1, '翻牌');
    vb.writeStr(15, 7, '\x1B[1m顧問\x1B[0m');
    vb.writeStr(15, 31, '\x1B[1m盟友\x1B[0m');

    for (let index = start; index < end; index++) {
        const { x } = handPosition(index, start);
        if (game.hiddenHand.has(index)) {
            drawEmpty(vb, x, HAND_Y);
            continue;
        }
        const card = state.hand[index];
        let face = cardBuffer(card);
        const selected = index === game.handCursor &&
            ['debate', 'discardTwo'].includes(game.phase);
        if (game.phase === 'debate' && legal && !legal.has(index)) face = mutedCardBuffer(face);
        else if (game.phase === 'debate' && legal) face = tint(face, 'emissary-legal', 2);
        if (game.phase === 'discardTwo' && game.discardMarked.has(index))
            face = tint(face, 'emissary-marked', 4);
        if (selected) face = tint(face, 'emissary-selected', 3);
        stampCard(vb, face, x, HAND_Y);
        if (selected) vb.writeStr(16, x + 2, '\x1B[33m▲\x1B[0m');
    }

    const count = state.hand.length;
    let info = `手牌 ${count} 張`;
    if (count > VISIBLE_HAND) info += `　顯示 ${start + 1}–${end}`;
    vb.writeStr(20, 2, info);
    if (['debate', 'discardTwo'].includes(game.phase) && count && game.handCursor < count) {
        const card = state.hand[game.handCursor];
        vb.writeStr(20, 50, `游標 ${cardName(card)}`);
    }
}

function drawCurrent(vb, game) {
    const state = game.state;
    const selecting = game.phase === 'selectKingdom';
    const kingdom = selecting ? state.kingdoms[game.kingdomCursor]
        : state.current ? state.kingdoms[state.current - 1] : null;
    const x = 48;
    if (!kingdom) return;
    const trump = kingdom.ruler ? SUITS[kingdom.ruler.suit] : '—';
    vb.writeStr(7, x, `王國 ${kingdom.slot}　王牌 ${trump}`);
    vb.writeStr(8, x, `必須剛好贏 ${kingdom.slot} 場`);
    if (selecting) {
        vb.writeStr(9, x, `統治者 ${cardName(kingdom.ruler)}`);
        vb.writeStr(10, x, 'Enter 拜訪此王國');
        return;
    }
    const remaining = kingdom.slot - state.wins;
    const progress = remaining > 0 ? `還差 ${remaining} 場`
        : remaining === 0 ? '已達標，勿再贏' : '已超過目標';
    vb.writeStr(9, x, `已贏 ${state.wins}　${progress}`);
    vb.writeStr(10, x, `剩餘手牌 ${state.hand.length} 張`);
}

function instructions(game) {
    if (game.dealing) return '發牌中…';
    if (game.animating) return '牌張移動中…';
    switch (game.phase) {
        case 'selectKingdom': return '←→ 選擇王國　Enter 拜訪　H 規則';
        case 'between': return '←→ 選翻牌／能力 Enter 執行 A 選單'
            + (game.state.hand.length > VISIBLE_HAND ? ' PgUp/PgDn 看手牌' : '');
        case 'debate': {
            const topic = game.state.topic;
            const mustFollow = topic && game.state.hand.some(card => card.suit === topic.suit);
            return `←→ 選牌　Enter 回應　${mustFollow
                ? `必須跟 ${SUITS[topic.suit]} 花色` : '無同花，可出任意牌'}`;
        }
        case 'swap': return '←→ 選擇交換對象　Enter 確認　Esc 取消';
        case 'discardTwo': return `←→ 選牌 Space 標記 ${game.discardMarked.size}/2 Enter 棄牌 Esc 清除`;
        case 'won':
        case 'lost': return 'Enter 同種子重玩　N 回選單　Q／Esc 離開';
        default: return '';
    }
}

function drawEnd(vb, game) {
    const state = game.state;
    const won = game.phase === 'won';
    const conquered = state.kingdoms.filter(kingdom => kingdom.conquered);
    const unused = state.allies.filter(ally => !ally.spent);
    vb.centerRow(2, '\x1B[1;36m使節 The Emissary\x1B[0m');
    vb.centerRow(4, won ? '\x1B[1;32m八國全數歸心 — 勝利！\x1B[0m'
        : '\x1B[1;31m外交失敗 — 未能取得全部支持\x1B[0m');
    vb.centerRow(7, `得分 ${state.score} / 16`);
    vb.centerRow(8, `征服王國 ${conquered.length} / 8　未用盟友 ${unused.length}`);
    vb.centerRow(10, `種子 ${game.seed}`);

    const lines = state.kingdoms.map(kingdom => {
        const marker = kingdom.conquered ? '★' : kingdom.visited ? '✗' : '·';
        const status = kingdom.conquered ? '已征服' : kingdom.visited ? '未成功' : '未訪問';
        return `${kingdom.slot}. ${marker}${' '.repeat(2 - displayWidth(marker))} ${status}`;
    });
    lines.forEach((line, index) => vb.writeStr(12 + index, 18, line));
    vb.centerRow(21, won ? '所有王國都接受了你的使節。' : `本局得分 ${state.score}；按 Enter 以同一個種子再試一次。`);
}

export class EmissaryView {
    constructor() {
        this.vb = new VirtualBuffer(80, 24);
    }

    draw(game) {
        const vb = this.vb;
        for (let row = 0; row < vb.height; row++) vb.writeStr(row, 0, ' '.repeat(vb.width));

        if (game.phase === 'won' || game.phase === 'lost') {
            drawEnd(vb, game);
            vb.centerRow(22, instructions(game));
            vb.centerRow(23, 'H 規則　R 重玩');
            term.writeVB(vb);
            return;
        }

        vb.writeStr(0, 2, '\x1B[1;36m使節 The Emissary\x1B[0m');
        vb.writeStr(0, 56, `種子 ${game.seed}`);

        game.state.kingdoms.forEach((kingdom, index) => drawKingdom(vb, game, kingdom, index));
        vb.writeStr(6, 0, '\x1B[90m' + '─'.repeat(80) + '\x1B[0m');

        drawPiles(vb, game);
        drawSupports(vb, game);
        drawHand(vb, game);
        drawCurrent(vb, game);

        vb.centerRow(21, game.status || '');
        vb.centerRow(22, instructions(game));
        vb.centerRow(23, game.dealing || game.animating ? 'Q／Esc 離開'
            : `H 規則　R 重玩　N 選單　${['swap', 'discardTwo'].includes(game.phase) ? 'Q 離開' : 'Q／Esc 離開'}`);
        term.writeVB(vb);
    }
}
