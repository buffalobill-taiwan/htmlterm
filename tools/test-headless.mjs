#!/usr/bin/env node
/**
 * test-headless.mjs — Automated headless unit and smoke test suite for htmlterm.
 *
 * Runs without a browser DOM to verify:
 * - Screen & Parser ANSI/VT100 compatibility, SGR 16/256/24-bit RGB mappings,
 *   CJK wide glyphs, IRM, CSI limits, mouse modes, resize, scrollback
 * - VirtualBuffer composition, child slots, inline SGR writing
 * - Game generation and solver seed determinism (Sudoku, Minesweeper, Nurikabe)
 * - Pixel codec & animation diff compression/decompression
 * - Command module export integrity and lazy-game descriptors
 *
 * Usage:
 *   node tools/test-headless.mjs
 */

import { Screen } from '../js/terminal/Screen.js';
import { Parser } from '../js/terminal/Parser.js';
import { VirtualBuffer } from '../js/util/VirtualBuffer.js';
import { applySGR, defaultAttr, rgbToAnsi256 } from '../js/util/sgr.js';
import { computeRLE, computeDiff, decodeRLE, applyDiff } from '../js/util/pixel-codec.js';
import { _generate as generateSudoku } from '../js/cmd/sudoku/solver.js';
import { generatePuzzle as generateMinesweeper } from '../js/cmd/minesweeper/solver.js';
import { generatePuzzle as generateNurikabe } from '../js/util/nurikabe-engine.js';
import { CommandRegistry } from '../js/system/CommandRegistry.js';
import * as cmdModule from '../js/cmd/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function test(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') {
            return result.then(() => {
                console.log(`✓ ${name}`);
                passed++;
            }, (e) => {
                console.error(`✗ ${name}:`, e.message);
                failed++;
            });
        }
        console.log(`✓ ${name}`);
        passed++;
        return Promise.resolve();
    } catch (e) {
        console.error(`✗ ${name}:`, e.message);
        failed++;
        return Promise.resolve();
    }
}

function makeParser(onSend = () => {}) {
    const screen = new Screen(80, 25);
    const parser = new Parser(screen, { onSend });
    return { screen, parser };
}

console.log('--- htmlterm Headless Test Suite ---\n');

const queue = [];

