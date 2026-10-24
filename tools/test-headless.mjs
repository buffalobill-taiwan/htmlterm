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

import { Typewriter } from '../js/system/typewriter.js';
import { Screen } from '../js/terminal/Screen.js';
import { Parser } from '../js/terminal/Parser.js';
import { VirtualBuffer } from '../js/util/VirtualBuffer.js';
import { applySGR, defaultAttr, rgbToAnsi256 } from '../js/util/sgr.js';
import { computeRLE, computeDiff, decodeRLE, applyDiff } from '../js/util/pixel-codec.js';
import { _generate as generateSudoku } from '../js/cmd/sudoku/solver.js';
import { generatePuzzle as generateMinesweeper } from '../js/cmd/minesweeper/solver.js';
import { generatePuzzle as generateNurikabe } from '../js/util/nurikabe-engine.js';
import { CommandRegistry } from '../js/system/CommandRegistry.js';
import { CmdBase } from '../js/cmd/CmdBase.js';
import { seedFromArgs } from '../js/util/seed-args.js';
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

test('Typewriter: timed column reveal, lifecycle and parser ordering', () => {
    const oldRAF = globalThis.requestAnimationFrame;
    const oldCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    const harness = () => {
        const { screen, parser } = makeParser();
        const writer = new Typewriter({
            isWide: ch => screen.isWide(ch),
            write: text => parser.write(text),
            beginTypewriterLineFeed: () => parser.beginTypewriterLineFeed(),
            advanceScroll: (op, rows) => screen.advanceScroll(op, rows),
            beginScaledChar: ch => parser.beginScaledChar(ch),
            revealScaledChar: (glyph, n) => screen.revealScaledChar(glyph, n),
        });
        return { screen, parser, writer };
    };
    try {
        const { screen, writer } = harness();
        writer.enqueue('\x1B[502m中');
        writer.enqueue('文\x1B[501m\n');
        writer._lastFrameTime = 0;
        let drained = false;
        writer.onDrain(() => { drained = true; });
        writer._tick(1);
        assert(!screen.buffer[0][0].clip, 'no column before 2ms');
        for (let col = 0; col < 4; col++) {
            writer._tick(2 * (col + 1));
            assert(screen.buffer[0][col].ch === '中' && screen.buffer[1][col].ch === '中', 'entire column appears together');
            if (col < 3) assert(!screen.buffer[0][col + 1].clip, 'next column stays hidden');
        }
        assert(!screen.buffer[0][4].clip && !drained, 'next glyph has not appeared');
        writer._tick(10);
        assert(screen.buffer[1][4].ch === '文', 'second glyph starts after first');
        writer.abort();
        assert(drained && screen.curY === 2 && screen.curX === 0, 'abort completes without duplicate glyph');

        for (let scale = 2; scale <= 10; scale++) {
            const timed = harness();
            timed.writer.enqueue(`\x1B[${500 + scale}m中`);
            timed.writer._lastFrameTime = 0;
            timed.writer._tick(scale - 1);
            assert(!timed.screen.buffer[0][0].clip, 'no column before scale milliseconds');
            for (let col = 0; col < 2 * scale; col++) {
                timed.writer._tick(scale * (col + 1));
                assert(timed.screen.buffer[scale - 1][col].ch === '中', 'column timing follows scale');
                if (col + 1 < 2 * scale) assert(!timed.screen.buffer[0][col + 1].clip, 'later column stays hidden');
            }
            assert(!timed.writer.isActive(), 'glyph finishes after width times scale milliseconds');
        }

        for (const scale of [2, 3, 10]) {
            const h = harness();
            const reference = makeParser();
            const input = `\x1B[25;79H\x1B[${500 + scale}m中A\x1B[31m文\x1B[501m\nend`;
            reference.parser.write(input);
            h.writer.enqueue(input);
            h.writer._lastFrameTime = 0;
            for (let t = 10000; h.writer.isActive() && t < 100000; t += 1000) h.writer._tick(t);
            assert(JSON.stringify(h.screen.buffer) === JSON.stringify(reference.screen.buffer), 'progressive buffer matches immediate output');
            assert(h.screen.curX === reference.screen.curX && h.screen.curY === reference.screen.curY, 'cursor matches after scrolling');
        }
        for (const input of [
            '\x1B[25;1H\x1B[510m中中中中中\x1B[501m\nend',
            '\x1B[25;1H\x1B[503m中\x1B[501m\nend',
            '\x1B[25;1H\x1B[503m中\x1B[501m\n',
            '\x1B[2;4r\x1B[4;1H\x1B[510m中\n文\x1B[501m',
        ]) {
            const h = harness();
            const reference = makeParser();
            reference.parser.write(input);
            h.writer.enqueue(input);
            h.writer._lastFrameTime = 0;
            for (let t = 1000; h.writer.isActive() && t < 100000; t += 1000) {
                h.writer._tick(t);
            }
            assert(!h.writer.isActive(), 'scrolling output drains');
            assert(JSON.stringify(h.screen.buffer) === JSON.stringify(reference.screen.buffer), 'scrolling result equals synchronous output');
            assert(JSON.stringify(h.screen.scrollback) === JSON.stringify(reference.screen.scrollback), 'scrollback equals synchronous output');
            assert(h.screen.curX === reference.screen.curX && h.screen.curY === reference.screen.curY, 'final cursor matches');
        }
        {
            const h = harness();
            h.writer.enqueue('\x1B[25;1H\x1B[510m中\x1B[501m');
            h.writer._lastFrameTime = 0;
            h.writer._tick(20);
            const glyph = h.writer._glyph;
            assert(glyph.scrollRemaining === 8 && glyph.shown === 2, 'scrolling and column reveal advance together');
            assert(h.screen.buffer[23][0].ch === '中' && h.screen.buffer[24][1].clipOffY === -1, 'visible slices appear before full height fits');
            assert(!h.screen.buffer[22][0].clip, 'glyph has not jumped to final position');
            const cell = h.screen.buffer[23][0];
            h.writer._tick(40);
            assert(h.screen.buffer[22][0] === cell, 'existing slices move with scroll without being rebuilt');
            assert(h.screen.buffer[24][0].clipOffY === -2, 'new bottom slices fill already revealed columns');
            assert(h.screen.buffer[22][3].ch === '中', 'new columns appear during same scroll frame');
            h.writer.abort();
            assert(h.screen.buffer[24][19].clipOffY === -9, 'flush finishes missing bottom slices');
        }

        // The viewport edge must not change horizontal timing, even at low or
        // irregular frame rates. Check both automatic wrap and explicit LF.
        for (const frameMs of [8, 16, 33, 100]) {
            for (const scale of [2, 3, 8, 10]) {
                const top = harness();
                const bottom = harness();
                bottom.parser.write('\x1B[25;1H');
                const input = `\x1B[${500 + scale}m中AB文中AB文中AB文\n中AB文\x1B[501m`;
                top.writer.enqueue(input);
                bottom.writer.enqueue(input);
                top.writer._lastFrameTime = bottom.writer._lastFrameTime = 0;
                for (let t = frameMs; (top.writer.isActive() || bottom.writer.isActive()) && t < 10000; t += frameMs) {
                    top.writer._tick(t);
                    bottom.writer._tick(t);
                    assert(top.writer._head === bottom.writer._head, 'scrolling adds no queue delay');
                    assert(top.writer._glyph?.shown === bottom.writer._glyph?.shown, 'same horizontal progress at every frame');
                    assert(top.writer._accumulator === bottom.writer._accumulator, 'scrolling preserves typing credit');
                    const g = bottom.writer._glyph;
                    if (g) assert(g.scrollRemaining === g.scrollTotal - Math.ceil(g.scrollTotal * g.shown / g.width), 'scroll progress follows reveal');
                }
                assert(!top.writer.isActive() && !bottom.writer.isActive(), 'both positions finish on same frame');
            }
        }
        {
            const h = harness();
            h.parser.write('\x1B[25;1H');
            h.writer.enqueue('\x1B[508m中文');
            h.writer._lastFrameTime = 0;
            h.writer._tick(136); // 128ms for 中, then one 8ms column of 文.
            assert(h.writer._glyph.cells[0].ch === '文' && h.writer._glyph.shown === 1, 'x8 starts next glyph without an extra frame');
            assert(h.screen.buffer[24][15].ch === '中', 'first glyph fully scrolled when printing finishes');
            h.writer.abort();
        }

        for (const action of ['abort', 'cancel', 'dispose']) {
            const h = harness();
            h.writer.enqueue('\x1B[25;1H\x1B[510m中後\x1B[501m');
            h.writer._lastFrameTime = 0;
            h.writer._tick(40);
            assert(h.writer._glyph.scrollRemaining === 7, 'glyph layout is waiting for scroll');
            h.writer[action]();
            assert(!h.writer.isActive(), 'interruption stops scheduling');
            if (action === 'dispose') {
                const before = JSON.stringify(h.screen.buffer);
                h.writer._tick(2000);
                assert(before === JSON.stringify(h.screen.buffer), 'disposed scroll cannot resume');
            } else {
                assert(h.screen.buffer[24][19].ch === '中', 'interruption completes current layout and glyph');
                assert(h.screen.buffer[15][20].ch === (action === 'abort' ? '後' : ' '), 'only abort prints queued glyph');
                assert(h.screen.attr.scale === 1, 'interruption restores scale');
            }
        }

        const h = harness();
        h.writer.enqueue('\x1B[510m中後');
        h.writer._lastFrameTime = 0;
        h.writer._tick(20);
        h.writer.cancel();
        assert(h.screen.buffer[9][19].ch === '中' && !h.screen.buffer[0][20].clip, 'cancel finishes only current glyph');
        assert(h.screen.attr.scale === 1 && !h.writer.isActive(), 'cancel resets state');
        h.writer.enqueue('\x1B[503m文');
        h.writer._lastFrameTime = 0;
        h.writer._tick(20);
        h.writer.dispose();
        const before = JSON.stringify(h.screen.buffer);
        h.writer._tick(500);
        assert(before === JSON.stringify(h.screen.buffer), 'dispose prevents later painting');
        const split = harness();
        split.writer.enqueue('\x1B[503m\x1B[');
        split.writer.enqueue('31m中');
        split.writer._lastFrameTime = 0;
        split.writer._tick(1000);
        assert(split.screen.buffer[0][0].ch === '中' && split.screen.buffer[0][0].fg === 1, 'split CSI stays in parser');
    } finally {
        globalThis.requestAnimationFrame = oldRAF;
        globalThis.cancelAnimationFrame = oldCancel;
    }
});

