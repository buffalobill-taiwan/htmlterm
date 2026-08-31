#!/usr/bin/env node
/**
 * nurikabe-cluepin — audit the generator's final clue-pin rule (rule 6).
 *
 * generatePuzzle now runs the final clue-pin rule: when an island can legally
 * change shape, its clue is moved onto the swapped-in cell, which pins the
 * shape rigid. A puzzle ships only when every island ends up rigid; otherwise
 * the board is discarded and the attempt retries with the next carve.
 *
 * This tool audits the seed's single-attempt board and reports how much
 * flexibility remains — a single-cell swap that keeps the whole board a valid
 * solution (non-exhaustive). The output is:
 *   seed N RIGID   — a rigid puzzle shipped (generator's pin pass held)
 *   seed N FAIL    — residual flexibility: a board that could not ship. From
 *                    the shipped board this signals a bug; by default this is
 *                    the discarded pre-pin board, audited to show exactly
 *                    which islands stay flexible (why RETRY).
 *   seed N RETRY   — no board at all in this attempt (single shot, --noretry,
 *                    or a carve that failed outright); caller should advance
 *                    the seed.
 *
 * Usage:
 *   node tools/nurikabe-cluepin.mjs <seed> [size] [--noretry] [--ptt] [--clueonly]
 *
 * Examples:
 *   node tools/nurikabe-cluepin.mjs 250
 *   node tools/nurikabe-cluepin.mjs 250 16
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 *
 * By default a seed whose rigidity pass fails is reported as FAIL, auditing
 * the discarded pre-pin board to show which islands stay flexible (that is
 * why the seed cannot ship). Pass --noretry for single-attempt behaviour:
 * such seeds then report RETRY instead.
 *
 * --ptt and --clueonly are accepted for CLI compatibility with the other
 * nurikabe tools but have no effect here: this tool prints status lines only,
 * never a board.
 */

import { generatePuzzle, generateDraftPuzzle, geom, WHITE, BLACK, enumeratePuzzleIslands, islandSwapInfo } from '../js/util/nurikabe-engine.js';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));

const noRetry = flags.includes('--noretry');

const seed = parseInt(positional[0], 10);
const size = parseInt(positional[1] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-cluepin.mjs <seed> [size] [--noretry] [--ptt] [--clueonly]\n');
    process.exit(1);
}

const opts = { seed, maxAttempts: 1 };
let puzzle = generatePuzzle(size, size, opts);

if (!puzzle && !noRetry) {
    puzzle = generateDraftPuzzle(size, size, opts);
}

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