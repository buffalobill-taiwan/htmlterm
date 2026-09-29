#!/usr/bin/env node
/** Reproduce the live Sudoku puzzle and answer from its seed and difficulty. */
import { _generate, parseSeed } from '../js/cmd/sudoku/solver.js';
import { DIFFICULTY } from '../js/cmd/sudoku/constants.js';

const usage = `Usage: node tools/sudoku-solve.mjs <seed> [easy|medium|hard] [--puzzle] [--clues]

Seed must be an integer from 0 to 2147483647. Difficulty defaults to medium.
The solution is printed first. --puzzle appends the original puzzle with dots
for empty cells; --clues appends an 81-digit clue string (0 = empty).
Difficulty flags --easy, --medium and --hard are also accepted.

Examples:
  node tools/sudoku-solve.mjs 123456
  node tools/sudoku-solve.mjs 123456 hard --puzzle --clues
  node tools/sudoku-solve.mjs 0 --easy --puzzle
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
let emitPuzzle = false;
let emitClues = false;
for (const arg of args) {
    if (arg === '--puzzle') emitPuzzle = true;
    else if (arg === '--clues') emitClues = true;
    else if (['--easy', '--medium', '--hard'].includes(arg)) {
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

function formatBoard(board) {
    const lines = ['┌───────┬───────┬───────┐'];
    for (let r = 0; r < 9; r++) {
        const groups = [];
        for (let c = 0; c < 9; c += 3)
            groups.push(board[r].slice(c, c + 3).map(n => n || '.').join(' '));
        lines.push('│ ' + groups.join(' │ ') + ' │');
        if (r === 2 || r === 5) lines.push('├───────┼───────┼───────┤');
    }
    lines.push('└───────┴───────┴───────┘');
    return lines.join('\n');
}

const puzzle = _generate(difficulty, seed);
const clues = puzzle.board.flat().filter(Boolean).length;
const out = [
    `Sudoku seed ${puzzle.seed}  difficulty ${difficulty}  clues ${clues}`,
    `Replay: sudoku ${puzzle.seed} --${difficulty}`,
    '', 'Solution:', formatBoard(puzzle.solution),
];
if (emitPuzzle) out.push('', 'Puzzle (clues only):', formatBoard(puzzle.board));
if (emitClues) out.push('', puzzle.board.flat().join(''));
process.stdout.write(out.join('\n') + '\n');
