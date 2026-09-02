#!/usr/bin/env node
/**
 * nurikabe-debug — Show every formation step of a Nurikabe puzzle from its seed.
 *
 * Usage:
 *   node tools/nurikabe-debug.mjs <seed> [size] [--noretry] [--ptt] [--clueonly]
 *
 * Examples:
 *   node tools/nurikabe-debug.mjs 123456
 *   node tools/nurikabe-debug.mjs 123456 16
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 *
 * Each stage of the generator (matching the attempt-0 stream used by
 * generatePuzzle / generateDraftPuzzle) is printed in order:
 *   1. initial   — checkerboard where even rows/cols are sea
 *   2. flips     — after flipping odd rows OR odd columns, then whole-board mirroring
 *   3. carve     — after thinning to the chosen island count
 *   4. trim      — after sea trim (islands filled / minimal sea)
 *   5. clues     — after placing the clue cells
 *   6. final     — after the rigidity (clue-pin) pass
 *
 * By default a seed whose rigidity pass fails (RETRY) is shown as its pre-pin
 * final board instead of failing. Pass --noretry for single-attempt behaviour:
 * such seeds then report "Failed to generate" instead.
 *
 * Output uses ██ for sea, fullwidth space (　) for island, and fullwidth digits
 * for clue ≤ 9. Cell width = 2 halfwidth chars throughout.
 *
 * Pass --ptt to render for PTT-style terminals, where █ and the box drawing
 * chars are fullwidth (one cell each): sea becomes a single █ and the border
 * dash count halves, so each row stays exactly `size` cells.
 *
 * Pass --clueonly to render the sea as fullwidth space (　) as well, hiding the
 * solution the same way as the puzzle (see nurikabe-solve).
 */

import { geom, WHITE, BLACK, formatClue, islandCountBand, pinIslandShapes, buildAttempt, enumeratePuzzleIslands, islandSwapInfo } from '../js/util/nurikabe-engine.js';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));

const ptt = flags.includes('--ptt');
const noRetry = flags.includes('--noretry');
const clueOnly = flags.includes('--clueonly');

const SP = '\u3000';        // fullwidth space (width 2)
const SEA = clueOnly ? SP : (ptt ? '█' : '██'); // clueonly → blank sea, else one fullwidth block (PTT) or two halfwidth
const DASH = ptt ? '─' : '─'.repeat(2); // border unit: fullwidth dash vs halfwidth pair
const HL_OUT = '\x1B[41;31m'; // solid red — island cell that can change shape (become sea)
const HL_IN = '\x1B[42m';   // green bg — sea cell that can change shape (become island)
const HL_RESET = '\x1B[0m';
const FLEX_OUT = 1;         // flex[] marker: island cell that can become sea (red)
const FLEX_IN = 2;          // flex[] marker: sea cell that can become island (green)

const B_SEA = 1;   // internal black (sea)
const W_ISL = 0;   // internal white (island)

