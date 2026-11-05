import { evaluate } from './evaluate.js';
// Unknown folded cards and burns remain in the sampling pool: their identities
// are not information available to a player.
export function equity(view, trials = 1000, rng = Math.random) {
    const known = new Set([...view.hole, ...view.board].map(c => c.suit * 13 + c.rank - 1));
    const pool = Array.from({ length: 52 }, (_, i) => i).filter(i => !known.has(i));
    const card = id => ({ suit: Math.floor(id / 13), rank: id % 13 + 1 });
    let total = 0;
    for (let trial = 0; trial < trials; trial++) {
        const sample = pool.slice(); let left = sample.length;
        const draw = () => { const i = Math.floor(rng() * left); const id = sample[i]; sample[i] = sample[--left]; return card(id); };
        const board = view.board.slice();
        while (board.length < 5) board.push(draw());
        const mine = evaluate([...view.hole, ...board]);
        let ties = 1, beaten = false;
        for (let i = 0; i < view.opponents; i++) {
            const value = evaluate([draw(), draw(), ...board]);
            if (value > mine) beaten = true;
            if (value === mine) ties++;
        }
        if (!beaten) total += 1 / ties;
    }
    return total / trials;
}
export function decide(view, rng = Math.random, trials = 1000) {
    const strength = equity(view, trials, rng), l = view.legal;
    const price = l.call / Math.max(1, view.pot + l.call);
    const bluff = rng() < 0.055;
    if (l.call && strength + 0.025 < price && !bluff) return { type: 'fold' };
    if (l.raise && (strength > Math.max(0.42, 1 / (view.opponents + 1) + 0.17) || bluff) && rng() < 0.7) {
        const target = Math.min(l.max, Math.max(l.min, view.currentBet + Math.round((view.pot + l.call) * (strength > 0.75 ? 0.8 : 0.5))));
        if (target >= l.min || strength > 0.65) return { type: 'raise', to: target };
    }
    return { type: l.call ? 'call' : 'check' };
}
