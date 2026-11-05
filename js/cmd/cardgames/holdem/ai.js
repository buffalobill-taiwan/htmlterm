import { DEFAULT_PERSONALITY } from './personality.js';
import { evaluate } from './evaluate.js';
import { BIG_BLIND } from './rules.js';
// An unraised preflop pot costs one big blind and later streets pay off made
// hands. Raw pot odds alone would fold almost every non-premium hand, so the
// call decision gets this much extra equity as implied odds.
const LIMP_EQUITY = 0.15;
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
// Round non-all-in raises to multiples of 5 or 10 within [min, max].
// An all-in bet uses the exact remaining stack.
export function roundRaise(ideal, min, max) {
    if (ideal >= max || min > max) return max;
    let target = Math.round(ideal / 5) * 5;
    if (target < min) target = Math.ceil(min / 5) * 5;
    return target > max ? max : target;
}
export function decide(view, rng = Math.random, trials = 1000) {
    const strength = equity(view, trials, rng), l = view.legal;
    const price = l.call / Math.max(1, view.pot + l.call);
    const personality = view.personality || DEFAULT_PERSONALITY;
    const bluff = rng() < personality.bluff;
    const implied = view.board.length === 0 && view.currentBet <= BIG_BLIND ? LIMP_EQUITY : 0;
    const threshold = Math.max(0, Math.min(1, Math.max(0.42, 1 / (view.opponents + 1) + 0.17) + personality.thresholdOffset));
    if (l.call && strength + personality.tolerance + implied < price && !bluff) return { type: 'fold' };
    if (l.raise && (strength > threshold || bluff) && rng() < personality.aggression) {
        const ideal = view.currentBet + (view.pot + l.call) * (strength > 0.75 ? personality.strongBetRatio : personality.betRatio);
        const target = roundRaise(ideal, l.min, l.max);
        if (target >= l.min || strength > 0.65) return { type: 'raise', to: target };
    }
    return { type: l.call ? 'call' : 'check' };
}
