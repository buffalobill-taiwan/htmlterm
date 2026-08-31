#!/usr/bin/env node
/**
 * nurikabe-dupcheck — Look for alternative solutions in a seed-generated
 * Nurikabe puzzle by single island-shape swaps.
 *
 * The puzzle and its solution come from the same seed, so a duplicate solution
 * must amount to changing some island's shape while still satisfying every
 * rule.  For each island this tool enumerates every single swap of one island
 * cell that borders the sea (`a`) with one sea cell that borders the island
 * (`b`), tests the whole board, then reverts the swap.  Consecutive swaps are
 * not explored, so the check is deliberately non-exhaustive: finding a hit
 * proves an alternative solution exists, but alternatives needing more than one
 * swap can be missed.
 *
 * Usage:
 *   node tools/nurikabe-dupcheck.mjs <seed> [size] [--noretry] [--ptt] [--clueonly]
 *
 * Examples:
 *   node tools/nurikabe-dupcheck.mjs 123456
 *   node tools/nurikabe-dupcheck.mjs 123456 16
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 *
 * By default a seed whose rigidity pass fails (RETRY) is audited on the
 * discarded pre-pin board: the alternatives that block it from shipping are
 * rendered instead of failing. Pass --noretry for single-attempt behaviour:
 * such seeds then report "Failed to generate" instead.
 *
 * Pass --ptt to render for PTT-style terminals, where █ and the box drawing
 * chars are fullwidth (one cell each): sea becomes a single █ and the border
 * dash count halves, so each row stays exactly `size` cells.
 *
 * Pass --clueonly to render the sea as fullwidth space (　) as well, hiding the
 * solution the same way as the puzzle (see nurikabe-solve). In that mode the
 * green "sea cell became island" highlight sits on a blank background, so it is
 * hard to spot; the red "island cell became sea" highlight is unaffected.
 *
 * Output uses ██ for sea, fullwidth space (　) for island, and fullwidth
 * digits for clue ≤ 9.  Cell width = 2 halfwidth chars throughout.  In each
 * rendered alternative the moved cells are highlighted: solid red for the
 * island cell that became sea, green background for the sea cell that became
 * island.
 */

import { generatePuzzle, generateDraftPuzzle, geom, WHITE, BLACK, formatClue, enumeratePuzzleIslands, islandSwapInfo } from '../js/util/nurikabe-engine.js';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));

const ptt = flags.includes('--ptt');
const noRetry = flags.includes('--noretry');
const clueOnly = flags.includes('--clueonly');

const SP = '\u3000';          // fullwidth space (width 2)
const SEA = clueOnly ? SP : (ptt ? '█' : '██'); // clueonly → blank sea, else one fullwidth block (PTT) or two halfwidth
const DASH = ptt ? '─' : '─'.repeat(2); // border unit: fullwidth dash vs halfwidth pair
const HL_OUT = '\x1B[41;31m'; // solid red — island cell moved out (now sea)
const HL_IN = '\x1B[42m';     // green bg — sea cell moved in (now island)
const HL_RESET = '\x1B[0m';

// mark = { a, b }: cell indices to highlight in the rendered board.
function render(R, C, clues, state, mark = null) {
    const lines = [];
    const inner = DASH.repeat(C);
    lines.push('┌' + inner + '┐');
    for (let r = 0; r < R; r++) {
        let row = '│';
        for (let c = 0; c < C; c++) {
            const i = r * C + c;
            if (mark && i === mark.a) {
                row += HL_OUT + SEA + HL_RESET;
            } else if (mark && i === mark.b) {
                row += HL_IN + SP + HL_RESET;
            } else if (clues[r][c] > 0) {
                row += formatClue(clues[r][c]);
            } else if (state[i] === BLACK) {
                row += SEA;
            } else {
                row += SP;
            }
        }
        lines.push(row + '│');
    }
    lines.push('└' + inner + '┘');
    return lines.join('\n');
}

function coord(i, C) {
    return '(' + (((i / C) | 0) + 1) + ',' + ((i % C) + 1) + ')';
}

const seed = parseInt(positional[0], 10);
const size = parseInt(positional[1] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-dupcheck.mjs <seed> [size] [--noretry] [--ptt] [--clueonly]\n');
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

const R = puzzle.R;
const C = puzzle.C;
const clues = puzzle.clues;

const cluesFlat = new Int32Array(R * C);
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) cluesFlat[r * C + c] = clues[r][c];

const state = new Int8Array(R * C);
for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) state[r * C + c] = puzzle.solution[r][c];

const g = geom(R, C);
const p = { R, C, clues: cluesFlat };
const islands = enumeratePuzzleIslands(state, g).map((isl, id) => ({ id, cells: isl.cells }));

const found = [];
for (const isl of islands) {
    const { swaps, candidates } = islandSwapInfo(state, g, p, isl.cells);
    if (swaps.length) found.push({ id: isl.id, size: isl.cells.length, candidates, hits: swaps });
}

const chunks = [];
chunks.push(`Nurikabe seed ${seed}  size ${size}  (islands: ${islands.length})`);

chunks.push('');
chunks.push('[original solution]');
chunks.push(render(R, C, clues, state));

let total = 0;
for (const f of found) {
    let clue = 0;
    for (const c of islands[f.id].cells) {
        if (cluesFlat[c] > 0) { clue = cluesFlat[c]; break; }
    }
    chunks.push('');
    chunks.push(`island #${f.id}  clue ${clue}  (${f.size} cells, ${f.candidates} pairs tried)`);
    for (const { a, b } of f.hits) {
        total++;
        state[a] = BLACK;
        state[b] = WHITE;
        chunks.push(`  move ${coord(a, C)} -> ${coord(b, C)}`);
        chunks.push(render(R, C, clues, state, { a, b }));
        state[a] = WHITE;
        state[b] = BLACK;
    }
}

chunks.push('');
if (total === 0) {
    chunks.push('SUMMARY: no single island-shape swap preserves a solution (non-exhaustive).');
} else {
    chunks.push(`SUMMARY: ${found.length} island(s), ${total} alternative shape(s) found (single-swap check, non-exhaustive).`);
}

process.stdout.write(chunks.join('\n') + '\n');