test('Scaled text: all sizes, CJK slices, wrap, reset and bottom scrolling', () => {
    for (let scale = 2; scale <= 10; scale++) {
        const { screen, parser } = makeParser();
        parser.write(`\x1B[${500 + scale}m中A`);
        assert(screen.curX === scale * 3, 'scaled advance');
        const cell = screen.buffer[scale - 1][scale * 2 - 1];
        assert(cell.ch === '中' && cell.clipScale === scale, 'CJK footprint');
        assert(cell.clipOffX === -(scale * 2 - 1) && cell.clipOffY === -(scale - 1), 'slice offsets');
        parser.write('\x1B[501m\nnormal');
        assert(screen.curY === scale && screen.buffer[scale][0].ch === 'n', 'newline clears full glyph');
        parser.write(`\x1B[25;79H\x1B[${500 + scale}m中\x1B[0m\n>`);
        assert(screen.curY === 24 && screen.curX === 1, 'prompt stays below glyph at bottom');
        assert(screen.buffer[23][0].ch === '中', 'bottom glyph retained above prompt');
        assert(screen.attr.scale === 1, 'SGR reset');
    }
});

test('Scaled text: mixed heights, legacy SGR and short scroll regions', () => {
    const { screen, parser } = makeParser();
    parser.write('\x1B[510mA\x1B[503mB\x1B[501m\nC');
    assert(screen.curY === 10, 'mixed line uses tallest glyph');
    parser.write('\x1B[500mD\x1B[501m');
    assert(screen.buffer[10][1].clipScale === 2, 'legacy SGR stays twofold');
    parser.write('\x1B[2;4r\x1B[2;1H\x1B[510m中\n中');
    assert(screen.buffer.length === 25 && screen.curY >= 1 && screen.curY <= 3, 'short region remains bounded');
});


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