// `board` is a flat array in the engine's internal model (B_SEA/W_ISL).
// `clues` is a flat array of clue values (0 = none). Any element may be null to
// mark "not yet meaningful at this stage" and render as blank.
// `flex` is a Set of flexible cell indices (RETRY): island cells → red,
// sea cells → green, matching nurikabe-dupcheck's HL_OUT/HL_IN.
function render(R, C, board, clues = null, flex = null) {
    const lines = [];
    const inner = DASH.repeat(C);
    lines.push('┌' + inner + '┐');
    for (let r = 0; r < R; r++) {
        let row = '│';
        for (let c = 0; c < C; c++) {
            const i = r * C + c;
            const clue = clues ? clues[i] : 0;
            if (clue > 0) {
                row += formatClue(clue);
            } else if (board && board[i] === B_SEA) {
                // Flexible sea cells render as a blank green cell (as in
                // nurikabe-dupcheck), not the solid SEA block, so the green
                // background stays visible.
                row += (flex && flex[i] === FLEX_IN) ? HL_IN + SP + HL_RESET : SEA;
            } else if (flex && flex[i] === FLEX_OUT) {
                // Flexible island cell that can become sea — solid red.
                row += HL_OUT + SP + HL_RESET;
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
    process.stderr.write('Usage: node tools/nurikabe-debug.mjs <seed> [size] [--noretry] [--ptt] [--clueonly]\n');
    process.exit(1);
}

const band = islandCountBand(size, size);
const stages = {};
const attemptSeed = seed; // attempt 0: seed + 0 * 2654435761

const d = buildAttempt(size, size, band, attemptSeed, (board, tag) => {
    if (board) stages[tag] = board.slice();
});

if (!d) {
    process.stderr.write(`Failed to generate ${size}×${size} puzzle with seed ${seed}.\n`);
    process.exit(1);
}

// Final rigidity pass on the engine's own cell model, exactly as generatePuzzle.
const state = new Int8Array(size * size);
for (let i = 0; i < size * size; i++) state[i] = d.trimmed[i] === B_SEA ? BLACK : WHITE;
const cluesFlat = d.clues;
const g = geom(size, size);
const pinned = pinIslandShapes(state, cluesFlat, size, size, g);

const chunks = [];
chunks.push(`Nurikabe seed ${seed}  size ${size}  (island count ${d.islands})`);
chunks.push('');

chunks.push('[1] initial — even rows/cols are sea');
chunks.push(render(size, size, stages['initial']));
chunks.push('');

chunks.push('[2] after odd-row/odd-col flips and whole-board mirroring');
chunks.push(render(size, size, stages['mirrored']));
chunks.push('');

chunks.push(`[3] carved to island count = ${d.islands}`);
chunks.push(render(size, size, d.carve));
chunks.push('');

chunks.push('[4] after sea trim (islands filled)');
chunks.push(render(size, size, d.trimmed));
chunks.push('');

chunks.push('[5] clue cells placed');
chunks.push(render(size, size, d.trimmed, cluesFlat));
chunks.push('');

if (pinned) {
    const finalState = new Int8Array(size * size);
    for (let i = 0; i < size * size; i++) finalState[i] = state[i] === BLACK ? B_SEA : W_ISL;
    chunks.push('[6] final — rigid (clue-pin) solution');
    chunks.push(render(size, size, finalState, cluesFlat));
} else if (!noRetry) {
    // The pre-pin board was discarded: it has residual flexibility. Find every
    // flexible island and highlight, as in nurikabe-dupcheck, both the sea cells
    // it could legally move into (green) and the island cells it could vacate
    // (red) — the cells whose shape can change.
    const p = { R: size, C: size, clues: cluesFlat };
    const islands = enumeratePuzzleIslands(state, g);
    const flex = new Int8Array(size * size);
    const flexible = [];
    for (const isl of islands) {
        const { swaps } = islandSwapInfo(state, g, p, isl.cells);
        if (swaps.length) {
            let clue = 0;
            for (const c of isl.cells) if (cluesFlat[c] > 0) { clue = cluesFlat[c]; break; }
            let sea = 0;
            for (const { a, b } of swaps) {
                flex[a] = FLEX_OUT;
                if (flex[b] === 0) { flex[b] = FLEX_IN; sea++; }
            }
            flexible.push(`clue${clue}(${sea} sea cells)`);
        }
    }
    const finalState = new Int8Array(size * size);
    for (let i = 0; i < size * size; i++) finalState[i] = state[i] === BLACK ? B_SEA : W_ISL;
    chunks.push('[6] rigidity pass failed (RETRY) — showing pre-pin board');
    chunks.push(render(size, size, finalState, cluesFlat, flex));
    chunks.push(flexible.length
        ? `  flexible islands: ${flexible.join(', ')}  (red cell = vacated island, green = sea it moves into)`
        : '  (no flexible islands detected)');
} else {
    process.stderr.write(`Failed to generate ${size}×${size} puzzle with seed ${seed}.\n`);
    process.exit(1);
}

process.stdout.write(chunks.join('\n') + '\n');
