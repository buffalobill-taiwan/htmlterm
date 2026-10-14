#!/usr/bin/env node
// Focused generation checks: node tools/test-maze.mjs
import assert from 'node:assert/strict';
import { generateMaze, DIFFICULTY } from '../js/cmd/maze/board.js';
import { scoreMaze, isBetterMazeScore } from '../js/cmd/maze/generation-score.js';

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

// Repeatable sampling without adding a seed option to the game API.
const originalRandom = Math.random;
let seed = 0x6d617a65;
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
try {
    for (const [difficulty, [width, height]] of Object.entries(DIFFICULTY)) {
        let covered = 0, late = 0;
        const start = performance.now();
        for (let i = 0; i < 200; i++) {
            const walls = generateMaze(width, height);
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
