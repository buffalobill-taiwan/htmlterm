#!/usr/bin/env node
// Validate game-analyze JSON and maintain one file per endgame plus an index.
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateEndgame } from '../js/cmd/cchess/endgames.js';

async function main() {
    const args = process.argv.slice(2), option = args.indexOf('--output');
    if (option < 0 || !args[option+1]) throw new Error('Usage: node tools/cchess-import.mjs --output <directory> <puzzle.json> ...');
    const directory = path.resolve(args[option+1]);
    args.splice(option, 2);
    if (!args.length || args.some(arg => arg.startsWith('--'))) throw new Error('請指定殘局 JSON 檔案');
    const incoming = [];
    for (const file of args) incoming.push(validateEndgame(JSON.parse(await fs.readFile(file, 'utf8'))));
    let index = [];
    try { index = JSON.parse(await fs.readFile(path.join(directory, 'index.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!Array.isArray(index)) throw new Error('索引格式錯誤');
    const byInit = new Map();
    for (const entry of index) {
        if (!/^[a-z0-9-]+\.json$/.test(entry.file)) throw new Error('索引檔名錯誤');
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
    await fs.mkdir(directory, { recursive: true });
    for (const [file, puzzle] of outputs) await fs.writeFile(path.join(directory, file), JSON.stringify(puzzle, null, 2)+'\n');
    await fs.writeFile(path.join(directory, 'index.json'), JSON.stringify(index, null, 2)+'\n');
    console.log(`Imported ${incoming.length} puzzles; index contains ${index.length} entries`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
