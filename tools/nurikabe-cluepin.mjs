#!/usr/bin/env node
/**
 * nurikabe-cluepin — audit the generator's final clue-pin rule (rule 6).
 *
 * generatePuzzle now runs the final clue-pin rule: when an island can legally
 * change shape, its clue is moved onto the swapped-in cell, which pins the
 * shape rigid. A puzzle ships only when every island ends up rigid; otherwise
 * the board is discarded and the attempt retries with the next carve.
 *
 * Because only rigid boards are ever returned, this tool audits what actually
 * ships: it regenerates the seed's puzzle (single attempt) and re-checks the
 * residual flexibility — a single-cell swap that keeps the whole board a valid
 * solution (non-exhaustive). The output is:
 *   seed N RIGID   — a rigid puzzle shipped
 *   seed N FAIL    — residual flexibility (should not occur; signals a bug)
 * and when the single attempt found no rigid board (the retry cost, i.e. the
 * old FAIL rate):
 *   seed N RETRY   — generation failed this seed; caller should advance seed
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
    process.stdout.write(`seed ${seed} RETRY (no rigid ${size}×${size} board in this attempt)\n`);
    process.exit(0);
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
    process.stdout.write(`seed ${seed} RIGID (${islands.length} islands, all rigid)\n`);
} else {
    process.stdout.write(`seed ${seed} FAIL (${islands.length} islands, ${flexible.length} flexible: ${flexible.join(', ')})\n`);
}