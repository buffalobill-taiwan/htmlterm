#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseSeed } from '../js/util/random.js';
import { generate, verify, suit, rank } from '../js/cmd/cardgames/freecell/engine.js';
export { generate, verify, applyMove, applyReverseMove, validate, metrics, constructionMetrics } from '../js/cmd/cardgames/freecell/engine.js';

const usage = `Usage: node tools/freecell-generate.mjs <seed> [--batch N] [--json] [--solution]
       node tools/freecell-generate.mjs --verify file.json
Seed: 0..2147483647. One reverse construction per seed, with a replay-verified solution.
Cards: integers 0..51, suits spades/hearts/diamonds/clubs, ranks A..K.
Columns are top-to-bottom. --json includes board, solution and construction statistics.
--batch generates consecutive seeds and reports retained moves and generation time.
--verify replays a saved certificate, including those exported by older versions.
There is no candidate ranking, difficulty threshold or forward search.`;
function main(args) {
    if (args.includes('--help')) { console.log(usage); return; }
    const flags = new Map(), positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (['--json', '--solution'].includes(a)) flags.set(a, true);
        else if (['--batch', '--verify'].includes(a)) {
            if (flags.has(a) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing/duplicate option: ' + a);
            flags.set(a, args[++i]);
        } else if (a.startsWith('-')) throw Error('Unknown option: ' + a);
        else positional.push(a);
    }
    if (flags.has('--verify')) {
        if (positional.length || flags.size !== 1) throw Error('Conflicting modes');
        const data = JSON.parse(readFileSync(flags.get('--verify'), 'utf8'));
        console.log(JSON.stringify({ verified: verify(data.board, data.solution) }));
        return;
    }
    if (positional.length !== 1 || parseSeed(positional[0]) === null) throw Error('Expected one valid seed');
    const seed = Number(positional[0]), count = Number(flags.get('--batch') ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw Error('Invalid --batch');
    if (seed + count - 1 > 2147483647) throw Error('Batch exceeds seed range');
    const results = [];
    for (let i = 0; i < count; i++) {
        const start = performance.now(), result = generate(seed + i);
        result.generationMs = Math.round((performance.now() - start) * 100) / 100;
        results.push(result);
    }
    if (flags.has('--json')) console.log(JSON.stringify(count === 1 ? results[0] : results, null, 2));
    else if (count > 1) {
        const mean = value => results.reduce((sum, r) => sum + value(r), 0) / count;
        const moves = results.map(r => r.solution.length).sort((a, b) => a - b);
        console.log(JSON.stringify({ count, verified: results.length,
            meanSolutionMoves: mean(r => r.solution.length),
            medianSolutionMoves: (moves[Math.floor((count - 1) / 2)] + moves[Math.floor(count / 2)]) / 2,
            meanEffectiveMoves: mean(r => r.shuffle.effectiveMoves),
            meanTransitionChecks: mean(r => r.shuffle.transitionChecks),
            maxColumnLengthDuringConstruction: Math.max(...results.map(r => r.shuffle.peakColumnLength)),
            meanGenerationMs: mean(r => r.generationMs),
            maxGenerationMs: Math.max(...results.map(r => r.generationMs)),
        }, null, 2));
    } else {
        const r = results[0], label = c => 'SHDC'[suit(c)] + ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][rank(c) - 1];
        console.log(`FreeCell seed ${seed}, generator v${r.version}, verified solution ${r.solution.length} moves`);
        r.board.columns.forEach((col, i) => console.log(`${i + 1}: ${col.map(label).join(' ')}`));
        console.log(JSON.stringify({ shuffle: r.shuffle, metrics: r.metrics, construction: r.construction, generationMs: r.generationMs }, null, 2));
        if (flags.has('--solution')) console.log(JSON.stringify(r.solution, null, 2));
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch (e) { console.error(e.message + '\n' + usage); process.exitCode = 1; }
}
