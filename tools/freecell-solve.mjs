#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseSeed } from '../js/util/random.js';
import { generate, verify, solve, suit, rank } from '../js/cmd/cardgames/freecell/engine.js';
export { generate, verify, solve, applyMove, validate, metrics } from '../js/cmd/cardgames/freecell/engine.js';

const usage = `Usage: node tools/freecell-solve.mjs <seed> [--candidates N] [--nodes N] [--batch N] [--json] [--solution]
       node tools/freecell-solve.mjs --verify file.json
       node tools/freecell-solve.mjs --solve file.json [--nodes N]
Seed: 0..2147483647. Defaults: 64 candidates, 10000 independent search nodes.
Cards: integers 0..51, suits spades/hearts/diamonds/clubs, ranks A..K.
Columns are top-to-bottom. --json includes board, replayable solution and metrics.
Quality screen: at most 8 automatic cards, buried-low depth >=24, blockers >=40.
At most 22 adjacent pairs may differ by 0–2 ranks; ranking favors fewer such pairs.
Top 8 structural candidates receive a separate 256-node search probe.
Quality scores/search effort are heuristics, NOT a difficulty guarantee.
--batch tests consecutive seeds and prints aggregate generation/search results.`;
function main(args) {
    if (args.includes('--help')) { console.log(usage); return; }
    const flags = new Map(), positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (['--json', '--solution'].includes(a)) flags.set(a, true);
        else if (['--candidates','--nodes','--batch','--verify','--solve'].includes(a)) {
            if (flags.has(a) || !args[i+1] || args[i+1].startsWith('--')) throw Error('Missing/duplicate option: '+a);
            flags.set(a,args[++i]);
        } else if (a.startsWith('-')) throw Error('Unknown option: '+a);
        else positional.push(a);
    }
    const number = (key, fallback, max) => {
        const v = flags.has(key) ? Number(flags.get(key)) : fallback;
        if (!Number.isInteger(v) || v < 1 || v > max) throw Error('Invalid '+key);
        return v;
    };
    const nodes = number('--nodes',10000,1000000);
    if (flags.has('--verify') || flags.has('--solve')) {
        if (positional.length || (flags.has('--verify') && flags.has('--solve'))) throw Error('Conflicting modes');
        const data = JSON.parse(readFileSync(flags.get('--verify') || flags.get('--solve'),'utf8'));
        if (flags.has('--verify')) console.log(JSON.stringify({ verified: verify(data.board,data.solution) }));
        else console.log(JSON.stringify(solve(data.board || data,nodes)));
        return;
    }
    if (positional.length !== 1 || parseSeed(positional[0]) === null) throw Error('Expected one valid seed');
    const seed = Number(positional[0]), count = number('--batch',1,1000), candidates = number('--candidates',64,4096);
    if (seed + count - 1 > 2147483647) throw Error('Batch exceeds seed range');
    const results = [];
    for (let i = 0; i < count; i++) {
        const start = performance.now(), result = generate(seed+i,candidates);
        result.generationMs = Math.round(performance.now()-start);
        const search = solve(result.board,nodes);
        if (search.solution) verify(result.board,search.solution);
        result.search = { status: search.status, nodes: search.nodes, moves: search.solution?.length ?? null };
        if (search.status === 'unsolvable') throw Error('Search contradicts verified certificate');
        results.push(result);
    }
    if (flags.has('--json')) console.log(JSON.stringify(count === 1 ? results[0] : results,null,2));
    else if (count > 1) console.log(JSON.stringify({ count, verified: results.length, automaticOnly: results.filter(r=>r.metrics.automaticCards===52).length,
        scoreRange: [Math.min(...results.map(r=>r.metrics.score)),Math.max(...results.map(r=>r.metrics.score))],
        generationMs: results.reduce((a,r)=>a+r.generationMs,0), solvedIndependently: results.filter(r=>r.search.status==='solved').length,
        unknown: results.filter(r=>r.search.status==='unknown').length },null,2));
    else {
        const r=results[0], label=c=>'SHDC'[suit(c)]+['A','2','3','4','5','6','7','8','9','10','J','Q','K'][rank(c)-1];
        console.log(`FreeCell seed ${seed}, generator v${r.version}, verified solution ${r.solution.length} moves`);
        r.board.columns.forEach((col,i)=>console.log(`${i+1}: ${col.map(label).join(' ')}`));
        console.log(JSON.stringify({metrics:r.metrics,search:r.search,generationMs:r.generationMs},null,2));
        if (flags.has('--solution')) console.log(JSON.stringify(r.solution,null,2));
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch(e) { console.error(e.message+'\n'+usage); process.exitCode=1; }
}