async function run() {

queue.push(test('Screen & Parser: Basic text and cursor positioning', () => {
    const { screen, parser } = makeParser();

    parser.write('Hello, world!\x1B[5;10HTest');
    assert(screen.curY === 4, `curY should be 4, got ${screen.curY}`);
    assert(screen.curX === 13, `curX should be 13, got ${screen.curX}`);

    const row0 = screen.getRowAt(0);
    const row4 = screen.getRowAt(4);
    assert(row0[0].ch === 'H' && row0[4].ch === 'o', 'Row 0 text mismatch');
    assert(row4[9].ch === 'T' && row4[12].ch === 't', 'Row 4 text mismatch');
}));

queue.push(test('Screen & Parser: Wide CJK character handling & continuation cells', () => {
    const { screen, parser } = makeParser();

    parser.write('中');
    const row = screen.getRowAt(0);
    assert(row[0].ch === '中' && row[0].width === 2, 'Wide lead cell not width 2');
    assert(row[1].ch === '' && row[1].width === 0, 'Continuation cell not width 0');
    assert(screen.curX === 2, `curX should be 2 after wide char, got ${screen.curX}`);

    screen.curX = 1;
    parser.write('A');
    assert(row[0].ch === ' ' && row[0].width === 1, 'Orphaned wide char should become blank');
    assert(row[1].ch === 'A', 'Overwritten continuation cell mismatch');
}));

queue.push(test('Screen & Parser: Wide-glyph erase repairs continuation cell', () => {
    const { screen, parser } = makeParser();
    parser.write('中');
    const row = screen.getRowAt(0);
    assert(row[0].width === 2 && row[1].width === 0, 'Setup wide glyph');
    screen.curX = 0;
    parser.write('\x1B[X'); // erase one cell at cursor; _repairRow fixes the orphan
    assert(row[0].ch === ' ' && row[0].width === 1, 'Lead cell erased to blank');
    assert(row[1].ch === ' ' && row[1].width === 1, 'Orphaned continuation repaired to blank');
}));

queue.push(test('Screen & Parser: SGR colors, attributes & 24-bit Truecolor mapping', () => {
    const { screen, parser } = makeParser();

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
}));

queue.push(test('SGR: applySGR and rgbToAnsi256 direct evaluation', () => {
    const attr = defaultAttr();
    applySGR(attr, [38, 2, 0, 255, 0, 48, 2, 0, 0, 255]);
    assert(attr.fg === 10 || attr.fg === 46, `Expected green index 10 or 46, got ${attr.fg}`);
    assert(attr.bg === 12 || attr.bg === 21, `Expected blue index 12 or 21, got ${attr.bg}`);

    assert(rgbToAnsi256(0, 0, 0) === 0 || rgbToAnsi256(0, 0, 0) === 16, 'Black mapping');
    assert(rgbToAnsi256(255, 255, 255) === 15 || rgbToAnsi256(255, 255, 255) === 231, 'White mapping');
}));

queue.push(test('Screen & Parser: conceal attribute is stored', () => {
    const { screen, parser } = makeParser();
    parser.write('\x1B[8mH\x1B[0m');
    assert(screen.getRowAt(0)[0].conceal === true, 'conceal should be true after SGR 8');
}));

queue.push(test('Screen & Parser: DEC private modes (2000, 2004, 1049, 25)', () => {
    const { screen, parser } = makeParser();

    parser.write('\x1B[?2004h');
    assert(screen.modes.bracketedPaste === true, 'Mode 2004h should enable bracketedPaste');
    parser.write('\x1B[?2004l');
    assert(screen.modes.bracketedPaste === false, 'Mode 2004l should disable bracketedPaste');
    parser.write('\x1B[?2000h');
    assert(screen.modes.bracketedPaste === true, 'Mode 2000h should enable bracketedPaste');
    parser.write('\x1B[?2000l');
    assert(screen.modes.bracketedPaste === false, 'Mode 2000l should disable bracketedPaste');

    parser.write('\x1B[?25l');
    assert(screen.cursorHidden === true, 'Mode 25l should hide cursor');
    parser.write('\x1B[?25h');
    assert(screen.cursorHidden === false, 'Mode 25h should show cursor');

    parser.write('MainScreen\x1B[?1049hAltScreen');
    assert(screen.getRowAt(0)[0].ch === 'A', 'Alt screen first char mismatch');
    parser.write('\x1B[?1049l');
    assert(screen.getRowAt(0)[0].ch === 'M', 'Restored main screen first char mismatch');
}));

queue.push(test('Screen & Parser: Insert mode (IRM) shifts row right', () => {
    const { screen, parser } = makeParser();
    parser.write('ABC');
    screen.curX = 1;
    parser.write('\x1B[4h');
    assert(screen.modes.insertMode === true, 'CSI 4h enables insertMode');
    parser.write('X');
    const row = screen.getRowAt(0);
    assert(row[0].ch === 'A' && row[1].ch === 'X' && row[2].ch === 'B' && row[3].ch === 'C',
        'Insert mode should shift rest of row right');
    parser.write('\x1B[4l');
    assert(screen.modes.insertMode === false, 'CSI 4l disables insertMode');
}));

queue.push(test('Screen & Parser: DEL ignored; CAN aborts CSI', () => {
    const { screen, parser } = makeParser();
    parser.write('A\x7fB');
    assert(screen.getRowAt(0)[0].ch === 'A' && screen.getRowAt(0)[1].ch === 'B',
        'DEL (0x7F) should not print or delete');
    parser.write('\x1B[31\x18mC'); // ESC [ 31 CAN then 'mC' — CAN aborts CSI
    // After CAN, state returns to ground; 'm' and 'C' are printable
    const row = screen.getRowAt(0);
    const chars = [];
    for (let i = 0; i < 8; i++) if (row[i] && row[i].ch) chars.push(row[i].ch);
    assert(chars.join('').includes('C'), 'After CAN abort, following text should print');
}));

queue.push(test('Screen & Parser: Oversized CSI is dropped', () => {
    const { screen, parser } = makeParser();
    parser.write('Z');
    // CSI longer than 128 bytes before final — retained stops growing; final still ends CSI
    const longParams = '1;'.repeat(80);
    parser.write('\x1B[' + longParams + 'H');
    // Cursor should not jump to a wild position from truncated junk; screen still usable
    parser.write('Q');
    const found = screen.getRowAt(0).some(c => c && c.ch === 'Q') ||
        screen.getRowAt(screen.curY).some(c => c && c.ch === 'Q');
    assert(found, 'Terminal remains writable after oversized CSI');
}));

queue.push(test('Screen & Parser: Mouse event type and SGR encoding are independent', () => {
    const { screen, parser } = makeParser();
    parser.write('\x1B[?1000;1006h');
    assert(screen.mouseMode === 1000, `mouseMode should be 1000, got ${screen.mouseMode}`);
    assert(screen.mouseEncoding === 1006, `mouseEncoding should be 1006, got ${screen.mouseEncoding}`);
    parser.write('\x1B[?1002h');
    assert(screen.mouseMode === 1002, '1002h should replace event mode');
    assert(screen.mouseEncoding === 1006, 'SGR encoding should remain after event mode change');
    parser.write('\x1B[?1006l');
    assert(screen.mouseEncoding === 0, '1006l clears SGR encoding');
    assert(screen.mouseMode === 1002, 'Clearing encoding should not clear event mode');
}));

queue.push(test('Screen & Parser: resize refits width and resets scroll region', () => {
    const { screen, parser } = makeParser();
    parser.write('Hello');
    parser.write('\x1B[5;20r');
    assert(screen.scrollTop === 4 && screen.scrollBottom === 19, 'Scroll region set');
    assert(screen.getRowAt(0)[0].ch === 'H', 'Content written before region change');
    screen.resize(40, 25);
    assert(screen.cols === 40, 'cols should be 40 after resize');
    assert(screen.scrollTop === 0 && screen.scrollBottom === 24,
        'Scroll region resets to full screen on resize');
    assert(screen.getRowAt(0)[0].ch === 'H', 'Content refit preserves leading char');
    assert(screen.getRowAt(0).length === 40, 'Row width refit to new cols');
}));

queue.push(test('Screen & Parser: cursor-only movement marks no dirty rows', () => {
    const { screen, parser } = makeParser();
    parser.write('Hi');
    screen.dirtyRows.clear();
    parser.write('\x1B[A\x1B[B\x1B[C\x1B[D');
    assert(screen.dirtyRows.size === 0, 'Pure cursor motion should not dirty rows');
}));

queue.push(test('VirtualBuffer: Layout, child slots and writeStr with SGR', () => {
    const vb = new VirtualBuffer(40, 10);
    vb.writeStr(0, 0, '\x1B[1;32mGreen\x1B[0m Plain');
    const cell0 = vb.getCell(0, 0);
    const cell6 = vb.getCell(0, 6);
    assert(cell0.ch === 'G' && cell0.fg === 2 && cell0.bold === true, 'Green bold text mismatch');
    assert(cell6.ch === 'P' && cell6.bold === false, 'Plain text mismatch');

    const child = new VirtualBuffer(10, 2);
    child.writeStr(0, 0, 'Child');
    const slot = vb.addChildSlot();
    slot.vb = child;
    slot.x = 5;
    slot.y = 2;
    slot.active = true;

    const rendered = vb.render();
    assert(rendered[2][5].ch === 'C', 'Child buffer blit at (5, 2) mismatch');
}));

queue.push(test('PixelCodec: computeRLE, computeDiff, decodeRLE & applyDiff roundtrip', () => {
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
}));

queue.push(test('SudokuEngine: Deterministic generation and board validation', () => {
    const a = generateSudoku('easy', 123456);
    const b = generateSudoku('easy', 123456);
    assert(Array.isArray(a.board) && a.board.length === 9, 'Sudoku board should be 9x9');
    let clueCount = 0;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            assert(a.board[r][c] === b.board[r][c], 'Same seed must yield identical board');
            assert(a.solution[r][c] === b.solution[r][c], 'Same seed must yield identical solution');
            if (a.given[r][c]) {
                clueCount++;
                assert(a.board[r][c] === a.solution[r][c], 'Clue cell value must match solution');
            }
        }
    }
    assert(clueCount > 0, 'Sudoku clueCount should be > 0');
}));

