#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseSeed } from '../js/util/random.js';
import { generate, verify, suit, rank } from '../js/cmd/cardgames/freecell/engine.js';
export { generate, verify, applyMove, applyReverseMove, validate, metrics, constructionMetrics } from '../js/cmd/cardgames/freecell/engine.js';

const usage = `Usage: node tools/freecell-generate.mjs <seed> [--batch N] [--json]
       node tools/freecell-generate.mjs --verify file.json
Microsoft-compatible deals, seed 0..2147483647 (0 is an extension).
No solution or solvability guarantee. --verify accepts legacy certificates.`;
function main(args) {
    if (args.includes('--help')) { console.log(usage); return; }
    const flags = new Map(), positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (['--json'].includes(a)) flags.set(a, true);
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
        console.log(JSON.stringify({ count, meanGenerationMs: mean(r => r.generationMs) }, null, 2));
    } else {
        const r = results[0], label = c => 'SHDC'[suit(c)] + ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][rank(c) - 1];
        console.log(`FreeCell seed ${seed}, generator v${r.version}, Microsoft deal (solvability unchecked)`);
        r.board.columns.forEach((col, i) => console.log(`${i + 1}: ${col.map(label).join(' ')}`));

    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch (e) { console.error(e.message + '\n' + usage); process.exitCode = 1; }
}
