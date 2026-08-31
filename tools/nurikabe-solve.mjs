#!/usr/bin/env node
/**
 * nurikabe-solve — Reproduce a Nurikabe puzzle from its seed.
 *
 * Usage:
 *   node tools/nurikabe-solve.mjs <seed> [size] [--noretry] [--ptt]
 *
 * Examples:
 *   node tools/nurikabe-solve.mjs 123456
 *   node tools/nurikabe-solve.mjs 123456 16
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 *
 * By default a seed whose rigidity pass fails (RETRY) is shown as its
 * pre-pin board — the one the generator discards — instead of failing. Pass
 * --noretry for single-attempt behaviour: such seeds then report
 * "Failed to generate" instead.
 *
 * Output uses ██ for sea, fullwidth space (　) for island, and fullwidth
 * digits for clue ≤ 9.  Cell width = 2 halfwidth chars throughout.
 *
 * Pass --ptt to render for PTT-style terminals, where █ and the box drawing
 * chars are fullwidth (one cell each): sea becomes a single █ and the border
 * dash count halves, so each row stays exactly `size` cells.
 */

import { generatePuzzle, generateDraftPuzzle, formatClue, BLACK } from '../js/util/nurikabe-engine.js';

const args = process.argv.slice(2);
const ptt = args.includes('--ptt');
const noRetry = args.includes('--noretry');
const positional = args.filter((a) => a !== '--noretry' && a !== '--ptt');

const SP = '\u3000';        // fullwidth space (width 2)
const SEA = ptt ? '█' : '██'; // one fullwidth block (PTT) or two halfwidth (width 2)
const DASH = ptt ? '─' : '─'.repeat(2); // border unit: fullwidth dash vs halfwidth pair

function formatSolution(puzzle) {
    const { R, C, clues, solution } = puzzle;
    const lines = [];
    const inner = DASH.repeat(C);
    lines.push('┌' + inner + '┐');
    for (let r = 0; r < R; r++) {
        let row = '│';
        for (let c = 0; c < C; c++) {
            if (solution[r][c] === BLACK) {
                row += SEA;
            } else if (clues[r][c] > 0) {
                row += formatClue(clues[r][c]);
            } else {
                row += SP;
            }
        }
        lines.push(row + '│');
    }
    lines.push('└' + inner + '┘');
    return lines.join('\n');
}

const seed = parseInt(positional[0], 10);
const size = parseInt(positional[1] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-solve.mjs <seed> [size] [--noretry] [--ptt]\n');
    process.exit(1);
}

const opts = { seed, maxAttempts: 1 };
let puzzle = generatePuzzle(size, size, opts);

if (!puzzle && !noRetry) {
    puzzle = generateDraftPuzzle(size, size, opts);
}

if (!puzzle) {
    process.stderr.write(`Failed to generate ${size}×${size} puzzle with seed ${seed}.\n`);
    process.exit(1);
}

process.stdout.write(formatSolution(puzzle) + '\n');
