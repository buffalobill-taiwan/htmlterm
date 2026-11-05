// Parameters are sampled once per buy-in, never once per decision.
export const DEFAULT_PERSONALITY = Object.freeze({
    bluff: 0.055, aggression: 0.7, tolerance: 0.025, thresholdOffset: 0,
    betRatio: 0.5, strongBetRatio: 0.8,
});
const STYLES = [
    [0.01, 0.35, -0.05, 0.10, 0.35, 0.60],
    [0.04, 0.80, 0, 0.03, 0.55, 0.85],
    [0.02, 0.20, 0.12, 0.08, 0.35, 0.60],
    [0.12, 0.90, 0.08, -0.08, 0.75, 1],
    [0.22, 0.75, 0.03, -0.03, 0.65, 0.95],
];
const KEYS = Object.keys(DEFAULT_PERSONALITY);
const SPREAD = [0.01, 0.05, 0.02, 0.02, 0.05, 0.05];
export function createPersonality(rng = Math.random) {
    const style = STYLES[Math.floor(rng() * STYLES.length)];
    return Object.fromEntries(KEYS.map((key, i) => {
        const value = style[i] + (rng() * 2 - 1) * SPREAD[i];
        return [key, i < 2 ? Math.max(0, Math.min(1, value)) : value];
    }));
}
