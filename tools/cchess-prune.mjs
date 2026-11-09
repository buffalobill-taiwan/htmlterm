#!/usr/bin/env node
// Prune black responses that the lightweight black AI reproduces.
// Usage: node tools/cchess-prune.mjs --output js/data/cchess
import fs from 'node:fs/promises';
import path from 'node:path';
import { pruneEndgame } from '../js/cmd/cchess/endgames.js';
import { ENDGAME_FILE, parseOutput } from './cchess-files.mjs';

async function main() {
    const directory = parseOutput(process.argv.slice(2), 'Usage: node tools/cchess-prune.mjs --output <directory>');
    const files = (await fs.readdir(directory)).filter(f => ENDGAME_FILE.test(f) && f !== 'index.json');
    let before = 0, after = 0;
    for (const file of files) {
        const puzzle = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
        const text = JSON.stringify(puzzle, null, 2) + '\n';
        const pruned = await pruneEndgame(puzzle);
        const output = JSON.stringify(pruned, null, 2) + '\n';
        await fs.writeFile(path.join(directory, file), output);
        before += text.length; after += output.length;
        console.log(`${file}: ${Object.keys(puzzle.table).length} -> ${Object.keys(pruned.table).length} entries (${text.length} -> ${output.length} bytes)`);
    }
    console.log(`Total: ${before} -> ${after} bytes (${(100*(1-after/before)).toFixed(1)}% smaller)`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
