#!/usr/bin/env node
/**
 * nurikabe-solve — Reproduce a Nurikabe puzzle from its seed.
 *
 * Usage:
 *   node tools/nurikabe-solve.mjs <seed> [size] [--noretry] [--ptt] [--puzzle] [--debug] [--clues]
 *
 * Examples:
 *   node tools/nurikabe-solve.mjs 123456
 *   node tools/nurikabe-solve.mjs 123456 16
 *   node tools/nurikabe-solve.mjs 123456 16 --debug
 *
 * size defaults to 12 (medium). Use 8 for easy, 16 for hard.
 *
 * Like the live game, a seed whose rigidity pass fails (RETRY) is discarded
 * and the next seed (seed+1, seed+2, …) is tried until one ships, so the board
 * shown is exactly the one the player would get (which may come from a later
 * seed). The shipping seed is reported in the header. Pass --noretry for
 * single-attempt behaviour: such seeds then report "Failed to generate"
 * instead of retrying.
 *
 * Output uses ██ for sea, fullwidth space (　) for island, and fullwidth
 * digits for clue ≤ 9.  Cell width = 2 halfwidth chars throughout.
 *
 * Pass --ptt to render for PTT-style terminals, where █ and the box drawing
 * chars are fullwidth (one cell each): sea becomes a single █ and the border
 * dash count halves, so each row stays exactly `size` cells.
 *
 * Pass --debug to also print the formation stages of the shipped seed (matching
 * the attempt stream used by generatePuzzle), in order, before the solved board:
 *   1. initial   — checkerboard where even rows/cols are sea
 *   2. flips     — after flipping odd rows OR odd columns, then whole-board mirroring
 *   3. carve     — after thinning to the chosen island count
 *   4. trim      — after sea trim (islands filled / minimal sea)
 *   5. clues     — after placing the clue cells
 *   6. pinned    — after the 1-swap rigidity (clue-pin) pass
 *   final        — after the 2-swap remedy pass (the shipped board); only its
 *                  note is printed since the solved board below is that board
 * When --noretry is combined with --debug and the single attempt fails, the
 * discarded pre-pin board is shown with its flexible islands highlighted.
 *
 * Pass --puzzle to append, after the solved board, an extra board showing only
 * the puzzle: sea is rendered as fullwidth space (　) just like the empty island
 * cells, so only the clue numbers stand out and the solution is not revealed.
 *
 * Pass --clues to append a final line holding the final board as
 * `<R> <C> "r,c,v r,c,v ..."` (1-indexed clue triplets), ready to feed
 * tools/nurikabe-dupcheck.py. When --noretry fails and --debug is on, the clue
 * grid of the discarded board is emitted as-is (pre-pin on a pin failure,
 * pre-remedy on a remedy failure).
 */

import { generatePuzzle, geom, WHITE, BLACK, formatClue, islandCountBand, pinIslandShapes, buildAttempt, enumeratePuzzleIslands, islandSwapInfo, remedy2Swap } from '../js/util/nurikabe-engine.js';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));

const ptt = flags.includes('--ptt');
const noRetry = flags.includes('--noretry');
const emitPuzzle = flags.includes('--puzzle');
const emitClues = flags.includes('--clues');
const debug = flags.includes('--debug');

const SP = '\u3000';        // fullwidth space (width 2)
const SEA = ptt ? '█' : '██'; // one fullwidth block (PTT) or two halfwidth
const DASH = ptt ? '─' : '─'.repeat(2); // border unit: fullwidth dash vs halfwidth pair
const HL_OUT = '\x1B[41;31m'; // solid red — island cell that can change shape (become sea)
const HL_IN = '\x1B[42m';   // green bg — sea cell that can change shape (become island)
const HL_RESET = '\x1B[0m';
const FLEX_OUT = 1;         // flex[] marker: island cell that can become sea (red)
const FLEX_IN = 2;          // flex[] marker: sea cell that can become island (green)

const B_SEA = 1;   // internal black (sea)
const W_ISL = 0;   // internal white (island)

