#!/usr/bin/env node
// Validate game-analyze JSON and maintain one file per endgame plus an index.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateEndgame, pruneEndgame } from '../js/cmd/cchess/endgames.js';
import { ENDGAME_FILE, parseOutput } from './cchess-files.mjs';

async function main() {
    const args = process.argv.slice(2);
    const directory = parseOutput(args, 'Usage: node tools/cchess-import.mjs --output <directory> <puzzle.json> ...');
    if (!args.length || args.some(arg => arg.startsWith('--'))) throw new Error('請指定殘局 JSON 檔案');
    const incoming = [];
    for (const file of args) {
        const puzzle = validateEndgame(JSON.parse(await fs.readFile(file, 'utf8')));
        incoming.push(await pruneEndgame(puzzle));
    }
    let index = [];
    try { index = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(index)) throw new Error('索引格式錯誤');
    const byInit = new Map();
    for (const entry of index) {
        if (!ENDGAME_FILE.test(entry.file)) throw new Error('索引檔名錯誤');
        const puzzle = JSON.parse(await fs.readFile(path.join(directory, entry.file), 'utf8'));
        byInit.set(puzzle.meta.init, entry);
    }
    const outputs = new Map();
    for (const puzzle of incoming) {
        let entry = byInit.get(puzzle.meta.init);
        if (!entry) {
            let n = index.length+1, id;
            do { id = `endgame-${String(n++).padStart(3, '0')}`; } while (index.some(item => item.id === id));
            entry = { id, name: puzzle.meta.name, step: puzzle.meta.step, file: `${id}.json` };
            index.push(entry); byInit.set(puzzle.meta.init, entry);
        }
        entry.name = puzzle.meta.name; entry.step = puzzle.meta.step;
        outputs.set(entry.file, puzzle);
    }
    index.sort((a, b) => a.step - b.step);
    await fs.mkdir(directory, { recursive: true });
    for (const [file, puzzle] of outputs) await fs.writeFile(path.join(directory, file), JSON.stringify(puzzle, null, 2)+'\n');
    await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(index, null, 2)+'\n');
    console.log(`Imported ${incoming.length} puzzles; index contains ${index.length} entries`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
