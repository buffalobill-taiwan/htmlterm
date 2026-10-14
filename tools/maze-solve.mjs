#!/usr/bin/env node
/** Reproduce and solve the live maze from its seed and difficulty. */
import { generateMaze, DIFFICULTY } from '../js/cmd/maze/board.js';
import { parseMazeArgs } from '../js/cmd/maze/args.js';

const usage = `Usage: node tools/maze-solve.mjs <seed> [easy|medium|hard] [--path] [--ptt] [--puzzle]

Seed: 0–2147483647. Difficulty defaults to medium.
--seed N / --seed=N and --easy / --medium / --hard are also accepted.
Prints the maze without an answer: ██ wall, Ｓ start, Ｅ exit (2 columns/tile).
--path shows the answer with ． and appends ordered zero-based row,col coordinates.
--ptt uses one █ and one ─ per tile for PTT's fullwidth block/border rendering.
--puzzle with --path also appends the maze without the answer.

Replay example: maze 123456 --hard
Tool example: node tools/maze-solve.mjs 123456 hard --puzzle --path
`;
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage);
    process.exit(0);
}
let options;
try {
    options = parseMazeArgs(args.filter(arg => !['--puzzle', '--path', '--ptt'].includes(arg)));
    if (options.seed === null) throw new Error('A seed is required.');
} catch (err) {
    process.stderr.write(err.message + '\n' + usage);
    process.exit(1);
}
const { seed, difficulty } = options;
const [width, height] = DIFFICULTY[difficulty];
const walls = generateMaze(width, height, seed);
const parent = new Int32Array(walls.length).fill(-1);
const queue = [0];
parent[0] = 0;
for (let i = 0; i < queue.length; i++) {
    const pos = queue[i], x = pos % width, y = Math.floor(pos / width);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (walls[next] || parent[next] !== -1) continue;
        parent[next] = pos;
        queue.push(next);
    }
}
if (parent[walls.length - 1] === -1) {
    process.stderr.write('Maze has no route to the exit.\n');
    process.exit(1);
}
const path = [];
for (let pos = walls.length - 1; ; pos = parent[pos]) {
    path.push(pos);
    if (pos === 0) break;
}
path.reverse();
const route = new Set(path);
const showPath = args.includes('--path');
const wall = args.includes('--ptt') ? '█' : '██';
const border = '─'.repeat(width * (args.includes('--ptt') ? 1 : 2));
function formatBoard(solution) {
    const rows = ['┌' + border + '┐'];
    for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
            const pos = y * width + x;
            row += pos === 0 ? 'Ｓ' : pos === walls.length - 1 ? 'Ｅ'
                : walls[pos] ? wall : solution && route.has(pos) ? '．' : '　';
        }
        rows.push('│' + row + '│');
    }
    rows.push('└' + border + '┘');
    return rows.join('\n');
}
const out = [
    `Maze seed ${seed}  difficulty ${difficulty}  size ${width}x${height}  steps ${path.length - 1}`,
    `Replay: maze ${seed} --${difficulty}`,
    '', showPath ? 'Solution:' : 'Maze:', formatBoard(showPath),
];
if (args.includes('--puzzle') && showPath) out.push('', 'Puzzle:', formatBoard(false));
if (showPath) out.push('', 'Path (row,col; zero-based):',
    path.map(pos => `${Math.floor(pos / width)},${pos % width}`).join(' '));
process.stdout.write(out.join('\n') + '\n');