queue.push(test('MinesweeperEngine: Deterministic generation and safe start', () => {
    const a = generateMinesweeper('easy', 123456, { row: 3, col: 3 });
    const b = generateMinesweeper('easy', 123456, { row: 3, col: 3 });
    assert(a.board.length === 8 && a.board[0].length === 8, 'Minefield dimension mismatch for easy (8x8)');
    assert(a.start.row === 3 && a.start.col === 3, 'First reveal coordinates mismatch');
    assert(a.board[3][3] !== -1, 'Safe start cell must not be a mine');
    assert(typeof a.solvable === 'boolean', 'Minesweeper solvable flag must be boolean');
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            assert(a.board[r][c] === b.board[r][c], 'Same seed/start must yield identical minefield');
        }
    }
}));

queue.push(test('NurikabeEngine: Deterministic puzzle generation', () => {
    const a = generateNurikabe(8, 8, { seed: 123456 });
    const b = generateNurikabe(8, 8, { seed: 123456 });
    assert(a !== null && a.R === 8 && a.C === 8, 'Nurikabe puzzle dimension mismatch');
    assert(Array.isArray(a.clues) && Array.isArray(a.solution), 'Nurikabe clues and solution must be arrays');
    assert(JSON.stringify(a.clues) === JSON.stringify(b.clues), 'Same seed must yield identical clues');
}));

