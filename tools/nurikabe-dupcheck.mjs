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
 *   node tools/nurikabe-dupcheck.mjs <seed> [size]
 *
 * Examples:
 *   node tools/nurikabe-dupcheck.mjs 123456
 *   node tools/nurikabe-dupcheck.mjs 123456 16
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 *
 * Output uses ██ for sea, fullwidth space (　) for island, and fullwidth
 * digits for clue ≤ 9.  Cell width = 2 halfwidth chars throughout.  In each
 * rendered alternative the moved cells are highlighted: solid red for the
 * island cell that became sea, green background for the sea cell that became
 * island.
 */

import { generatePuzzle, geom, isSolved, WHITE, BLACK, formatClue } from '../js/util/nurikabe-engine.js';

const SP = '\u3000'; // fullwidth space  (width 2)
const SEA = '██';     // two halfwidth blocks (width 2)
const HL_OUT = '\x1B[41;31m'; // solid red — island cell moved out (now sea)
const HL_IN = '\x1B[42m';     // green bg — sea cell moved in (now island)
const HL_RESET = '\x1B[0m';

// mark = { a, b }: cell indices to highlight in the rendered board.
function render(R, C, clues, state, mark = null) {
    const lines = [];
    const inner = '─'.repeat(C * 2);
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

function enumerateIslands(state, g) {
    const owners = new Int32Array(g.N).fill(-1);
    const islands = [];
    for (let s = 0; s < g.N; s++) {
        if (state[s] !== WHITE || owners[s] !== -1) continue;
        const id = islands.length;
        const cells = [];
        const stack = [s];
        owners[s] = id;
        while (stack.length) {
            const cur = stack.pop();
            cells.push(cur);
            for (const nb of g.nbrs[cur]) {
                if (state[nb] === WHITE && owners[nb] === -1) {
                    owners[nb] = id;
                    stack.push(nb);
                }
            }
        }
        islands.push({ id, cells });
    }
    return { owners, islands };
}

function coord(i, C) {
    return '(' + (((i / C) | 0) + 1) + ',' + ((i % C) + 1) + ')';
}

const seed = parseInt(process.argv[2], 10);
const size = parseInt(process.argv[3] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-dupcheck.mjs <seed> [size]\n');
    process.exit(1);
}

const puzzle = generatePuzzle(size, size, { seed, maxAttempts: 1 });

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
const { islands } = enumerateIslands(state, g);

const found = [];
for (const isl of islands) {
    const hasBlackNbr = new Uint8Array(R * C);
    const seaAround = new Set();
    for (const c of isl.cells) {
        for (const nb of g.nbrs[c]) {
            if (state[nb] === BLACK) {
                hasBlackNbr[c] = 1;
                seaAround.add(nb);
            }
        }
    }
    const frontier = isl.cells.filter((c) => hasBlackNbr[c]);
    const seaList = [...seaAround];

    const hits = [];
    let tested = 0;
    for (const a of frontier) {
        for (const b of seaList) {
            tested++;
            state[a] = BLACK;
            state[b] = WHITE;
            const ok = isSolved(state, g, p);
            state[a] = WHITE;
            state[b] = BLACK;
            if (ok) hits.push({ a, b });
        }
    }
    if (hits.length) found.push({ id: isl.id, size: isl.cells.length, tested, hits });
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
    chunks.push(`island #${f.id}  clue ${clue}  (${f.size} cells, ${f.tested} swaps tested)`);
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