queue.push(test('Lazy load: memory resolves from its directory entry', async () => {
    const Cls = await cmdModule.MemoryCmd.load();
    assert(typeof Cls === 'function' && Cls.commandName === 'memory',
        'memory directory index re-exports MemoryCmd');
    assert(Cls.help === cmdModule.MemoryCmd.help, 'memory loaded help matches meta');
}));

queue.push(test('SeedArgs: flag wins, positional fallback, shared error', () => {
    const cmd = new CmdBase();
    const parse = (args, flags) => cmd.parseArgs(args, { flags });

    // --seed flag wins over the positional seed.
    let p = parse(['3', '--seed', '7'], { '--seed': String });
    assert(seedFromArgs(['3', '--seed', '7'], p).seed === 7, 'flag seed wins');

    // A lone positional seed is the fallback.
    p = parse(['5'], {});
    assert(seedFromArgs(['5'], p).seed === 5, 'positional seed fallback');

    // SEED_MAX boundary accepted, one past it rejected.
    p = parse(['2147483647'], {});
    assert(seedFromArgs(['2147483647'], p).seed === 2147483647, 'SEED_MAX accepted');
    p = parse(['2147483648'], {});
    assert(seedFromArgs(['2147483648'], p).error, 'SEED_MAX+1 rejected');

    // Invalid flag seed, invalid positional, unknown flag, extra rest.
    p = parse(['5', '--seed', 'abc'], { '--seed': String });
    assert(seedFromArgs(['5', '--seed', 'abc'], p).error, 'bad flag seed rejected');
    p = parse(['abc'], {});
    assert(seedFromArgs(['abc'], p).error, 'bad positional seed rejected');
    p = parse(['5', '--nope'], {});
    assert(seedFromArgs(['5', '--nope'], p).error, 'unknown flag rejected');
    p = parse(['5', '6'], {});
    assert(seedFromArgs(['5', '6'], p).error, 'second rest arg rejected');
}));