queue.push(test('Command index: eager classes and lazy game descriptors', () => {
    assert(typeof cmdModule.Help === 'function' && cmdModule.Help.commandName === 'help',
        'Help should remain an eager class');
    assert(cmdModule.TetrisCmd && cmdModule.TetrisCmd.lazy === true, 'TetrisCmd should be lazy');
    assert(typeof cmdModule.TetrisCmd.load === 'function', 'TetrisCmd.load required');
    assert(cmdModule.JpmjCmd.lazy === true && cmdModule.MemoryCmd.lazy === true,
        'jpmj and memory should be lazy');
    assert(cmdModule.TetrisCmd.commandName === 'tetris', 'lazy meta commandName');
    assert(cmdModule.TetrisCmd.help && cmdModule.TetrisCmd.usage, 'lazy meta help/usage');
}));

queue.push(test('CommandRegistry: lazy games register without instances', () => {
    const registry = new CommandRegistry(cmdModule);
    assert(registry.cmdList.some(c => c.name === 'tetris'), 'tetris in cmdList');
    assert(registry.cmdList.some(c => c.name === 'help'), 'help in cmdList');
    assert(registry.instances.help, 'eager help should be instantiated');
    assert(!registry.instances.tetris, 'lazy tetris must not be instantiated at register');
    assert(!registry.instances.jpmj, 'lazy jpmj must not be instantiated at register');
    assert(typeof registry.loaders.tetris === 'function', 'tetris loader present');
    assert(registry.menuItems.some(m => m.name === 'tetris'), 'tetris in menuItems');
}));

queue.push(test('Lazy load: tetris meta resolves to Cmd class', async () => {
    const Cls = await cmdModule.TetrisCmd.load();
    assert(typeof Cls === 'function', 'load() should return a class');
    assert(Cls.commandName === 'tetris', 'loaded class commandName');
    assert(Cls.help === cmdModule.TetrisCmd.help, 'loaded help matches meta');
}));

    await Promise.all(queue);

    console.log(`\n================================`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

run();
