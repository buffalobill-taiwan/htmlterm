#!/usr/bin/env node
/**
 * nurikabe-cluepin — audit the generator's final clue-pin rule (rule 6).
 *
 * generatePuzzle now runs the final rule from the clue-pin experiment: when an
 * island can legally change shape, its clue is moved onto the swapped-in cell,
 * which pins the shape rigid — but the pass applies only if every island ends
 * rigid (SUCCESS); otherwise the placed clues are kept (FAIL).
 *
 * This tool regenerates a seed's puzzle and measures the residual flexibility:
 * any island that can still change shape after generation is a FAIL, matching
 * the experiment's FAIL definition. "Can change shape" is a single-cell swap
 * that keeps the whole board a valid solution (non-exhaustive).
 *
 * Usage:
 *   node tools/nurikabe-cluepin.mjs <seed> [size]
 *
 * Examples:
 *   node tools/nurikabe-cluepin.mjs 250
 *   node tools/nurikabe-cluepin.mjs 250 16
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 */

import { generatePuzzle, geom, WHITE, BLACK, enumeratePuzzleIslands, islandSwapInfo } from '../js/util/nurikabe-engine.js';

const seed = parseInt(process.argv[2], 10);
const size = parseInt(process.argv[3] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-cluepin.mjs <seed> [size]\n');
    process.exit(1);
}

const puzzle = generatePuzzle(size, size, { seed, maxAttempts: 1 });

if (!puzzle) {
    process.stderr.write(`Failed to generate ${size}×${size} puzzle with seed ${seed}.\n`);
    process.exit(1);
}

const R = puzzle.R;
const C = puzzle.C;

const cluesFlat = new Int32Array(R * C);
const state = new Int8Array(R * C);
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c;
    cluesFlat[i] = puzzle.clues[r][c];
    state[i] = puzzle.solution[r][c];
}

const g = geom(R, C);
const p = { R, C, clues: cluesFlat };
const islands = enumeratePuzzleIslands(state, g);

const flexible = [];
for (const isl of islands) {
    const { swaps } = islandSwapInfo(state, g, p, isl.cells);
    if (swaps.length) {
        let clue = 0;
        for (const c of isl.cells) if (cluesFlat[c] > 0) { clue = cluesFlat[c]; break; }
        flexible.push(`clue${clue}(${swaps.length})`);
    }
}

if (flexible.length === 0) {
    process.stdout.write(`seed ${seed} SUCCESS (${islands.length} islands, all rigid)\n`);
} else {
    process.stdout.write(`seed ${seed} FAIL (${islands.length} islands, ${flexible.length} flexible: ${flexible.join(', ')})\n`);
}