// Random utility functions for commands

export const SEED_MAX = 0x7fffffff;

export function parseSeed(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
    const seed = Number(value);
    return Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX ? seed : null;
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
