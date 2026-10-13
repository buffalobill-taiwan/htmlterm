import { COMPLETE_HANDS, PAIRS } from './rules.js';

// All displayed difficulties intentionally use this same policy.
function quality(hand, open, remaining) {
    const counts = Array(14).fill(0);
    for (const tile of hand) counts[tile.kind]++;
    let missing = Infinity;
    const effective = new Set();
    for (const target of open ? PAIRS : COMPLETE_HANDS) {
        const need = Array(14).fill(0);
        for (const kind of target) need[kind]++;
        let deficit = 0, possible = true;
        for (let k = 0; k < 14; k++) {
            need[k] = Math.max(0, need[k] - counts[k]);
            deficit += need[k];
            if (need[k] > remaining[k]) possible = false;
        }
        if (!possible || deficit > missing) continue;
        if (deficit < missing) { missing = deficit; effective.clear(); }
        for (let k = 0; k < 14; k++) if (need[k]) effective.add(k);
    }
    return [missing, [...effective].reduce((n, k) => n + remaining[k], 0)];
}

function compare(a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? 1 : -1;
    return a[1] - b[1];
}

function bestDiscards(hand, open, remaining) {
    let best = [Infinity, -1], choices = [];
    for (const tile of hand) {
        const score = quality(hand.filter(t => t.id !== tile.id), open, remaining);
        const comparison = compare(score, best);
        if (comparison > 0) { best = score; choices = [tile.id]; }
        else if (!comparison) choices.push(tile.id);
    }
    return { score: best, choices };
}

export function chooseAction(view, actions, random = Math.random) {
    const win = actions.find(a => a.type === 'win');
    if (win) return win;
    if (actions[0]?.type === 'discard') {
        const { choices } = bestDiscards(view.hand, view.melds.length, view.remaining);
        const id = choices[Math.floor(random() * choices.length)];
        return actions.find(a => a.id === id);
    }
    const baseline = quality(view.hand, view.melds.length, view.remaining);
    const chi = actions.find(a => a.type === 'chi' && compare(bestDiscards(
        view.hand.filter(t => !a.ids.includes(t.id)), true, view.remaining).score, baseline) > 0);
    return chi || actions.find(a => a.type === 'pass') || actions[0];
}
