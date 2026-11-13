#!/usr/bin/env node
// Seeded deal viewer for The Emissary. Prints the eight kingdom rulers, the
// four advisors, the opening hand, and the remaining debate deck in draw order.
// It does not play the game or suggest moves.
import { pathToFileURL } from 'node:url';
import { parseSeed, SEED_MAX } from '../js/util/random.js';
import { createSeededGame } from '../js/cmd/cardgames/emissary/rules.js';
import { RANKS, SUITS } from '../js/cmd/cardgames/deck.js';

export { createGame, createSeededGame } from '../js/cmd/cardgames/emissary/rules.js';

const usage = `Usage: node tools/emissary-generate.mjs <seed> [--batch N] [--json]
The Emissary deal viewer, seed 0..2147483647.
Prints kingdom rulers, advisors, opening hand, and draw deck from top to bottom.
--json emits a machine-readable snapshot; --batch repeats over consecutive seeds.
No play, solution, or solvability guarantee.`;

const label = card => (card ? SUITS[card.suit] + RANKS[card.rank] : '??');

function snapshot(seed) {
    const game = createSeededGame(seed);
    return {
        seed,
        kingdoms: game.kingdoms.map(kingdom => ({
            slot: kingdom.slot,
            requiredWins: kingdom.slot,
            ruler: label(kingdom.ruler),
            trump: SUITS[kingdom.ruler.suit],
        })),
        advisors: game.advisors.map(entry => label(entry.card)),
        hand: game.hand.map(label),
        handSize: game.hand.length,
        deck: game.deck.slice().reverse().map(label),
        deckSize: game.deck.length,
    };
}

function print(snapshot) {
    console.log(`The Emissary seed ${snapshot.seed}`);
    console.log(`Kingdoms (left to right, required wins = slot)`);
    for (const kingdom of snapshot.kingdoms) {
        console.log(`  ${kingdom.slot}. ${kingdom.ruler}  trump ${kingdom.trump}  need ${kingdom.requiredWins}`);
    }
    console.log(`Advisors: ${snapshot.advisors.join(' ')}`);
    console.log(`Hand (${snapshot.handSize}): ${snapshot.hand.join(' ')}`);
    console.log(`Deck top to bottom (${snapshot.deckSize}): ${snapshot.deck.join(' ')}`);
}

function main(args) {
    if (args.includes('--help') || args.includes('-h')) { console.log(usage); return; }
    const flags = new Map(), positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--json') flags.set(a, true);
        else if (a === '--batch') {
            if (flags.has(a) || !args[i + 1] || args[i + 1].startsWith('--'))
                throw Error('Missing/duplicate option: ' + a);
            flags.set(a, args[++i]);
        } else if (a.startsWith('-')) throw Error('Unknown option: ' + a);
        else positional.push(a);
    }
    if (positional.length !== 1 || parseSeed(positional[0]) === null) throw Error('Expected one valid seed');
    const seed = Number(positional[0]);
    const count = Number(flags.get('--batch') ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw Error('Invalid --batch');
    if (seed + count - 1 > SEED_MAX) throw Error('Batch exceeds seed range');

    const results = Array.from({ length: count }, (_, i) => snapshot(seed + i));
    if (flags.has('--json')) console.log(JSON.stringify(count === 1 ? results[0] : results, null, 2));
    else results.forEach((result, index) => {
        if (index) console.log('');
        print(result);
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch (e) { console.error(e.message + '\n' + usage); process.exitCode = 1; }
}
