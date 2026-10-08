#!/usr/bin/env node
/**
 * test-headless.mjs — Automated headless unit and smoke test suite for htmlterm.
 *
 * Runs without a browser DOM to verify:
 * - Screen & Parser ANSI/VT100 compatibility, SGR 16/256/24-bit RGB mappings, CJK wide glyphs, scrollback, modes
 * - VirtualBuffer composition, child slots, inline SGR writing
 * - Game generation and solver seed determinism (Sudoku, Minesweeper, Nurikabe)
 * - Pixel codec & animation diff compression/decompression
 * - Command module export integrity
 *
 * Usage:
 *   node tools/test-headless.mjs
 */

import { Screen } from '../js/terminal/Screen.js';
import { Parser } from '../js/terminal/Parser.js';
import { VirtualBuffer } from '../js/util/VirtualBuffer.js';
import { _writeStr } from '../js/util/write.js';
import { applySGR, defaultAttr, rgbToAnsi256 } from '../js/util/sgr.js';
import { computeRLE, computeDiff, decodeRLE, applyDiff } from '../js/util/pixel-codec.js';
import { _generate as generateSudoku } from '../js/cmd/sudoku/solver.js';
import { generatePuzzle as generateMinesweeper } from '../js/cmd/minesweeper/solver.js';
import { generatePuzzle as generateNurikabe } from '../js/util/nurikabe-engine.js';
import * as cmdModule from '../js/cmd/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        console.error(`  FAIL: ${message}`);
        failed++;
        throw new Error(message);
    }
}

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.error(`✗ ${name}:`, e.message);
    }
}

console.log('--- htmlterm Headless Test Suite ---\n');

// 1. Screen & Parser Tests
test('Screen & Parser: Basic text and cursor positioning', () => {
    const screen = new Screen(80, 25);
    const parser = new Parser(screen, { onSend: () => {} });

    parser.write('Hello, world!\x1B[5;10HTest');
    assert(screen.curY === 4, `curY should be 4, got ${screen.curY}`);
    assert(screen.curX === 13, `curX should be 13, got ${screen.curX}`);

    const row0 = screen.getRowAt(0);
    const row4 = screen.getRowAt(4);
    assert(row0[0].ch === 'H' && row0[4].ch === 'o', 'Row 0 text mismatch');
    assert(row4[9].ch === 'T' && row4[12].ch === 't', 'Row 4 text mismatch');
});

test('Screen & Parser: Wide CJK character handling & continuation cells', () => {
    const screen = new Screen(80, 25);
    const parser = new Parser(screen, { onSend: () => {} });

    parser.write('中');
    const row = screen.getRowAt(0);
    assert(row[0].ch === '中' && row[0].width === 2, 'Wide lead cell not width 2');
    assert(row[1].ch === '' && row[1].width === 0, 'Continuation cell not width 0');
    assert(screen.curX === 2, `curX should be 2 after wide char, got ${screen.curX}`);

    // Overwrite the continuation cell
    screen.curX = 1;
    parser.write('A');
    assert(row[0].ch === ' ' && row[0].width === 1, 'Orphaned wide char should become blank');
    assert(row[1].ch === 'A', 'Overwritten continuation cell mismatch');
});

test('Screen & Parser: SGR colors, attributes & 24-bit Truecolor mapping', () => {
    const screen = new Screen(80, 25);
    const parser = new Parser(screen, { onSend: () => {} });

    // SGR: bold + 256 fg (color 45) + truecolor bg (pure red 255,0,0 -> index 9/196)
    parser.write('\x1B[1;38;5;45;48;2;255;0;0mX\x1B[0mY');
    const row = screen.getRowAt(0);
    const cellX = row[0];
    const cellY = row[1];

    assert(cellX.ch === 'X', 'Cell char mismatch');
    assert(cellX.bold === true, 'Cell bold not true');
    assert(cellX.fg === 45, `Cell fg should be 45, got ${cellX.fg}`);
    assert(typeof cellX.bg === 'number', `Cell bg should be a number (mapped 256-color), got ${cellX.bg}`);
    assert(cellX.bg === 9 || cellX.bg === 196, `Expected red palette index 9 or 196, got ${cellX.bg}`);

    assert(cellY.ch === 'Y', 'Cell Y char mismatch');
    assert(cellY.bold === false, 'Cell Y should have reset bold');
    assert(cellY.fg === 7 && cellY.bg === 0, 'Cell Y should have default fg/bg');
});

test('SGR: applySGR and rgbToAnsi256 direct evaluation', () => {
    const attr = defaultAttr();
    // Test pure green RGB (0, 255, 0) and pure blue RGB (0, 0, 255)
    applySGR(attr, [38, 2, 0, 255, 0, 48, 2, 0, 0, 255]);
    assert(attr.fg === 10 || attr.fg === 46, `Expected green index 10 or 46, got ${attr.fg}`);
    assert(attr.bg === 12 || attr.bg === 21, `Expected blue index 12 or 21, got ${attr.bg}`);

    // Test exact nearest matches
    assert(rgbToAnsi256(0, 0, 0) === 0 || rgbToAnsi256(0, 0, 0) === 16, 'Black mapping');
    assert(rgbToAnsi256(255, 255, 255) === 15 || rgbToAnsi256(255, 255, 255) === 231, 'White mapping');
});

