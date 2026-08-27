#!/usr/bin/env node
/**
 * nurikabe-solve — Reproduce a Nurikabe puzzle from its seed.
 *
 * Usage:
 *   node tools/nurikabe-solve.mjs <seed> [size]
 *
 * Examples:
 *   node tools/nurikabe-solve.mjs 123456
 *   node tools/nurikabe-solve.mjs 123456 16
 *
 * size defaults to 12 (medium). Use 7 for easy, 16 for hard.
 *
 * Output uses ██ for sea, fullwidth space (　) for island, and fullwidth
 * digits for clue ≤ 9.  Cell width = 2 halfwidth chars throughout.
 */

import { generatePuzzle, formatClue, WHITE, BLACK } from '../js/util/nurikabe-engine.js';

const SP = '\u3000'; // fullwidth space  (width 2)
const SEA = '██';     // two halfwidth blocks (width 2)

function formatSolution(puzzle) {
    const { R, C, clues, solution } = puzzle;
    const lines = [];
    const inner = '─'.repeat(C * 2);
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

const seed = parseInt(process.argv[2], 10);
const size = parseInt(process.argv[3] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-solve.mjs <seed> [size]\n');
    process.exit(1);
}

const puzzle = generatePuzzle(size, size, { seed, maxAttempts: 1 });

if (!puzzle) {
    process.stderr.write(`Failed to generate ${size}×${size} puzzle with seed ${seed}.\n`);
    process.exit(1);
}

process.stdout.write(formatSolution(puzzle) + '\n');
