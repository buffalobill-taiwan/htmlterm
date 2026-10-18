#!/usr/bin/env node
// Focused generation checks: node tools/test-maze.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bufWidth } from '../js/util/display-width.js';
import { parseMazeArgs } from '../js/cmd/maze/args.js';
import { scoreMaze, isBetterMazeScore } from '../js/cmd/maze/generation-score.js';
import { generateMaze, DIFFICULTY, isVisible } from '../js/cmd/maze/board.js';

// A known 20-step solution: across the top, then down the right edge.
const fixture = new Uint8Array(121).fill(1);
for (let x = 0; x < 11; x++) fixture[x] = 0;
for (let y = 0; y < 11; y++) fixture[y * 11 + 10] = 0;
assert.deepEqual(scoreMaze(fixture, 11, 11), { coverage: 0, lateFraction: 0, junctions: 0 });
// Four early junctions, with a nested fork at (4,2), and one late junction.
for (const [x, y] of [[2, 1], [4, 1], [4, 2], [3, 2], [5, 2], [8, 1], [9, 4], [9, 8]]) {
    fixture[y * 11 + x] = 0;
}
assert.deepEqual(scoreMaze(fixture, 11, 11), { coverage: 4, lateFraction: 1 / 8, junctions: 4 });
// The entire extension belongs to the late junction, not its own path segment.
fixture[8 * 11 + 8] = fixture[7 * 11 + 8] = 0;
assert.deepEqual(scoreMaze(fixture, 11, 11), { coverage: 4, lateFraction: 3 / 10, junctions: 4 });
// Exactly 80% belongs to the late region; exactly 20% begins the second segment.
const boundary = new Uint8Array(121).fill(1);
for (let x = 0; x < 11; x++) boundary[x] = 0;
for (let y = 0; y < 11; y++) boundary[y * 11 + 10] = 0;
boundary[11 + 2] = boundary[2 * 11 + 4] = boundary[11 + 4] = 0;
boundary[6 * 11 + 9] = 0;
assert.deepEqual(scoreMaze(boundary, 11, 11), { coverage: 2, lateFraction: 1 / 4, junctions: 2 });

const best = { coverage: 3, lateFraction: 0.2, junctions: 5 };
assert(isBetterMazeScore({ coverage: 4, lateFraction: 1, junctions: 1 }, best));
assert(!isBetterMazeScore({ coverage: 2, lateFraction: 0, junctions: 100 }, best));
assert(isBetterMazeScore({ ...best, lateFraction: 0.1, junctions: 1 }, best));
assert(!isBetterMazeScore({ ...best, lateFraction: 0.3, junctions: 100 }, best));
assert(isBetterMazeScore({ ...best, junctions: 6 }, best));
assert(!isBetterMazeScore({ ...best }, best));

// Vision: a straight corridor east of the spawn, matching the opening layout
// (player at (0,0), corridor (1,0)–(4,0), a cell one row below corridor end).
const vWidth = 8, vHeight = 4;
const corridor = new Uint8Array(vWidth * vHeight).fill(1);
for (const [x, y] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]) corridor[y * vWidth + x] = 0;
const doorway = new Uint8Array(corridor);
doorway[1 * vWidth + 2] = 0; // (2,1) is a passage leaving the corridor south
// Corridor tiles along the sightline are visible; distance 4 is not.
assert(isVisible(corridor, vWidth, 0, 0, 2, 0), 'corridor end visible');
assert(isVisible(corridor, vWidth, 0, 0, 1, 0), 'corridor step visible');
assert(!isVisible(corridor, vWidth, 0, 0, 4, 0), 'three-tile vision caps at distance 3');
// The cell past the corridor end must look the same whether sealed or open:
// the wall shows its face, the doorway shows the passage. No cascade either.
assert(isVisible(doorway, vWidth, 0, 0, 2, 1), 'doorway passage beside visible corridor visible');
assert(isVisible(corridor, vWidth, 0, 0, 2, 1), 'same cell as wall shows its face');
assert(!isVisible(doorway, vWidth, 0, 0, 2, 2), 'reveal is a single hop, no cascade');
// Corner posts still block: the L walk from the spawn falls on a wall cell.
assert(!isVisible(corridor, vWidth, 0, 0, 3, 1), 'occluded side wall stays hidden without a sight-visible neighbor');

function checkTree(walls, width, height) {
    assert(walls instanceof Uint8Array);
    assert.equal(walls.length, width * height);
    assert.equal(walls[0], 0);
    assert.equal(walls[walls.length - 1], 0);
    const neighbors = pos => {
        const x = pos % width, y = Math.floor(pos / width);
        return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
            .filter(([nx, ny]) => nx >= 0 && nx < width && ny >= 0 && ny < height && !walls[ny * width + nx])
            .map(([nx, ny]) => ny * width + nx);
    };
    const reached = new Set([0]), queue = [0];
    let twiceEdges = 0;
    for (let i = 0; i < queue.length; i++) {
        for (const next of neighbors(queue[i])) {
            twiceEdges++;
            if (!reached.has(next)) { reached.add(next); queue.push(next); }
        }
    }
    assert.equal(reached.size, walls.filter(v => v === 0).length, 'all passages connected');
    assert.equal(twiceEdges / 2, reached.size - 1, 'tree has no cycles');
    assert.equal(neighbors(walls.length - 1).length, 1, 'exit has only one entrance');
}

