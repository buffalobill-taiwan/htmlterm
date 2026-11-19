import { term } from '../../../system/sys.js';
import { bufWidth } from '../../../util/display-width.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { cardBuffer, cardBufferVariant, drawCardStack, stampCard } from '../cards.js';
import { MAX_HP, canFlee, cardLabel, remainingMonsterValue } from './rules.js';

export const DECK = { x: 2, y: 4 };
export const DISCARD = { x: 70, y: 4 };
export const ROOM_X = [20, 29, 38, 47];
export const ROOM_Y = 6;
export const DIVIDER_Y = 9;
export const WEAPON_SLOT = { x: 2, y: 10 };
export const SLAIN_SLOT = { x: 22, y: 10 };

export const roomPosition = index => ({ x: ROOM_X[index], y: ROOM_Y });

// Once a heart has been drunk this room, the remaining potions are inert.
// Grey out only the red face glyphs (fg 1), leaving the card frame intact.
function spentPotionBuffer(face) {
    return cardBufferVariant(face, 'scoundrel-spent-potion', vb => {
        for (let row = 0; row < vb.height; row++)
            for (let col = 0; col < vb.width; col++) {
                const cell = vb.getCell(row, col);
                if (cell.fg === 1) vb.setCell(row, col, { ...cell, fg: 8 });
            }
    });
}

function drawEmpty(vb, x, y, label = '') {
    const inner = label + ' '.repeat(Math.max(0, 3 - bufWidth(label)));
    vb.writeStr(y, x, '\x1B[90m┌───┐\x1B[0m');
    vb.writeStr(y + 1, x, '\x1B[90m│' + inner + '│\x1B[0m');
    vb.writeStr(y + 2, x, '\x1B[90m└───┘\x1B[0m');
}

function drawHp(vb, state) {
    const hp = state.hp;
    const color = hp > 10 ? 32 : hp > 5 ? 33 : 31;
    vb.centerRow(1, `血量 ${hp}/${MAX_HP}  \x1B[${color}m` + '█'.repeat(hp) +
        '\x1B[0m\x1B[90m' + '░'.repeat(MAX_HP - hp) + '\x1B[0m');
}

function drawPiles(vb, state) {
    if (state.dungeon.length) {
        drawCardStack(vb, cardBuffer(null), DECK.x, DECK.y, Math.min(2, state.dungeon.length - 1));
    } else drawEmpty(vb, DECK.x, DECK.y);
    vb.writeStr(3, DECK.x - 1, `地城 ${state.dungeon.length}`);

    const top = state.discard[state.discard.length - 1];
    if (top) stampCard(vb, cardBuffer(top), DISCARD.x, DISCARD.y);
    else drawEmpty(vb, DISCARD.x, DISCARD.y);
    vb.writeStr(3, DISCARD.x, `棄牌 ${state.discard.length}`);
}

export const FLEE_POSITION = { x: 56, y: ROOM_Y };

function drawFleeOption(vb, game, state) {
    if (!canFlee(state)) return;
    const selected = game.cursor === state.room.length && game.phase === 'choose' &&
        !game.animating && !game.dealing;
    const { x, y } = FLEE_POSITION;
    // Plain white on black; invert to black on yellow when highlighted.
    const style = selected ? '\x1B[30;43m' : '\x1B[37;40m';
    vb.writeStr(y, x, style + '┌───┐\x1B[0m');
    vb.writeStr(y + 1, x, style + '│逃 │\x1B[0m');
    vb.writeStr(y + 2, x, style + '└───┘\x1B[0m');
    if (selected) vb.writeStr(y - 1, x + 2, '\x1B[33m▼\x1B[0m');
}

function drawRoom(vb, game, state) {
    const hidden = game.hiddenRoom;
    state.room.forEach((card, index) => {
        const x = ROOM_X[index];
        if (hidden.has(index)) {
            drawEmpty(vb, x, ROOM_Y);
            return;
        }
        const selected = index === game.cursor && game.phase === 'choose' &&
            !game.animating && !game.dealing;
        let face = cardBuffer(card);
        if (card.suit === 1 && state.potionUsed) face = spentPotionBuffer(face);
        if (selected) face = cardBufferVariant(face, 'scoundrel-selected', buffer => {
            for (let row = 0; row < buffer.height; row++)
                for (let col = 0; col < buffer.width; col++)
                    buffer.setCell(row, col, { ...buffer.getCell(row, col), bg: 3 });
        });
        stampCard(vb, face, x, ROOM_Y);
        if (selected) vb.writeStr(ROOM_Y - 1, x + 2, '\x1B[33m▼\x1B[0m');
    });
}