test('Screen: alt buffer save/restore preserves primary state', () => {
    const { screen, parser } = makeParser();
    parser.write('hello');
    screen.cursorPos(3, 5);
    screen.setSGR([31]);
    parser.write('X');
    const px = screen.curX, py = screen.curY;
    screen.useAltBuffer();
    assert(screen.curX === 0 && screen.curY === 0, 'alt buffer resets cursor');
    parser.write('ALT');
    assert(screen.buffer[0][0].ch === 'A', 'writes go to alt buffer');
    screen.restorePrimaryBuffer();
    assert(screen.curX === px && screen.curY === py, 'restored cursor');
    assert(screen.buffer[2][4].ch === 'X', 'primary content intact');
});

test('Screen: scroll regions limit scrolling', () => {
    const { screen, parser } = makeParser();
    parser.write('\x1B[3;5r');
    parser.write('\x1B[1;1H');
    for (let i = 0; i < 10; i++) parser.write('a\n');
    assert(screen.scrollTop === 2 && screen.scrollBottom === 4, 'scroll region set');
    assert(screen.buffer[2][0].ch === 'a', 'content in scroll region scrolled');
});

test('Screen: insert mode shifts characters right', () => {
    const { screen, parser } = makeParser();
    parser.write('ABCD');
    screen.cursorPos(1, 3);
    parser.write('\x1B[4h');
    parser.write('X');
    assert(screen.buffer[0][0].ch === 'A', 'first char unchanged');
    assert(screen.buffer[0][2].ch === 'X', 'inserted char at cursor');
    assert(screen.buffer[0][3].ch === 'C', 'shifted char moved right');
    assert(screen.buffer[0][4].ch === 'D', 'shifted char moved right');
});

test('Screen: wide char wrapping at line end', () => {
    const { screen, parser } = makeParser();
    screen.resize(4, 3);
    parser.write('中');
    assert(screen.curX === 2, 'wide char advances by 2');
    parser.write('A');
    const hasWide = screen.buffer.some(row => row.some(c => c && c.ch === '中'));
    assert(hasWide, 'wide char present after operations');
});

