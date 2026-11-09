import { createDeck } from '../deck.js';
import { shuffle } from '../../../util/random.js';

export const value = c => c.rank > 10 ? (c.rank - 9) * 5 : c.rank;
const sum = cards => cards.reduce((n, c) => n + value(c), 0);
export function createGame(rng = Math.random) {
    const cards = createDeck();
    const s = {rng, deck: shuffle(cards.filter(c => c.rank <= 10), rng), castle: [],
        hand: [], discard: [], played: [], shield: 0, jesters: 2, cheatMode: false, defeated: 0, phase: 'attack'};
    for (const rank of [11, 12, 13]) s.castle.push(...shuffle(cards.filter(c => c.rank === rank), rng));
    s.stats = { order: [...s.castle], exact: [], damage: 0, maxDamage: 0, incoming: 0, recovered: 0, drawn: 0, reduction: 0, attacks: 0, jesterUses: 0 };
    s.enemy = s.castle.shift(); s.hp = value(s.enemy) * 2;
    draw(s, 8); return s;
}
function draw(s, n) {
    const before = s.hand.length;
    while (n-- > 0 && s.deck.length && s.hand.length < 8) s.hand.push(s.deck.shift());
    if (s.stats) s.stats.drawn += s.hand.length - before;
}
export function preview(s, indices) {
    const cards = indices.map(i => s.hand[i]);
    if (!cards.length || cards.some(c => !c) || new Set(indices).size !== indices.length) return null;
    const total = sum(cards);
    const legal = s.phase === 'defend' ? total >= Math.max(0, value(s.enemy) - s.shield) :
        cards.length === 1 || (cards.length === 2 && cards.some(c => c.rank === 1)) ||
        (cards.length <= 4 && cards[0].rank > 1 && cards.every(c => c.rank === cards[0].rank) && total <= 10);
    const suits = new Set(cards.map(c => c.suit).filter(suit => suit !== s.enemy.suit));
    return {legal, total, suits, damage: total * (suits.has(3) ? 2 : 1),
        incoming: Math.max(0, value(s.enemy) - s.shield - (suits.has(0) ? total : 0))};
}
export function needsRescue(s) {
    return s.phase === 'attack' ? !s.hand.length :
        s.phase === 'defend' && sum(s.hand) < Math.max(0, value(s.enemy) - s.shield);
}
function check(s) {
    if (s.phase === 'win') return;
    const impossible = needsRescue(s);
    if (impossible && !(s.jesters && s.deck.length)) {
        s.lossReason = s.phase === 'defend' ? '手牌點數不足以抵傷' : '沒有可出的手牌';
        s.phase = 'loss';
    }
}
export function jester(s) {
    if (!['attack', 'defend'].includes(s.phase) || !s.jesters) return false;
    if (!s.cheatMode) s.jesters--;
    if (s.stats) s.stats.jesterUses++;
    s.discard.push(...s.hand); s.hand = []; draw(s, 8); check(s); return true;
}
export function play(s, indices, effects) {
    if (!['attack', 'defend'].includes(s.phase)) return false;
    const p = preview(s, indices);
    if (!p?.legal) return false;
    const chosen = new Set(indices), cards = s.hand.filter((_, i) => chosen.has(i));
    s.hand = s.hand.filter((_, i) => !chosen.has(i));
    if (s.phase === 'defend') {
        s.discard.push(...cards); s.phase = 'attack'; check(s); return true;
    }
    if (s.stats) { s.stats.attacks++; s.stats.damage += p.damage; s.stats.maxDamage = Math.max(s.stats.maxDamage, p.damage); }
    s.played.push(...cards);
    if (p.suits.has(1)) {
        shuffle(s.discard, s.rng);
        const recovered = s.discard.splice(0, p.total);
        s.deck.push(...recovered);
        if (s.stats) s.stats.recovered += recovered.length;
        if (recovered.length) effects?.push({ type: 'recover', power: p.total, count: recovered.length,
            deckCount: s.deck.length, discard: [...s.discard] });
    }
    if (p.suits.has(2)) {
        const before = s.hand.length;
        draw(s, p.total);
        if (s.hand.length > before) effects?.push({ type: 'draw', power: p.total, count: s.hand.length - before });
    }
    const beforeAttack = Math.max(0, value(s.enemy) - s.shield);
    if (p.suits.has(0)) {
        s.shield += p.total;
        if (s.stats) s.stats.reduction += beforeAttack - Math.max(0, value(s.enemy) - s.shield);
        if (beforeAttack > 0) effects?.push({type: 'shield', power: p.total,
            beforeAttack, afterAttack: Math.max(0, value(s.enemy) - s.shield)});
    }
    effects?.push({type: 'attack', beforeAttack, doubled: p.suits.has(3), enemy: s.enemy, incoming: Math.max(0, value(s.enemy) - s.shield), damage: p.damage, beforeHp: s.hp, afterHp: Math.max(0, s.hp - p.damage)});
    s.hp -= p.damage;
    if (s.hp <= 0) {
        const used = [...s.played], enemy = s.enemy, exact = s.hp === 0;
        if (exact && s.stats) s.stats.exact.push(enemy);
        if (s.hp === 0) s.deck.unshift(s.enemy); else s.discard.push(s.enemy);
        s.discard.push(...s.played); s.played = []; s.shield = 0; s.defeated++;
        effects?.push({type: 'defeat', used, enemy, exact, deckCount: s.deck.length, discard: [...s.discard]});
        if (!s.castle.length) { s.phase = 'win'; return true; }
        s.enemy = s.castle.shift(); s.hp = value(s.enemy) * 2;
    } else if (value(s.enemy) > s.shield) {
        if (s.stats) s.stats.incoming += value(s.enemy) - s.shield;
        s.phase = 'defend';
    }
    check(s); return true;
}
