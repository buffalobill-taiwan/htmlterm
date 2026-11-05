export const HAND_NAMES = ['高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '四條', '同花順'];
const UNIT = 15 ** 5;
function packed(category, ranks) {
    let value = category;
    for (let i = 0; i < 5; i++) value = value * 15 + (ranks[i] || 0);
    return value;
}
function straight(ranks) {
    const set = new Set(ranks);
    if (set.has(14)) set.add(1);
    for (let high = 14; high >= 5; high--)
        if ([0, 1, 2, 3, 4].every(d => set.has(high - d))) return high;
    return 0;
}
// Evaluates the best five of 5–7 cards directly; numeric values sort by strength.
export function evaluate(cards) {
    const counts = new Map(), suits = [[], [], [], []];
    for (const c of cards) {
        const r = c.rank === 1 ? 14 : c.rank;
        counts.set(r, (counts.get(r) || 0) + 1);
        suits[c.suit].push(r);
    }
    const ranks = [...counts.keys()].sort((a, b) => b - a);
    const groups = ranks.slice().sort((a, b) => counts.get(b) - counts.get(a) || b - a);
    const flush = suits.find(s => s.length >= 5)?.sort((a, b) => b - a);
    const sf = flush && straight(flush);
    if (sf) return packed(8, [sf]);
    if (counts.get(groups[0]) === 4) return packed(7, [groups[0], ranks.find(r => r !== groups[0])]);
    const trips = ranks.filter(r => counts.get(r) >= 3);
    const pair = trips.length && ranks.find(r => r !== trips[0] && counts.get(r) >= 2);
    if (pair) return packed(6, [trips[0], pair]);
    if (flush) return packed(5, flush.slice(0, 5));
    const high = straight(ranks);
    if (high) return packed(4, [high]);
    if (trips.length) return packed(3, [trips[0], ...ranks.filter(r => r !== trips[0]).slice(0, 2)]);
    const pairs = ranks.filter(r => counts.get(r) >= 2);
    if (pairs.length >= 2) return packed(2, [...pairs.slice(0, 2), ranks.find(r => !pairs.slice(0, 2).includes(r))]);
    if (pairs.length) return packed(1, [pairs[0], ...ranks.filter(r => r !== pairs[0]).slice(0, 3)]);
    return packed(0, ranks.slice(0, 5));
}
export function handName(value) { return HAND_NAMES[Math.floor(value / UNIT)]; }