test('Screen: eraseDisplay clears screen', () => {
    const { screen, parser } = makeParser();
    parser.write('hello');
    parser.write('\x1B[2J');
    for (let c = 0; c < screen.cols; c++) {
        assert(screen.buffer[0][c].ch === ' ', 'entire screen cleared');
    }
});

test('Parser: DEL ignored and CAN aborts CSI', () => {
    const { screen, parser } = makeParser();
    parser.write('A' + String.fromCharCode(0x7F) + 'B');
    assert(screen.buffer[0][0].ch === 'A', 'A written');
    assert(screen.buffer[0][1].ch === 'B', 'DEL ignored so B after');
    parser.write('\x1B[2J\x1B[H');
    parser.write('\x1B[31' + String.fromCharCode(0x18));
    parser.write('C');
    assert(screen.buffer[0][0].ch === 'C', 'CAN aborts incomplete CSI and C written');
});

test('Parser: oversized CSI dropped', () => {
    const { screen, parser } = makeParser();
    parser.write('A' + '\x1B[' + '1;'.repeat(70) + '31m' + 'B');
    assert(screen.buffer[0][0].ch === 'A', 'A written');
    assert(screen.buffer[0][1].ch === 'B', 'oversized CSI dropped');
});

test('Parser: mouse modes independent of encoding', () => {
    const { screen } = makeParser();
    const p2 = new Parser(screen, { onSend: () => {} });
    p2.write('\x1B[?1000h\x1B[?1006h');
    assert(screen.mouseMode === 1000, 'mouse mode set');
    assert(screen.mouseEncoding === 1006, 'mouse encoding set independently');
    p2.write('\x1B[?1002h');
    assert(screen.mouseMode === 1002, 'mouse mode can change');
    p2.write('\x1B[?1006l');
    assert(screen.mouseEncoding === 0, 'encoding cleared separately');
});

test('Screen: cursor-only movement does not dirty rows', () => {
    const { screen } = makeParser();
    screen.dirtyRows.clear();
    screen.cursorUp(1);
    screen.cursorDown(1);
    screen.cursorForward(1);
    screen.cursorBack(1);
    assert(screen.dirtyRows.size === 0, 'cursor movement marks no dirty rows');
});

test('VirtualBuffer: blit and child slots', () => {
    const root = new VirtualBuffer(10, 5);
    const child = new VirtualBuffer(3, 2);
    child.writeStr(0, 0, 'AB');
    child.writeStr(1, 0, 'CD');
    const slot = root.addChildSlot();
    slot.vb = child; slot.x = 2; slot.y = 1; slot.active = true;
    const dest = Array.from({length: 5}, ()=>Array(10).fill(null));
    root.blit(dest, 0, 0);
    assert(dest[1][2].ch === 'A', 'child blitted at offset');
    assert(dest[2][3].ch === 'D', 'child blitted correctly');
    slot.active = false;
    const dest2 = Array.from({length: 5}, ()=>Array(10).fill(null));
    root.blit(dest2, 0, 0);
    assert(dest2[1][2] === null, 'inactive slot not blitted');
});

test('VirtualBuffer: render with children', () => {
    const root = new VirtualBuffer(5, 3);
    const child = new VirtualBuffer(2, 1);
    child.writeStr(0, 0, 'XY');
    root.embed(child, 1, 1);
    const res = root.render();
    assert(res[1][1].ch === 'X', 'child rendered via embed');
    assert(res[1][2].ch === 'Y', 'child rendered correctly');
});

test('VirtualBuffer: clearCells preserves slots, clear removes them', () => {
    const vb = new VirtualBuffer(4, 2);
    const slot = vb.addChildSlot();
    slot.vb = new VirtualBuffer(1,1); slot.active = true;
    vb.clearCells();
    assert(vb._children.length === 1, 'clearCells keeps children');
    vb.clear();
    assert(vb._children.length === 0, 'clear removes children');
});

    await Promise.all(queue);

    console.log(`\n================================`);
    console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

run();
