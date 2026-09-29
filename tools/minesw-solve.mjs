#!/usr/bin/env node
/** Reproduce the live minefield from its seed, difficulty and first revealed cell. */
import { generatePuzzle, parseStart, revealCells, _create2D } from '../js/cmd/minesweeper/solver.js';
import { DIFFICULTY } from '../js/cmd/minesweeper/constants.js';
import { parseSeed } from '../js/util/random.js';

const usage = `Usage: node tools/minesw-solve.mjs <seed> [easy|medium|hard] [--start R,C] [--puzzle] [--mines]

Seed: integer from 0 to 2147483647. Difficulty defaults to medium.
Start: zero-based row,col of the first revealed cell; defaults to the center
(easy 4,4; medium 6,8; hard 8,16). The seed, difficulty AND first revealed cell
must match the live game. --start only positions the game's initial cursor;
press Enter before moving it to reproduce the tool's board.

The solution shows * for mines and . for zero adjacent mines.
--puzzle appends the opening after the first reveal (? = still hidden).
--mines appends a row-major list of zero-based mine coordinates.
Difficulty flags --easy, --medium and --hard are also accepted.

Examples:
  node tools/minesw-solve.mjs 123456
  node tools/minesw-solve.mjs 123456 hard --start 0,0 --puzzle --mines
  node tools/minesw-solve.mjs 0 --easy --puzzle
`;

function fail(message) {
    process.stderr.write(message + '\n' + usage);
    process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage);
    process.exit(0);
}

const positional = [];
let difficultyFlag = null;
let startArg = null;
let emitPuzzle = false;
let emitMines = false;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--puzzle') emitPuzzle = true;
    else if (arg === '--mines') emitMines = true;
    else if (arg === '--start' || arg.startsWith('--start=')) {
        if (startArg !== null) fail('Specify only one starting cell.');
        startArg = arg === '--start' ? args[++i] : arg.slice('--start='.length);
        if (!startArg) fail('Missing starting cell.');
    } else if (['--easy', '--medium', '--hard'].includes(arg)) {
        if (difficultyFlag !== null) fail('Specify only one difficulty.');
        difficultyFlag = arg.slice(2);
    } else if (arg.startsWith('-')) fail('Unknown option: ' + arg);
    else positional.push(arg);
}

const seed = parseSeed(positional[0]);
if (positional.length > 2 || seed === null) fail('Invalid seed or arguments.');
if (positional[1] && difficultyFlag) fail('Specify difficulty either positionally or with a flag.');
const difficulty = difficultyFlag || positional[1] || 'medium';
if (!Object.hasOwn(DIFFICULTY, difficulty)) fail('Invalid difficulty: ' + difficulty);
const start = startArg !== null ? parseStart(startArg, difficulty) : null;
if (startArg !== null && !start) fail('Invalid starting cell: use zero-based row,col within the board.');

function formatBoard(board, revealed = null) {
    const border = '─'.repeat(board[0].length * 2 + 1);
    const lines = ['┌' + border + '┐'];
    for (let r = 0; r < board.length; r++) {
        const cells = board[r].map((n, c) =>
            revealed && !revealed[r][c] ? '?' : n === -1 ? '*' : n || '.');
        lines.push('│ ' + cells.join(' ') + ' │');
    }
    lines.push('└' + border + '┘');
    return lines.join('\n');
}

const puzzle = generatePuzzle(difficulty, seed, start);
const { rows, cols, mines } = DIFFICULTY[difficulty];
const { row, col } = puzzle.start;
const out = [
    `Minesweeper seed ${seed}  difficulty ${difficulty}  size ${rows}×${cols}  mines ${mines}`,
    `Start: ${row},${col} (zero-based)  attempts: ${puzzle.attempts}`,
    `Replay: minesw ${seed} --${difficulty} --start ${row},${col} (then Enter)`,
    puzzle.solvable ? 'Logic check: all safe cells deduced.' :
        'Logic check: 200-attempt limit reached; using the last board, as in the game. Guessing may be required.',
    '', 'Solution:', formatBoard(puzzle.board),
];
if (emitPuzzle) {
    const revealed = _create2D(cols, rows, false);
    revealCells(puzzle.board, revealed, row, col);
    out.push('', 'Puzzle (after first reveal):', formatBoard(puzzle.board, revealed));
}
if (emitMines) {
    const positions = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            if (puzzle.board[r][c] === -1) positions.push(`${r},${c}`);
    out.push('', positions.join(' '));
}
process.stdout.write(out.join('\n') + '\n');