function drawGear(vb, game) {
    const state = game.visualState || game.state;
    const slots = game.displaySlots;
    if (state.weapon) stampCard(vb, cardBuffer(state.weapon.card), WEAPON_SLOT.x, WEAPON_SLOT.y);
    else drawEmpty(vb, WEAPON_SLOT.x, WEAPON_SLOT.y, '武');
    if (slots.slain) stampCard(vb, cardBuffer(slots.slain), SLAIN_SLOT.x, SLAIN_SLOT.y);
    else drawEmpty(vb, SLAIN_SLOT.x, SLAIN_SLOT.y, '戰');

    const weapon = state.weapon;
    const limit = weapon
        ? (weapon.lastKill === null ? '可打任意怪物' : `可打 ≤ ${weapon.lastKill}`)
        : '空手作戰（承受完整點數）';
    const recent = state.slain.slice(-4);
    const loot = recent.length
        ? recent.map(cardLabel).join(' ') + (state.slain.length > recent.length ? '…' : '')
        : '無';
    const label = weapon ? `武器 ${cardLabel(weapon.card)} 威力${weapon.value}` : '武器 無';
    vb.writeStr(13, 2, `${label}　${limit}　戰利品 ${loot}`);
}

function lastActionText(event) {
    if (!event) return '尚無動作';
    if (event.type === 'flee') return `逃離房間：${event.returned.length} 張牌放回地城底，換新房間`;
    if (event.type === 'equip') return `裝備 ${cardLabel(event.card)}（威力 ${event.value}）`;
    if (event.type === 'heal') return `${cardLabel(event.card)} 回復 ${event.healed} HP`;
    if (event.type === 'waste') return `${cardLabel(event.card)} 浪費（本房已喝過）`;
    if (event.mode === 'weapon') return `${cardLabel(event.card)} 用武器 −${event.weapon} → 扣 ${event.damage} HP，上限 ${event.lastKill}`;
    return `${cardLabel(event.card)} 空手 → 扣 ${event.damage} HP`;
}

function drawSettlement(vb, game) {
    const state = game.state;
    const won = game.phase === 'won';
    const stats = state.stats;
    const weapon = state.weapon
        ? `${cardLabel(state.weapon.card)}（≤${state.weapon.lastKill ?? '任意'}）` : '無';
    vb.centerRow(2, won ? '\x1B[1;32m通關成功\x1B[0m' : '\x1B[1;31m冒險失敗\x1B[0m');
    vb.centerRow(3, `分數 ${state.score}`);
    const rows = [
        ['房間數', stats.rooms, '處理卡牌', stats.cardsPlayed],
        ['擊殺怪物', stats.monstersSlain, '最高擊殺', stats.highestKill],
        ['裝備武器', stats.weaponsEquipped, '當前武器', weapon],
        ['喝下藥水', stats.potionsDrunk, '浪費藥水', stats.potionsWasted],
        ['回復血量', stats.hpHealed, '總受傷', stats.damageTaken],
        ['  其中空手', stats.damageBare, '  其中武器', stats.damageWeapon],
        ['逃離房間', stats.flees, '', ''],
        ['剩餘怪物總值', won ? '—（勝利不計）' : remainingMonsterValue(state), '', ''],
    ];
    rows.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
        const row = 6 + index;
        vb.writeStr(row, 18, `${leftLabel} ${leftValue}`);
        if (rightLabel) vb.writeStr(row, 46, `${rightLabel} ${rightValue}`);
    });
    vb.centerRow(20, 'Enter 選擇：新遊戲 / 回選單');
    vb.centerRow(22, 'H 規則　Q/Esc 離開');
}

export class ScoundrelView {
    constructor() {
        this.vb = new VirtualBuffer(80, 24);
    }

    draw(game) {
        const vb = this.vb;
        for (let row = 0; row < vb.height; row++) vb.writeStr(row, 0, ' '.repeat(80));

        if (game.phase === 'won' || game.phase === 'lost') {
            vb.centerRow(0, '\x1B[1;36mScoundrel — 結算\x1B[0m');
            drawSettlement(vb, game);
            term.writeVB(vb);
            return;
        }

        const state = game.visualState || game.state;
        vb.centerRow(0, '\x1B[1;36mScoundrel — 地城\x1B[0m');
        if (!state) {
            term.writeVB(vb);
            return;
        }
        drawHp(vb, state);
        drawPiles(vb, state);
        drawRoom(vb, game, state);
        drawFleeOption(vb, game, state);
        vb.writeStr(DIVIDER_Y, 0, '='.repeat(80));
        drawGear(vb, game);
        vb.centerRow(14, game.status || '');
        vb.centerRow(20, '上一步：' + lastActionText(state.lastAction));
        vb.centerRow(21, `房間 ${state.roomNo}　已處理 ${state.resolved}/3　牌庫剩 ${state.dungeon.length}　逃離 ${state.stats.flees}`);
        vb.centerRow(23, game.animating || game.dealing
            ? 'Q/Esc 離開　N 選單'
            : canFlee(state)
                ? '←→ 選牌／逃離　Enter 確定　H 規則　N 選單　Q/Esc 離開'
                : '←→ 選牌　Enter 確定　H 規則　N 選單　Q/Esc 離開');
        term.writeVB(vb);
    }
}
