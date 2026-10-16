import { parseSeed, SEED_MAX } from './random.js';

// Shared seed-argument resolution for board games: one positional seed
// (the first rest argument) plus an optional --seed flag; the flag wins.
// Both accept an integer in [0, SEED_MAX]. Returns { seed } on success,
// or { error } with the shared help-message text for the caller to print.
// `args` must be the raw argv array (unknown-flag detection), `p` the
// CmdBase.parseArgs() result, whose `declared` flag list gates the check.
export function seedFromArgs(args, p) {
    const flagSeed = p.flag('--seed');
    const posSeed = p.rest.length ? parseSeed(p.rest[0]) : undefined;
    const declared = p.declared || [];
    const unknownFlag = args.some((arg) => arg.startsWith('-') &&
        !declared.includes(arg.split('=')[0]));
    if (unknownFlag || p.rest.length > 1 || posSeed === null ||
        (flagSeed !== null && parseSeed(flagSeed) === null)) {
        return {
            error: 'invalid arguments: seed must be an integer from 0 to '
                + SEED_MAX,
        };
    }
    return { seed: flagSeed !== null ? parseSeed(flagSeed) : posSeed };
}
