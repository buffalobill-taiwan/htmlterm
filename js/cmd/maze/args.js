import { DIFFICULTY } from './board.js';
import { parseSeed } from '../../util/random.js';

// Shared by the command and offline solver; preserve positional difficulty.
export function parseMazeArgs(args) {
    let seed = null, difficulty = null;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const name = arg.replace(/^--/, '');
        if (Object.hasOwn(DIFFICULTY, name)) {
            if (difficulty !== null) throw new Error('Specify only one difficulty.');
            difficulty = name;
            continue;
        }
        let value = arg;
        if (arg === '--seed') value = args[++i];
        else if (arg.startsWith('--seed=')) value = arg.slice(7);
        if (seed !== null) throw new Error('Specify only one seed.');
        seed = parseSeed(value);
        if (seed === null) throw new Error('Invalid argument or seed (expected 0–2147483647).');
    }
    return { seed, difficulty: difficulty ?? (seed !== null ? 'medium' : null) };
}