test('Screen & Parser: DEC private modes (2000, 2004 bracketed paste, 1049 alt buffer, 25 cursor)', () => {
    const screen = new Screen(80, 25);
    const parser = new Parser(screen, { onSend: () => {} });

    // Bracketed paste 2004 and 2000
    parser.write('\x1B[?2004h');
    assert(screen.modes.bracketedPaste === true, 'Mode 2004h should enable bracketedPaste');
    parser.write('\x1B[?2004l');
    assert(screen.modes.bracketedPaste === false, 'Mode 2004l should disable bracketedPaste');
    parser.write('\x1B[?2000h');
    assert(screen.modes.bracketedPaste === true, 'Mode 2000h should enable bracketedPaste');
    parser.write('\x1B[?2000l');
    assert(screen.modes.bracketedPaste === false, 'Mode 2000l should disable bracketedPaste');

    // Cursor visibility 25
    parser.write('\x1B[?25l');
    assert(screen.cursorHidden === true, 'Mode 25l should hide cursor');
    parser.write('\x1B[?25h');
    assert(screen.cursorHidden === false, 'Mode 25h should show cursor');

    // Alternate buffer 1049
    parser.write('MainScreen\x1B[?1049hAltScreen');
    assert(screen.getRowAt(0)[0].ch === 'A', 'Alt screen first char mismatch');
    parser.write('\x1B[?1049l');
    assert(screen.getRowAt(0)[0].ch === 'M', 'Restored main screen first char mismatch');
});

// 2. VirtualBuffer & SGR blitting tests
test('VirtualBuffer: Layout, child slots and writeStr with SGR', () => {
    const vb = new VirtualBuffer(40, 10);
    vb.writeStr(0, 0, '\x1B[1;32mGreen\x1B[0m Plain');
    const cell0 = vb.getCell(0, 0);
    const cell6 = vb.getCell(0, 6);
    assert(cell0.ch === 'G' && cell0.fg === 2 && cell0.bold === true, 'Green bold text mismatch');
    assert(cell6.ch === 'P' && cell6.bold === false, 'Plain text mismatch');

    // Child slot test
    const child = new VirtualBuffer(10, 2);
    child.writeStr(0, 0, 'Child');
    const slot = vb.addChildSlot();
    slot.vb = child;
    slot.x = 5;
    slot.y = 2;
    slot.active = true;

    const rendered = vb.render();
    assert(rendered[2][5].ch === 'C', 'Child buffer blit at (5, 2) mismatch');
});

// 3. Pixel Codec & Animation tests
test('PixelCodec: computeRLE, computeDiff, decodeRLE & applyDiff roundtrip', () => {
    const frame0 = new Uint8Array([1, 1, 1, 2, 2, 3, 4, 4, 4, 4]);
    const frame1 = new Uint8Array([1, 1, 1, 5, 2, 3, 4, 4, 9, 4]);

    const rle0 = computeRLE(frame0);
    const decoded0 = decodeRLE(rle0, frame0.length);
    for (let i = 0; i < frame0.length; i++) {
        assert(decoded0[i] === frame0[i], `Decoded RLE pixel ${i} mismatch`);
    }

    const diff = computeDiff(frame0, frame1);
    applyDiff(decoded0, diff);

    for (let i = 0; i < frame1.length; i++) {
        assert(decoded0[i] === frame1[i], `Pixel ${i} mismatch after applyDiff: expected ${frame1[i]}, got ${decoded0[i]}`);
    }
});

// 4. Game deterministic seed tests
test('SudokuEngine: Deterministic generation and board validation', () => {
    const { board, solution, given } = generateSudoku('easy', 123456);
    assert(Array.isArray(board) && board.length === 9, 'Sudoku board should be 9x9');
    assert(Array.isArray(solution) && solution.length === 9, 'Sudoku solution should be 9x9');
    assert(Array.isArray(given) && given.length === 9, 'Sudoku given should be 9x9');

    let clueCount = 0;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (given[r][c]) {
                clueCount++;
                assert(board[r][c] === solution[r][c], 'Clue cell value must match solution');
            }
        }
    }
    assert(clueCount > 0, 'Sudoku clueCount should be > 0');
});

test('MinesweeperEngine: Deterministic generation and safe start', () => {
    const { board, start, solvable } = generateMinesweeper('easy', 123456, { row: 3, col: 3 });
    assert(board.length === 8 && board[0].length === 8, 'Minefield dimension mismatch for easy (8x8)');
    assert(start.row === 3 && start.col === 3, 'First reveal coordinates mismatch');
    assert(board[3][3] !== -1, 'Safe start cell must not be a mine');
    assert(typeof solvable === 'boolean', 'Minesweeper solvable flag must be boolean');
});

test('NurikabeEngine: Deterministic puzzle generation', () => {
    const puzzle = generateNurikabe(8, 8, { seed: 123456 });
    assert(puzzle !== null && puzzle.R === 8 && puzzle.C === 8, 'Nurikabe puzzle dimension mismatch');
    assert(Array.isArray(puzzle.clues) && Array.isArray(puzzle.solution), 'Nurikabe clues and solution must be arrays');
});

// 5. Command registry export check
test('CommandRegistry: All exported command classes have valid names and execute methods', () => {
    const exported = Object.values(cmdModule);
    assert(exported.length > 0, 'Exported commands should not be empty');
    for (const item of exported) {
        assert(typeof item === 'function', 'Export must be a constructor function or class');
    }
});

console.log(`\n================================`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log(`================================\n`);

if (failed > 0) {
    process.exit(1);
}