// 2D solved-board renderer (puzzle objects from generatePuzzle). `sea` is the
// token used for sea cells: SEA for the solved view, SP for the clue-only view.
function formatBoard(puzzle, sea) {
    const { R, C, clues, solution } = puzzle;
    const lines = [];
    const inner = DASH.repeat(C);
    lines.push('┌' + inner + '┐');
    for (let r = 0; r < R; r++) {
        let row = '│';
        for (let c = 0; c < C; c++) {
            if (solution[r][c] === BLACK) {
                row += sea;
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

function formatSolution(puzzle) {
    return formatBoard(puzzle, SEA);
}

function formatClueOnly(puzzle) {
    return formatBoard(puzzle, SP);
}

// Flat stage renderer (formation/debug stages).
// `board` is a flat array in the engine's internal model (B_SEA/W_ISL).
// `clues` is a flat array of clue values (0 = none). Any element may be null to
// mark "not yet meaningful at this stage" and render as blank.
// `flex` is a Set of flexible cell indices (RETRY): island cells → red,
// sea cells → green, matching nurikabe-dupcheck's HL_OUT/HL_IN.
// `sea` is the token used for solid sea cells (SEA by default; pass SP for the
// clue-only / puzzle view).
function render(R, C, board, clues = null, flex = null, sea = SEA) {
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
                row += (flex && flex[i] === FLEX_IN) ? HL_IN + SP + HL_RESET : sea;
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

// Cells a pass relocated between two clue grids, as "clue5 (4,3)→(6,2)" strings:
// the pin pass (and likewise the 2-swap remedy) empties one clue cell and fills
// a new cell with the same value, so pair each vacated cell with the cell that
// gained its value.
function movedClues(size, from, to) {
    const left = new Map();     // value -> cells that lost it
    const entered = new Map();  // value -> cells that gained it
    for (let i = 0; i < size * size; i++) {
        if (from[i] > 0 && to[i] === 0) {
            if (!left.has(from[i])) left.set(from[i], []);
            left.get(from[i]).push(i);
        } else if (from[i] === 0 && to[i] > 0) {
            if (!entered.has(to[i])) entered.set(to[i], []);
            entered.get(to[i]).push(i);
        }
    }
    const out = [];
    for (const [v, fromCells] of left) {
        const toCells = entered.get(v) || [];
        for (let k = 0; k < fromCells.length; k++) {
            const a = fromCells[k], b = toCells[k];
            out.push(`clue${v} (${Math.floor(a / size)},${a % size})→(${Math.floor(b / size)},${b % size})`);
        }
    }
    return out;
}

const seed = parseInt(positional[0], 10);
const size = parseInt(positional[1] || '12', 10);

if (Number.isNaN(seed) || seed <= 0) {
    process.stderr.write('Usage: node tools/nurikabe-solve.mjs <seed> [size] [--noretry] [--ptt] [--puzzle] [--debug] [--clues]\n');
    process.exit(1);
}

const retryCap = size <= 8 ? 300 : size <= 12 ? 600 : 1200;
const maxAttempts = noRetry ? 1 : retryCap;
let puzzle = null;
let shippedSeed = seed;
for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const p = generatePuzzle(size, size, { seed: seed + attempt, maxAttempts: 1 });
    if (p) { puzzle = p; shippedSeed = seed + attempt; break; }
}

const out = [];

// Clue grid of the best available "final" board for --clues: the shipped
// puzzle's clues on success, otherwise whatever the last rigidity pass left on
// a --noretry discard (post-remedy / post-pin / pre-pin, in reachable order).
let finalClues = null;

// Under --debug, audit the shipped seed's formation: every stage up to the
// pinned board, plus the 2-swap remedy note (the solved board below doubles as
// the final board). --noretry failing means generatePuzzle discarded the board,
// so show the rigidity-failure analysis instead; a plain retry-cap exhaustion
// still fails hard with no audit.
if (debug && (puzzle || noRetry)) {
    const band = islandCountBand(size, size);
    const stages = {};
    const d = buildAttempt(size, size, band, shippedSeed, (board, tag) => {
        if (board) stages[tag] = board.slice();
    });
    if (d) {
        out.push(`Nurikabe seed ${seed} ships as ${shippedSeed}  size ${size}  (island count ${d.islands})`);
        out.push('');

        out.push('[1] initial — even rows/cols are sea');
        out.push(render(size, size, stages['initial']));
        out.push('');

        out.push('[2] after odd-row/odd-col flips and whole-board mirroring');
        out.push(render(size, size, stages['mirrored']));
        out.push('');

        out.push(`[3] carved to island count = ${d.islands}`);
        out.push(render(size, size, d.carve));
        out.push('');

        out.push('[4] after sea trim (islands filled)');
        out.push(render(size, size, d.trimmed));
        out.push('');

        out.push('[5] clue cells placed');
        const prePinClues = Int32Array.from(d.clues);
        out.push(render(size, size, d.trimmed, prePinClues));
        out.push('');

        // Final rigidity pass on the engine's own cell model, exactly as
        // generatePuzzle.
        const state = new Int8Array(size * size);
        for (let i = 0; i < size * size; i++) state[i] = d.trimmed[i] === B_SEA ? BLACK : WHITE;
        const cluesFlat = d.clues;
        const g = geom(size, size);
        const pinned = pinIslandShapes(state, cluesFlat, size, size, g);

        if (pinned) {
            const finalState = new Int8Array(size * size);
            for (let i = 0; i < size * size; i++) finalState[i] = state[i] === BLACK ? B_SEA : W_ISL;
            const pinMoved = movedClues(size, prePinClues, cluesFlat);
            const pinNote = pinMoved.length ? `  [moved clues: ${pinMoved.join(', ')}]` : '';
            out.push('[6] pinned — after the 1-swap rigidity (clue-pin) pass' + pinNote);
            out.push(render(size, size, finalState, cluesFlat));

            // [7] final — the 2-swap remedy pass, always part of the generator.
            // The pinned board is either already 2-swap rigid (a no-op) or gets
            // one remedy: the cooperative two-island escape's combined shape is
            // adopted and at most one clue is relocated, then the whole board is
            // re-verified from scratch. Only the note is printed: the solved
            // board below is this final board itself.
            const swapClues = Int32Array.from(cluesFlat);
            const swapState0 = state.slice();
            const swapOK = remedy2Swap(state, cluesFlat, size, size, g, { prePinClues });
            if (swapOK) {
                const swapMoved = movedClues(size, swapClues, cluesFlat);
                let shape = false;
                for (let i = 0; i < size * size; i++) if (swapState0[i] !== state[i]) { shape = true; break; }
                let note;
                if (shape && swapMoved.length) {
                    note = `  [2-swap remedy: shape adopted, clues moved: ${swapMoved.join(', ')}]`;
                } else if (shape) {
                    note = '  [2-swap remedy: shape adopted]';
                } else if (swapMoved.length) {
                    note = `  [2-swap remedy: clues moved: ${swapMoved.join(', ')}]`;
                } else {
                    note = '  (2-swap rigid, no remedy needed)';
                }
                out.push('[7] final — after the 2-swap remedy pass' + note);
                finalClues = cluesFlat;
            } else if (noRetry) {
                // The pinned board is 1-swap rigid but its escape pair could not
                // be rescued, so generatePuzzle discards it (RETRY).
                finalClues = swapClues;
                const swapBoard = new Int8Array(size * size);
                for (let i = 0; i < size * size; i++) swapBoard[i] = swapState0[i] === BLACK ? B_SEA : W_ISL;
                out.push('[7] 2-swap remedy failed (RETRY) — board discarded');
                out.push(render(size, size, swapBoard, swapClues));
            }
        } else if (noRetry) {
            // Only reachable under --noretry when the seed's single attempt
            // failed rigid: the pre-pin board was discarded. Find every flexible
            // island and highlight, as in nurikabe-dupcheck, both the sea cells
            // it could legally move into (green) and the island cells it could
            // vacate (red) — the cells whose shape can change.
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
            finalClues = cluesFlat;
            out.push('[6] rigidity pass failed (RETRY) — showing pre-pin board');
            out.push(render(size, size, finalState, cluesFlat, flex));
            out.push(flexible.length
                ? `  flexible islands: ${flexible.join(', ')}  (red cell = vacated island, green = sea it moves into)`
                : '  (no flexible islands detected)');
        }
    }
} else if (puzzle) {
    // Non-debug header (the debug header above carries the island count).
    out.push(`Nurikabe seed ${seed} ships as ${shippedSeed}  size ${size}`);
}

if (puzzle) {
    if (!debug) out.push('');
    out.push(formatSolution(puzzle));
    if (emitPuzzle) {
        out.push('');
        out.push('Puzzle (clues only):');
        out.push(formatClueOnly(puzzle));
    }
}

if (emitClues && (puzzle || finalClues)) {
    const tri = [];
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            // finalClues (flat) wins when set by the --debug audit, including on
            // a --noretry discard; otherwise fall back to the shipped puzzle.
            const v = finalClues ? finalClues[r * size + c] : puzzle.clues[r][c];
            if (v > 0) tri.push(`${r + 1},${c + 1},${v}`);
        }
    }
    out.push(`${size} ${size} "${tri.join(' ')}"`);
}

if (!puzzle) {
    // Always fail hard on a failed generation: print any audit output produced
    // under --debug first, then the error, so calling scripts keep the exit code.
    if (out.length) process.stdout.write(out.join('\n') + '\n');
    process.stderr.write(`Failed to generate ${size}×${size} puzzle with seed ${seed}.\n`);
    process.exit(1);
}

process.stdout.write(out.join('\n') + '\n');