// Explicit seeds must not use ambient randomness.
const originalRandom = Math.random;
Math.random = () => { throw new Error('Unexpected ambient randomness'); };
try {
    for (const [difficulty, [width, height]] of Object.entries(DIFFICULTY)) {
        let covered = 0, late = 0;
        const start = performance.now();
        for (let i = 0; i < 200; i++) {
            const walls = generateMaze(width, height, i);
            checkTree(walls, width, height);
            const score = scoreMaze(walls, width, height);
            if (score.coverage === 4) covered++;
            late += score.lateFraction;
        }
        assert(covered >= 180, `${difficulty}: at least 90% cover all four early segments`);
        assert(late / 200 < 0.1, `${difficulty}: average late branch share below 10%`);
        console.log(`${difficulty}: ${covered}/200 cover four segments; late share ${(late / 2).toFixed(2)}%; ${((performance.now() - start) / 200).toFixed(2)}ms/game including checks`);
    }
} finally {
    Math.random = originalRandom;
}
console.log('Maze fixtures, ranking, connectivity, unique routes and branch distribution passed.');

assert.deepEqual(parseMazeArgs([]), { seed: null, difficulty: null });
assert.deepEqual(parseMazeArgs(['0']), { seed: 0, difficulty: 'medium' });
assert.deepEqual(parseMazeArgs(['--hard', '--seed', '2147483647']), { seed: 2147483647, difficulty: 'hard' });
assert.deepEqual(parseMazeArgs(['easy', '--seed=123']), { seed: 123, difficulty: 'easy' });
for (const args of [['--seed'], ['--seed='], ['-1'], ['1.5'], ['2147483648'], ['wat'], ['1', '2'], ['--easy', '--hard'], ['--seed', '0', '1']]) {
    assert.throws(() => parseMazeArgs(args));
}
for (const [difficulty, [width, height]] of Object.entries(DIFFICULTY)) {
    for (const seed of [0, 123456, 2147483647]) {
        const walls = generateMaze(width, height, seed);
        assert.deepEqual(generateMaze(width, height, seed), walls, 'same seed reproduces maze');
    }
    assert.notDeepEqual(generateMaze(width, height, 0), generateMaze(width, height, 1));
    const result = spawnSync(process.execPath, ['tools/maze-solve.mjs', '0', difficulty, '--puzzle', '--path'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const rows = result.stdout.split('Puzzle:\n')[1].split('\n').slice(1, height + 1).map(row => row.slice(1, -1));
    const walls = generateMaze(width, height, 0);
    for (let y = 0; y < height; y++) {
        assert.equal(bufWidth(rows[y]), width * 2);
        const tiles = rows[y].match(/██|[ＳＥ　]/g);
        assert.equal(tiles.length, width);
        for (let x = 0; x < width; x++) assert.equal(tiles[x] === '██', !!walls[y * width + x]);
    }
    const path = result.stdout.split('Path (row,col; zero-based):\n')[1].trim().split(' ').map(p => p.split(',').map(Number));
    assert.deepEqual(path[0], [0, 0]);
    assert.deepEqual(path.at(-1), [height - 1, width - 1]);
    for (let i = 0; i < path.length; i++) {
        const [y, x] = path[i];
        assert.equal(walls[y * width + x], 0);
        if (i) assert.equal(Math.abs(y - path[i - 1][0]) + Math.abs(x - path[i - 1][1]), 1);
    }
}
for (const args of [[], ['-1'], ['2147483648'], ['--seed'], ['0', '--unknown']]) {
    assert.equal(spawnSync(process.execPath, ['tools/maze-solve.mjs', ...args]).status, 1);
}
assert.equal(spawnSync(process.execPath, ['tools/maze-solve.mjs', '--help']).status, 0);
console.log('Seed parsing, reproducibility, offline maze and solution route checks passed.');

for (const flags of [[], ['--ptt']]) {
    const plain = spawnSync(process.execPath, ['tools/maze-solve.mjs', '0', 'easy', ...flags], { encoding: 'utf8' });
    assert.equal(plain.status, 0, plain.stderr);
    assert(!plain.stdout.includes('Solution:'));
    assert(!plain.stdout.includes('Path ('));
    const framed = plain.stdout.split('Maze:\n')[1].trimEnd().split('\n');
    assert.equal(framed.length, 12);
    const border = '─'.repeat(flags.length ? 20 : 40);
    assert.equal(framed[0], '┌' + border + '┐');
    assert.equal(framed.at(-1), '└' + border + '┘');
    for (const row of framed.slice(1, -1)) assert(row.startsWith('│') && row.endsWith('│'));
    if (!flags.length) for (const row of framed) assert.equal(bufWidth(row), 42);
    const rows = framed.slice(1, -1).map(row => row.slice(1, -1));
    assert.equal(rows.length, 10);
    const walls = generateMaze(20, 10, 0);
    for (let y = 0; y < 10; y++) {
        const tiles = rows[y].match(flags.length ? /█|[ＳＥ　]/g : /██|[ＳＥ　]/g);
        assert.equal(tiles.length, 20);
        assert(!rows[y].includes('．'));
        for (let x = 0; x < 20; x++) assert.equal(tiles[x].includes('█'), !!walls[y * 20 + x]);
    }
    assert(rows[0].startsWith('Ｓ'));
    assert(rows[9].endsWith('Ｅ'));
    const solved = spawnSync(process.execPath, ['tools/maze-solve.mjs', '0', 'easy', '--path', ...flags], { encoding: 'utf8' });
    assert.equal(solved.status, 0);
    assert(solved.stdout.includes('．'));
    assert(solved.stdout.includes('Path (row,col; zero-based):'));
}
console.log('Fullwidth tiles, PTT output and opt-in solution checks passed.');
