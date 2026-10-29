#!/usr/bin/env node
/**
 * test-system.mjs — Headless SystemManager / frame-stack tests.
 *
 * Drives the real SystemManager with a DOM-free fake term that mirrors
 * Terminal's delegation surface (Screen + Parser underneath, like Terminal).
 * Covers frame-stack behavior that development.md otherwise validates only
 * by hand: typed-ahead input replay, busy-depth blocking, Ctrl+C
 * cancellation, dialog result delivery, drag rerouting, overlay hit
 * testing, prompt gating after output, lazy command resolution without
 * registry mutation, unknown-command reporting, the shared difficulty
 * picker helper, the unified failFrame error format, and disposal.
 *
 * Each behavioral test runs on its own harness so one test's leftover
 * command state cannot leak into the next.
 *
 * Usage:
 *   node tools/test-system.mjs
 */

import { Screen } from '../js/terminal/Screen.js';
import { Parser } from '../js/terminal/Parser.js';
import { SystemManager } from '../js/system/system.js';
import { CmdBase } from '../js/cmd/CmdBase.js';
import { FiveWillow } from '../js/cmd/5willow.js';
import { Echo } from '../js/cmd/echo.js';
import { defineLazy } from '../js/cmd/lazy.js';
import { wrapInteractiveFlow } from '../js/system/InteractiveCommandHelper.js';
import { ConfirmDialog } from '../js/dialog/ConfirmDialog.js';
import { SudokuCmd } from '../js/cmd/sudoku/SudokuCmd.js';

import { InfoDialog } from '../js/dialog/InfoDialog.js';
import { SelectDialog } from '../js/dialog/SelectDialog.js';
import { ShowDialog } from '../js/dialog/ShowDialog.js';
import { SettingsDialog } from '../js/dialog/SettingsDialog.js';
import { VirtualBuffer } from '../js/util/VirtualBuffer.js';
import { TimeCmd } from '../js/cmd/time.js';

// Command output flows through the Typewriter, which schedules
// requestAnimationFrame. Headless Node cannot pump frames on its own, so
// the callbacks are captured and advanced manually — tests stay
// deterministic with sleep-like credits consumed 16ms per pumped frame.
const rafCallbacks = [];
let rafTime = 0;
globalThis.requestAnimationFrame = (cb) => {
    const handle = { cb, cancelled: false };
    rafCallbacks.push(handle);
    return handle;
};
globalThis.cancelAnimationFrame = (handle) => {
    if (handle) handle.dead = true;
};

function pumpRAF() {
    rafTime += 16;
    const batch = rafCallbacks.splice(0);
    for (const handle of batch) if (!handle.dead) handle.cb(rafTime);
}

// Polling helpers sleep 2ms per pass instead of spinning setImmediate: real
// timers inside commands (sleep-style holds) must get event-loop time.
async function settle() {
    for (let i = 0; i < 300; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (!rafCallbacks.length) break;
        pumpRAF();
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
}

async function waitText(screen, needle) {
    for (let i = 0; i < 400; i++) {
        if (screenText(screen).includes(needle)) return true;
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (rafCallbacks.length) pumpRAF();
    }
    return false;
}

async function waitFor(predicate) {
    for (let i = 0; i < 400; i++) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (rafCallbacks.length) pumpRAF();
    }
    return false;
}

function screenText(screen) {
    const lines = [];
    for (let r = 0; r < screen.rows; r++) {
        const row = screen.getRowAt(r);
        let s = '';
        if (row) for (const cell of row) if (cell && cell.ch) s += cell.ch;
        lines.push(s.replace(/\s+$/, ''));
    }
    return lines.join('\n');
}

function countPrompts(text) {
    return text.split('\n').filter((line) => line.trim() === '$').length;
}

// A DOM-free Terminal stand-in mirroring the real Terminal's delegation
// surface (see js/terminal/terminal.js). Callers use term.xxx exactly as a
// browser session would; a stub prints the same cells a screen would show.
class FakeTerm {
    constructor(cols = 80, rows = 25) {
        this.screen = new Screen(cols, rows);
        this.parser = new Parser(this.screen, { onSend: () => {} });
    }

    get cols() { return this.screen.cols; }
    get rows() { return this.screen.rows; }
    get curX() { return this.screen.curX; }
    set curX(v) { this.screen.curX = v; }
    get curY() { return this.screen.curY; }
    set curY(v) { this.screen.curY = v; }
    get cursorHidden() { return this.screen.cursorHidden; }
    set cursorHidden(v) { this.screen.cursorHidden = v; }
    get overlays() { return this.screen.overlays; }
    addOverlay(ov, group) { this.screen.addOverlay(ov, group); }
    removeOverlay(ov) { this.screen.removeOverlay(ov); }
    topOverlayAt(col, row, skipFn) { return this.screen.topOverlayAt(col, row, skipFn); }
    markRowDirty(r) { this.screen.markRowDirty(r); }
    markAllDirty() { this.screen.markAllDirty(); }
    isWide(ch) { return this.screen.isWide(ch); }
    write(data) { this.parser.write(data); }
    beginTypewriterLineFeed() { return this.parser.beginTypewriterLineFeed(); }
    advanceScroll(operation, rows) { this.screen.advanceScroll(operation, rows); }
    beginScaledChar(ch) { return this.parser.beginScaledChar(ch); }
    revealScaledChar(glyph, columns) { this.screen.revealScaledChar(glyph, columns); }

    writeVB(vb, x = 0, y = 0) {
        vb.blit(this.screen.buffer, x, y);
        for (let r = y; r < Math.min(y + vb.height, this.rows); r++)
            this.screen.markRowDirty(r);
    }

    scrollbackUp(n) { this.screen.scrollbackUp(n); }
    scrollbackDown(n) { this.screen.scrollbackDown(n); }
}

// Commands used by the harness. Registering a private module keeps the
// frame stack independent of eager demo commands.
class ProbeCmd extends CmdBase {
    static get commandName() { return 'probe'; }
    static get help() { return 'Print, then read two lines'; }
    static get usage() { return 'probe'; }
    static get menu() { return null; }

    execute() {
        return wrapInteractiveFlow(this, async () => {
            this.print('ProbeInput\n');
            if (!await this.waitForPrint()) return;
            const first = await this.readLineAsync();
            if (first === null) return;
            this.print('Got:' + first + '\n');
            if (!await this.waitForPrint()) return;
            const second = await this.readLineAsync();
            if (second === null) return;
            this.print('Got:' + second + '\n');
        });
    }
}

class BusyProbeCmd extends CmdBase {
    static get commandName() { return 'busyp'; }
    static get help() { return 'Hold busy through two nested holds'; }
    static get usage() { return 'busyp'; }
    static get menu() { return null; }

    execute() {
        this.holdBusy();
        this.holdBusy();
        const first = setTimeout(() => this.releaseBusy(), 40);
        const second = setTimeout(() => this.releaseBusy(), 80);
        this.addCleanup(() => { clearTimeout(first); clearTimeout(second); });
    }
}

class AbortProbeCmd extends CmdBase {
    static get commandName() { return 'abortp'; }
    static get help() { return 'Prints "late" unless cancelled'; }
    static get usage() { return 'abortp'; }
    static get menu() { return null; }

    execute() {
        this.holdBusy();
        const timer = setTimeout(() => {
            this.releaseBusy();
            this.print('late\n');
        }, 150);
        this.addCleanup(() => clearTimeout(timer));
    }
}

const testCmdModule = { ProbeCmd, BusyProbeCmd, AbortProbeCmd, Echo, FiveWillow };

// Throwing probe: documents failFrame semantics — the user sees the shared
// red 'Error: …' line, the full exception lands on the console.
class ThrowProbeCmd extends CmdBase {
    static get commandName() { return 'throwp'; }
    static get help() { return 'Throws a RangeError'; }
    static get usage() { return 'throwp'; }
    static get menu() { return null; }

    execute() {
        throw new RangeError('boom');
    }
}

const throwCmdModule = { Echo, ThrowProbeCmd };

// Lazy descriptor module: first execution must load the class without
// rewriting the system's command map.
class LazyProbeCmd extends CmdBase {
    static get commandName() { return 'lazyp'; }
    static get help() { return 'Lazy probe'; }
    static get usage() { return 'lazyp'; }
    static get menu() { return null; }

    execute() {
        this.print('lazy-ok\n');
    }
}

const lazyCmdModule = {
    Echo,
    LazyProbe: defineLazy({
        commandName: 'lazyp',
        help: 'Lazy probe',
        usage: 'lazyp',
        menu: null,
    }, () => Promise.resolve(LazyProbeCmd)),
};

// Difficulty-picker probe: exercises CmdBase.openDifficultyDialog() wiring
// without any board rendering. The picker closes with Enter (confirm, via
// default Easy/Medium/Hard labels) or a lone Escape (cancel → _quit).
class DiffProbeCmd extends CmdBase {
    static get commandName() { return 'diffp'; }
    static get help() { return 'Difficulty picker probe'; }
    static get usage() { return 'diffp'; }
    static get menu() { return null; }

    constructor() {
        super();
        this.picked = null;
        this.quit = false;
    }

    execute() {
        this.openDifficultyDialog({
            key: 'diffp-diff',
            title: 'DiffProbe',
            extraFields: [{
                key: 'human', label: '先後手',
                options: [['先手', 'black'], ['後手', 'white']],
            }],
            onConfirm: ({ difficulty, human }) => {
                this.picked = [difficulty, human];
            },
        });
    }

    _quit() { this.quit = true; }
}

const diffCmdModule = { Echo, DiffProbeCmd };

function makeHarness(cmdModule = testCmdModule) {
    const term = new FakeTerm();
    const system = new SystemManager(term, cmdModule);
    return { term, system, screen: term.screen };
}

let passed = 0;
let failed = 0;
function record(name, fn) {
    return Promise.resolve()
        .then(() => fn())
        .then(() => {
            console.log(`✓ ${name}`);
            passed++;
        }, (err) => {
            console.error(`✗ ${name}:`, err.message);
            failed++;
        });
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function run() {
    await record('Dialogs: list wrap, paging, initial reveal and index/item results', async () => {
        const H = makeHarness();
        await settle();
        const options = Array.from({ length: 23 }, (_, i) => ({ label: `題目${i}`, trailing: `${i}步` }));
        let result;
        const d = H.system.createDialog(SelectDialog, null, {
            layout: 'list', width: 32, visibleCount: 4, scrollbar: true, numbered: true,
            options, selectedIndex: 22, onSelect: (index, item) => { result = { index, item }; },
        });
        const view = () => Array.from({ length: d.h }, (_, r) => Array.from({ length: d.width }, (_, c) => d._overlay.getCell(r, c)?.ch || '').join('')).join('\n');
        assert(view().includes('題目22'), 'initial last selection is visible');
        H.system.handleInput('\x1B[B');
        assert(d._selected === 0 && view().includes('題目0'), 'down wraps and reveals first');
        H.system.handleInput('\x1B[A');
        assert(d._selected === 22 && view().includes('題目22'), 'up wraps and reveals last');
        H.system.handleInput('\x1B[H');
        H.system.handleInput('\x1B[6~');
        assert(d._selected === 4 && view().includes('題目4'), 'page moves selected item, not only viewport');
        H.system.handleInput('\x1B[5~');
        assert(d._selected === 0, 'page up clamps at first');
        H.system.handleInput('\x1B[8~');
        H.system.handleInput('\r'); await settle();
        assert(result.index === 22 && result.item === options[22], 'result contains index and original item');
        assert(d.closed && H.screen.overlays.length === 0, 'selection removes overlay');
        H.system.dispose();
    });

    await record('Dialogs: empty, single, bounded and incomplete-grid navigation', async () => {
        const H = makeHarness();
        await settle();
        let confirmed = 0;
        let d = H.system.createDialog(SelectDialog, null, { layout: 'list', options: [], onSelect: () => confirmed++ });
        for (const key of ['\x1B[A', '\x1B[B', '\x1B[F', '\x1B[6~', '\r']) H.system.handleInput(key);
        assert(!d.closed && confirmed === 0, 'empty list ignores navigation and confirmation');
        H.system.handleInput('\x1B'); await settle();
        d = H.system.createDialog(SelectDialog, null, { layout: 'list', options: ['one'], onSelect: () => confirmed++ });
        H.system.handleInput('\x1B[A'); H.system.handleInput('\x1B[B'); H.system.handleInput('\r'); await settle();
        assert(confirmed === 1, 'single item stays selectable');
        d = H.system.createDialog(SelectDialog, null, { layout: 'list', options: ['a', 'b'], wrap: false });
        H.system.handleInput('\x1B[A'); assert(d._selected === 0, 'wrap false clamps first');
        H.system.handleInput('\x1B[F'); H.system.handleInput('\x1B[B');
        assert(d._selected === 1, 'wrap false clamps last'); H.system.handleInput('\x1B'); await settle();
        d = H.system.createDialog(SelectDialog, null, { layout: 'grid', cols: 3, options: ['a', 'b', 'c', 'd', 'e'], selectedIndex: 2 });
        H.system.handleInput('\x1B[B'); assert(d._selected === 4, 'down into incomplete row selects valid last column');
        H.system.handleInput('\x1B[C'); assert(d._selected === 3, 'right wraps within short row');
        H.system.handleInput('\x1B[D'); assert(d._selected === 4, 'left wraps within short row');
        H.system.handleInput('\x1B[B'); assert(d._selected === 1, 'down wraps to first row in same column');
        for (const key of ['\x1B[2~', '\x1B[3~', '\x1BOZ']) H.system.handleInput(key);
        assert(!d.closed && d._selected === 1, 'unrecognized sequences do not cancel');
        H.system.dispose();
    });

    await record('Dialogs: shared row layout preserves borders, trailing text and dirty rows', async () => {
        const H = makeHarness(); await settle();
        const d = H.system.createDialog(SelectDialog, null, {
            layout: 'list', width: 24, footer: false, visibleCount: 2, numbered: true,
            options: [{ label: '很長很長的中文關卡名稱', trailing: '99步' }, { label: '短', trailing: '1步' }, { label: '末', trailing: '2步' }],
        });
        assert(d.h === 6, 'footer false removes two rows');
        const rowText = r => d._buffer[r].map(c => c?.ch || '').join('');
        assert(rowText(3).includes('99步'), 'long label leaves room for trailing column');
        for (let r = 1; r < d.h - 1; r++) {
            assert(d._buffer[r][0].ch === '│' && d._buffer[r][d.width - 1].ch === '│', 'wide text preserves both borders');
        }
        const dirty = new Set(); const mark = H.term.markRowDirty.bind(H.term);
        H.term.markRowDirty = r => { dirty.add(r); mark(r); };
        H.system.handleInput('\x1B[B');
        assert(dirty.size <= 2, 'in-page movement dirties only affected rows');
        H.system.handleInput('\x1B[B');
        assert(!rowText(3).includes('很長') && rowText(3).includes('短'), 'scroll clears shorter replacement rows');
        H.system.dispose();
    });

    await record('Dialogs: horizontal flow and multi-line text remain selectable', async () => {
        const H = makeHarness(); await settle();
        let chosen;
        const d = H.system.createDialog(SelectDialog, null, {
            width: 16, options: ['第一個選項', '第二個選項', '非常非常非常長的第三個選項'],
            selectedIndex: 2, onSelect: i => { chosen = i; },
        });
        assert(d._rows > 1, 'horizontal labels flow across rows');
        H.system.handleInput('\x1B[C'); assert(d._selected === 0, 'right wraps');
        H.system.handleInput('\x1B[D'); H.system.handleInput('\r'); await settle();
        assert(chosen === 2, 'wrapped label retains original result index');
        H.system.dispose();
    });

    await record('Dialogs: custom tile buffers and slots are reused; peek suppresses actions', async () => {
        const H = makeHarness(); await settle();
        const oldWindow = globalThis.window;
        globalThis.window = new EventTarget();
        try {
            let renders = 0, selected = 0, aborted = 0;
            const peek = [];
            const d = H.system.createDialog(SelectDialog, null, {
                layout: 'list', width: 20, cellHeight: 2, visibleCount: 2, options: ['牌一', '牌二', '牌三'],
                peekOnTab: true, onPeekChange: held => peek.push(held), onAbort: () => aborted++,
                renderOption: (index, option, active) => {
                    renders++;
                    const vb = new VirtualBuffer(6, 2);
                    vb.writeStr(0, 0, (active ? '\x1B[7m' : '') + option);
                    vb.writeStr(1, 0, `第${index}張`);
                    return vb;
                }, onSelect: () => selected++,
            });
            const buffers = d._optionBuffers, slots = [...d._slots];
            H.system.handleInput('\x1B[B'); H.system.handleInput('\x1B[B');
            assert(renders === 6 && buffers === d._optionBuffers && slots.every((s, i) => s === d._slots[i]), 'navigation reuses both appearances and slots');
            H.system.handleInput('\t');
            assert(d._overlay.getCell(0, 0) === null, 'peek makes overlay transparent');
            for (const key of ['\r', '\x03', '\x1B[A']) H.system.handleInput(key);
            assert(!d.closed && d._selected === 2 && selected === 0 && aborted === 0, 'peek suppresses confirmation, abort and navigation');
            window.dispatchEvent(new Event('blur'));
            assert(d._overlay.getCell(0, 0) !== null, 'blur restores overlay');
            H.system.handleInput('\t'); d.handleKeyUp('Tab');
            assert(JSON.stringify(peek) === '[true,false,true,false]', 'release also restores peek');
            H.system.handleInput('\x03'); await settle();
            assert(aborted === 1 && d.closed, 'abort runs after peek ends');
        } finally { H.system.dispose(); globalThis.window = oldWindow; }
    });

    await record('Dialogs: shortcuts close before callbacks and preserve parent cursor', async () => {
        const H = makeHarness(); await settle();
        H.term.curX = 7; H.term.curY = 9;
        let calls = 0;
        const d = H.system.createDialog(ShowDialog, null, {
            message: 'rules', keyActions: { h: { onAction: key => {
                assert(key === 'h' && d.closed && !H.screen.overlays.length, 'shortcut receives key after overlay removal');
                assert(H.term.curX === 7 && H.term.curY === 9, 'cursor restored before callback');
                calls++;
            } } },
        });
        H.system.handleInput('h'); await settle();
        d.handleKey('h');
        assert(calls === 1, 'closed dialog cannot repeat callback');
        let aborted = 0, exited = 0;
        H.system.createDialog(ShowDialog, null, { message: 'rules', onExit: () => exited++, onAbort: () => aborted++ });
        H.system.handleInput('\x03'); await settle();
        assert(aborted === 1 && exited === 0, 'onAbort distinguishes Ctrl+C from exit');
        H.system.createDialog(ShowDialog, null, { message: 'rules', onExit: () => exited++ });
        H.system.handleInput('\x03'); await settle(); assert(exited === 1, 'without onAbort original exit behavior remains');
        H.system.dispose();
    });

    await record('Dialogs: explicit settings picker retains parent and updates value', async () => {
        const H = makeHarness(); await settle();
        const settings = [{ key: 'value', label: '選擇', value: 'b', options: ['a', 'b', 'c'], picker: { layout: 'grid', cols: 2 } }];
        const parent = H.system.createDialog(SettingsDialog, null, { settings });
        H.system.handleInput('\r'); await settle();
        const child = H.system.cmdStack.at(-1).dialog;
        assert(child instanceof SelectDialog && child._layout === 'grid' && child._selected === 1, 'explicit layout and initial value applied');
        H.system.handleInput('\x1B[C'); H.system.handleInput('\r'); await settle();
        assert(settings[0].value === 'a' && !parent.closed && H.screen.overlays.length === 1, 'child updates value and restores parent');
        H.system.handleInput('\r'); await settle(); H.system.handleInput('\x1B'); await settle();
        assert(!parent.closed && settings[0].value === 'a', 'child cancellation preserves parent state');
        H.system.dispose();
    });

    await record('Dialogs: menu time cancel returns to menu; confirm closes parent before execution', async () => {
        const H = makeHarness({ Echo, TimeCmd }); await settle();
        H.system.menuCmd();
        const menu = H.system.menuDialog;
        const idx = menu._options.findIndex(o => o.name === 'time');
        assert(idx >= 0, 'time menu option exists');
        for (let i = 0; i < idx; i++) H.system.handleInput('\x1B[B');
        H.system.handleInput('\r'); await settle();
        assert(!menu.closed && H.screen.overlays.length === 2, 'time opens nested input without closing menu');
        H.system.handleInput('\x1B'); await settle();
        assert(!menu.closed && H.screen.overlays.length === 1, 'cancel returns to menu');
        H.system.handleInput('\r'); await settle(); H.system.handleInput('echo dialog-ok'); H.system.handleInput('\r'); await settle();
        assert(await waitText(H.screen, 'dialog-ok'), 'confirmed command executes');
        assert(menu.closed && H.system.menuDialog === null && H.screen.overlays.length === 0, 'time confirmation removes both overlays');
        await settle(); H.system.dispose();
    });



    await record('Dialogs: normal menu selection closes before command startup', async () => {
        let overlayCount, cursor;
        class MenuProbe extends CmdBase {
            static get commandName() { return 'menuprobe'; }
            static get menu() { return 'Menu probe'; }
            execute() {
                overlayCount = H.screen.overlays.length;
                cursor = [H.term.curX, H.term.curY];
            }
        }
        const H = makeHarness({ MenuProbe }); await settle();
        H.term.curX = 3; H.term.curY = 8;
        H.system.menuCmd();
        H.system.handleInput('\r'); await settle();
        assert(overlayCount === 0 && cursor[0] === 3 && cursor[1] === 8, 'menu teardown restores cursor before execute');
        assert(H.system.menuDialog === null, 'menu reference cleared');
        H.system.dispose();
    });

    await record('Dialogs: text/info scrolling and non-closing quit actions retain their contracts', async () => {
        const H = makeHarness(); await settle();
        const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
        const show = H.system.createDialog(ShowDialog, null, { title: 'Long text', message: text });
        H.system.handleInput('\x1B[6~');
        assert(show._scroll > 0 && !show.closed, 'text dialog still uses generic scrolling');
        H.system.handleInput('\x1B'); await settle();
        let quit = 0, exit = 0;
        const buffer = new VirtualBuffer(10, 30); buffer.writeStr(29, 0, 'last row');
        const info = H.system.createDialog(InfoDialog, null, { buffer, onQuit: () => quit++, onExit: () => exit++ });
        H.system.handleInput('q'); H.system.handleInput('Q');
        assert(quit === 2 && !info.closed, 'legacy q/Q actions remain non-closing');
        H.system.handleInput('\x1B[6~');
        assert(info._scroll > 0, 'buffer dialog retains scrolling');
        H.system.handleInput('\r'); await settle();
        assert(exit === 1 && info.closed, 'Enter closes buffer dialog exactly once');
        H.system.dispose();
    });

    await record('Screen.topOverlayAt: rank, bbox and skip predicate', () => {
        const H = makeHarness();
        const screen = H.screen;
        const base = { y: 5, x: 5, w: 10, h: 4, getCell: () => null };
        const top = { y: 6, x: 6, w: 4, h: 2, getCell: () => null };
        screen.addOverlay(base, 'command');
        screen.addOverlay(top, 'widget');
        assert(screen.topOverlayAt(7, 7) === top, 'higher-rank overlay wins');
        assert(screen.topOverlayAt(5, 5) === base, 'outside top bbox reaches base');
        assert(screen.topOverlayAt(4, 5) === null, 'outside both is null');
        assert(screen.topOverlayAt(7, 7, (ov) => ov === top) === base,
            'skipFn vetoes the topmost overlay');
        screen.removeOverlay(base);
        screen.removeOverlay(top);
        assert(screen.topOverlayAt(7, 7) === null, 'removed overlays are gone');
    });

    await record('System: handleMouse drag routing via shared hit test', () => {
        const H = makeHarness();
        const calls = [];
        const owner = {
            startDrag: (col, row) => calls.push(['down', col, row]),
            moveDrag: (col, row) => calls.push(['move', col, row]),
            endDrag: () => calls.push(['up', 0, 0]),
        };
        const overlay = { y: 0, x: 0, w: 80, h: 5, owner, getCell: () => null };
        H.screen.addOverlay(overlay, 'widget');
        assert(H.system.handleMouse('mousedown', { col: 10, row: 2 }) === true,
            'mousedown inside overlay starts drag');
        assert(H.system.handleMouse('mousemove', { col: 12, row: 3 }) === true,
            'mousemove keeps dragging');
        assert(H.system.handleMouse('mouseup', { col: 12, row: 3 }) === true,
            'mouseup ends drag');
        assert(H.system.handleMouse('mousedown', { col: 10, row: 10 }) === false,
            'mousedown outside overlay is not consumed');
        assert(JSON.stringify(calls) === '[["down",10,2],["move",12,3],["up",0,0]]',
            'drag lifecycle events recorded');
        H.screen.removeOverlay(overlay);
        assert(H.system._dragTarget === null, 'mouseup clears drag target');
    });

    await record('System: command mouse capture cancels at dialog, blur and frame cleanup', async () => {
        const H = makeHarness(); await settle();
        const calls = [];
        const cmd = H.system.cmdStack.at(-1).cmd;
        cmd.handleMouse = type => { calls.push(type); return true; };
        const point = { col: 4, row: 8, btn: 0 };
        H.system.handleMouse('mousedown', point);
        H.system.handleMouse('mousemove', point);
        H.system.handleMouse('mouseup', point);
        assert(calls.join(',') === 'mousedown,mousemove,mouseup', 'command captures full mouse gesture');
        H.system.handleMouse('mousedown', point);
        const dialog = H.system.createDialog(SelectDialog, null, { options: ['OK'] });
        assert(calls.at(-1) === 'cancel' && !H.system._commandMouse, 'dialog push cancels command capture');
        const n = calls.length;
        H.system.handleMouse('mousedown', { col: 0, row: 24, btn: 0 });
        assert(calls.length === n, 'dialog blocks command even outside its rectangle');
        dialog.close(); await settle();
        H.system.handleMouse('mousedown', point);
        H.system.handleMouse('cancel', null);
        assert(calls.at(-1) === 'cancel' && !H.system._commandMouse, 'blur cancels');
        H.system.handleMouse('mousedown', point);
        H.system.dispose();
        assert(calls.at(-1) === 'cancel' && !H.system._commandMouse, 'dispose cancels');
    });

    await record('System: peek-held overlay does not capture the drag', () => {
        const H = makeHarness();
        const overlay = {
            y: 0, x: 0, w: 80, h: 5, getCell: () => null,
            owner: { _peekHeld: true, startDrag: () => { throw new Error('must not drag'); } },
        };
        H.screen.addOverlay(overlay, 'dialog');
        assert(H.system.handleMouse('mousedown', { col: 4, row: 1 }) === false,
            'peek-transparent overlay lets the click through');
        H.screen.removeOverlay(overlay);
        H.system.dispose();
    });

    await record('System: input typed during command output replays, never vanishes', async () => {
        const H = makeHarness();
        H.system.execute('probe');
        await new Promise((resolve) => setTimeout(resolve, 2));
        // Typed while the frame is open and output is still flowing: the
        // command has not reached its interactive phase, so the queue owns
        // the line and replays it when readLine() opens. (This input used
        // to vanish into the open frame's no-op _onKey.)
        assert(H.system.typewriter.isActive(), 'typewriter active after execute');
        H.system.handleInput('one\r');
        assert(await waitText(H.screen, 'Got:one'), 'first line replays to readLine');
        assert(await waitFor(() => H.system.readLineState !== null),
            'second readLine becomes active');
        H.system.handleInput('two\r');
        assert(await waitText(H.screen, 'Got:two'), 'second line delivered in order');
        await settle();
        assert(H.system.readLineState === null, 'readLine retired');
        H.system.dispose();
    });

    await record('System: busy depth blocks input until every hold releases', async () => {
        const H = makeHarness();
        H.system.execute('busyp');
        assert(await waitFor(() => H.system.busy), 'busy depth becomes active');
        // Typed while the frame is blocked: the queue owns it, and the line
        // must not run until the SECOND release drains the depth to zero.
        H.system.handleInput('echo hush\r');
        assert(!screenText(H.screen).includes('hush'),
            'input typed under busy is not executed yet');
        assert(await waitFor(() => !H.system.busy), 'busy depth drains to zero');
        assert(await waitText(H.screen, 'hush'), 'queued echo replays after release');
        await settle();
        H.system.dispose();
    });

    await record('System: Ctrl+C cancels a blocked command, no late output', async () => {
        const H = makeHarness();
        H.system.execute('abortp');
        assert(await waitFor(() => H.system.busy), 'command holds busy');
        H.system.handleInput('\x03');
        assert(await waitFor(() => !H.system.busy && H.system.cmdStack.length === 1),
            'abort returns the stack to the persistent shell frame');
        assert(screenText(H.screen).includes('^C'), 'abort prints ^C');
        await new Promise((resolve) => setTimeout(resolve, 200));
        await settle();
        assert(!screenText(H.screen).includes('late'),
            'cleaned timer never prints its output');
        H.system.handleInput('echo ready\r');
        assert(await waitText(H.screen, 'ready'), 'shell still accepts commands');
        H.system.dispose();
    });

    await record('System: dialog result is delivered exactly once', async () => {
        const H = makeHarness();
        let confirmed = 0;
        let cancelled = 0;
        const dialog = H.system.createDialog(ConfirmDialog, null, {
            title: 'Confirm',
            message: 'Delete item?',
            onConfirm: () => { confirmed++; },
            onCancel: () => { cancelled++; },
        });
        await settle();
        assert(dialog && !dialog.closed, 'dialog is open');
        assert(H.screen.overlays.length === 1, 'dialog owns one overlay');
        H.system.handleInput('\r');
        assert(await waitFor(() => confirmed === 1), 'Enter confirms exactly once');
        assert(dialog.closed, 'dialog closed after confirm');
        assert(H.screen.overlays.length === 0, 'overlay removed after close');
        assert(cancelled === 0, 'cancel is not called on confirm');
        // A later Enter is plain line input, not a second dialog result.
        H.system.handleInput('\r');
        await settle();
        assert(confirmed === 1, 'result stays delivered-once');
        H.system.dispose();
    });

    await record('System: lazy command loads once without registry mutation', async () => {
        const H = makeHarness(lazyCmdModule);
        // Boot output uses the same typewriter queue; drive commands only
        // after the boot prompt has landed.
        assert(await waitFor(() => countPrompts(screenText(H.screen)) >= 1),
            'boot prompt appears');
        const mapEntryBefore = H.system.commands.lazyp;
        H.system.execute('lazyp');
        assert(await waitText(H.screen, 'lazy-ok'), 'first run loads and runs');
        await settle();
        assert(H.system._cmdInstances.lazyp instanceof LazyProbeCmd,
            'instance cached after first run');
        assert(H.system.commands.lazyp === mapEntryBefore,
            'command map entry is never rewritten');
        H.system.execute('lazyp');
        assert(await waitText(H.screen, 'lazy-ok'), 'second run reuses instance');
        await settle();
        const text = screenText(H.screen);
        let occurrences = 0;
        for (const line of text.split('\n')) if (line.includes('lazy-ok')) occurrences++;
        assert(occurrences === 2, 'exactly two lazy-ok outputs, got '
            + occurrences + '\n' + text);
        H.system.dispose();
    });

    await record('System: unknown command reports and keeps the prompt', async () => {
        const H = makeHarness();
        assert(await waitFor(() => countPrompts(screenText(H.screen)) >= 1),
            'boot prompt appears');
        H.system.execute('nosuchcmd');
        assert(await waitText(H.screen, 'Command not found'),
            'unknown command reports');
        await settle();
        const lines = screenText(H.screen).split('\n')
            .filter((line) => line.trim() !== '');
        assert(lines[lines.length - 1].trim() === '$',
            'prompt re-arms after the report, last line was: '
            + lines[lines.length - 1]);
        H.system.dispose();
    });

    await record('System: openDifficultyDialog wires confirm and cancel', async () => {
        const H = makeHarness(diffCmdModule);
        assert(await waitFor(() => countPrompts(screenText(H.screen)) >= 1),
            'boot prompt appears');
        const inst = H.system._cmdInstances.diffp;
        H.system.execute('diffp');
        await settle();
        assert(inst && inst._difficultyDialog, 'helper stores the dialog reference');
        assert(H.screen.overlays.length === 1, 'picker owns one overlay');
        H.system.handleInput('\r');
        assert(await waitFor(() => inst.picked), 'confirm delivers picker values');
        assert(inst.picked[0] === 'easy' && inst.picked[1] === 'black',
            'defaults pick first option of each field');
        assert(inst._difficultyDialog === null, 'reference nulled on confirm');
        await settle();
        assert(H.screen.overlays.length === 0, 'overlay removed after confirm');
        // Escape runs the default onCancel path: this._quit().
        H.system.execute('diffp');
        await settle();
        assert(inst._difficultyDialog, 'second picker opens');
        H.system.handleInput('\x1b');
        assert(await waitFor(() => inst.quit), 'escape reaches the default cancel');
        assert(inst._difficultyDialog === null, 'reference nulled on cancel');
        await settle();
        H.system.dispose();
    });

    await record('System: exception reports share one Error format', async () => {
        const H = makeHarness(throwCmdModule);
        assert(await waitFor(() => countPrompts(screenText(H.screen)) >= 1),
            'boot prompt appears');
        const seen = [];
        const origError = console.error;
        console.error = (err) => { seen.push(err); };  // swallow debug detail
        try {
            H.system.execute('throwp');
            // Shared format: 'Error: boom' without the RangeError type prefix.
            assert(await waitText(H.screen, 'Error: boom'),
                'failFrame prints the shared Error format');
            await settle();
        } finally {
            console.error = origError;
        }
        assert(seen.some(e => e instanceof RangeError), 'console.error gets the exception');
        assert(!screenText(H.screen).includes('RangeError'),
            'stack detail stays off the terminal');
        H.system.handleInput('echo alive\r');
        assert(await waitText(H.screen, 'alive'), 'shell still accepts commands');
        await settle();
        H.system.dispose();
    });

    await record('System: prompt counts track output exactly (boot, echo, CJK)', async () => {
        const H = makeHarness();
        const text = () => screenText(H.screen);

        assert(await waitText(H.screen, 'HTML Term'), 'banner renders');
        await settle();
        assert(countPrompts(text()) === 1, 'exactly one boot prompt');

        // Type at the prompt like a user: the editor echoes the line, the
        // Enter prints CRLF, output flows through the typewriter, then the
        // shell shows exactly one new prompt (the echoed prompt row no
        // longer counts as a bare prompt).
        H.system.handleInput('echo ready\r');
        assert(await waitText(H.screen, 'ready'), 'output appears');
        await settle();
        assert(countPrompts(text()) === 1, 'exactly one prompt after echo');

        H.system.handleInput('echo 中文\r');
        assert(await waitText(H.screen, '中文'), 'wide-glyph output appears');
        await settle();
        assert(countPrompts(text()) === 1, 'exactly one prompt after CJK echo');

        H.system.dispose();
        assert(SystemManager.instance === null, 'singleton released');
    });

    await record('System: scaled echo aliases, limits, baseline and cancellation', async () => {
        const H = makeHarness();
        await settle();
        for (const flag of ['--big', '--x2', '--x3', '--x10']) {
            H.system.handleInput(`echo ${flag} 中 tail\r`);
            await settle();
            assert(H.screen.attr.scale === 1, 'scale restored');
            assert(countPrompts(screenText(H.screen)) === 1, 'one prompt after scaled output');
            assert(screenText(H.screen).includes('tail'), 'normal suffix rendered');
        }
        H.system.handleInput('echo --x11 中\r');
        await settle();
        assert(screenText(H.screen).includes('Text scale must'), 'out of range reports error');
        H.system.handleInput('echo --x10 中中中中中中中中中中\r');
        pumpRAF();
        H.system.handleInput('\x03');
        await settle();
        assert(H.screen.attr.scale === 1, 'cancel restores normal scale');
        H.system.handleInput('echo ready\r');
        await settle();
        assert(screenText(H.screen).includes('ready'), 'shell works after cancel');
        H.system.dispose();
    });

    await record('System: scaled article scrolling and last flag wins', async () => {
        const H = makeHarness();
        await settle();
        H.system.typewriter._speed = { wide: 0, half: 0 };
        H.system.handleInput('5willow --big --x10\r');
        await settle();
        H.system.typewriter.abort();
        await settle();
        assert(H.screen.attr.scale === 1, 'article restores scale');
        assert(H.screen.buffer.some(row => row.some(c => c.clipScale === 10)), 'article uses final flag');
        assert(H.screen.scrollback.length > 0, 'long article scrolls');
        assert(countPrompts(screenText(H.screen)) === 1, 'one normal prompt after article');
        H.system.dispose();
    });

    await record('Sudoku: focus number, held Ctrl hints and physical release', async () => {
        const previousWindow = globalThis.window;
        globalThis.window = new EventTarget();
        const H = makeHarness({ SudokuCmd });
        const key = (type, props) => {
            const event = new Event(type, { cancelable: true });
            Object.assign(event, props);
            window.dispatchEvent(event);
            return event;
        };
        try {
            await settle();
            H.system.execute('sudoku 0 --easy');
            await settle();
            const cmd = H.system._cmdInstances.sudoku;
            const board = JSON.stringify(cmd._board);
            const hasHint = () => H.screen.buffer.some(row => row.some(cell => cell.bg === 238));
            assert(cmd._focusNumber === 1, 'initial focus is 1');
            key('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
            assert(hasHint(), 'Ctrl alone shows the initial focus hint');
            key('keyup', { key: 'Control', ctrlKey: false });
            for (let n = 1; n <= 9; n++) {
                const down = key('keydown', { key: String(n), code: 'Digit' + n, ctrlKey: true });
                assert(down.defaultPrevented, 'shortcut default is prevented');
                assert(cmd._focusNumber === n, 'Ctrl selects requested digit');
                assert(hasHint(), 'hint is visible');
                key('keyup', { key: String(n), ctrlKey: true });
                assert(hasHint(), 'digit release keeps hint while Ctrl is held');
                H.screen.dirtyRows.clear();
                key('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false, isComposing: true });
                assert(cmd._focusNumber === n && !cmd._hintVisible && !hasHint(), 'Ctrl release clears hint even during composition');
                assert(H.screen.dirtyRows.size > 0, 'cleared board is scheduled for repaint');
            }
            assert(JSON.stringify(cmd._board) === board, 'shortcuts do not enter digits');
            H.system.handleInput('!');
            assert(!hasHint(), 'old Shift shortcut no longer activates hints');
            key('keydown', { key: '1', ctrlKey: true });
            key('keydown', { key: '2', ctrlKey: true });
            assert(cmd._focusNumber === 2, 'holding Ctrl allows switching digits');
            const mask = Array.from(cmd._hintMask).join(',');
            for (const [sequence, row, col] of [
                ['\x1B[1;5A', 3, 4], ['\x1B[1;5D', 3, 3],
                ['\x1B[1;5B', 4, 3], ['\x1B[1;5C', 4, 4],
            ]) {
                H.system.handleInput(sequence);
                assert(cmd._cursorRow === row && cmd._cursorCol === col, 'Ctrl arrow moves cursor');
                assert(cmd._focusNumber === 2 && Array.from(cmd._hintMask).join(',') === mask,
                    'Ctrl arrow preserves exclusion hint');
            }
            for (let i = 0; i < 12; i++) H.system.handleInput('\x1B[1;5A');
            assert(cmd._cursorRow === 0, 'Ctrl arrow stops at board edge');

            window.dispatchEvent(new Event('blur'));
            assert(!hasHint(), 'blur clears hint');
            for (const given of [true, false]) {
                const r = cmd._given.findIndex(row => row.includes(given));
                const c = cmd._given[r].indexOf(given);
                cmd._cursorRow = r;
                cmd._cursorCol = c;
                const before = cmd._board[r][c];
                H.system.handleInput('7');
                assert(cmd._focusNumber === 7, 'number input updates focus on any cell');
                assert(cmd._board[r][c] === (given ? before : 7), 'only editable cells change');
                const focused = cmd._sidebarVB._buffer[13];
                assert(focused.slice(1, 6).every(cell => cell.bg === 17), 'full focus panel interior is dark blue');
                assert(focused[0].bg !== 17 && focused[6].bg !== 17, 'panel border stays unchanged');
                key('keydown', { key: 'Control', ctrlKey: true });
                assert(hasHint(), 'Ctrl alone reuses the selected focus');
                key('keyup', { key: 'Control', ctrlKey: false });
            }
            const prepareCompletion = (digit, incomplete) => {
                cmd._setHintVisible(false);
                cmd._completed = false;
                cmd._board = cmd._solution.map(row => row.map(value => incomplete.includes(value) ? 0 : value));
                cmd._given = cmd._board.map(row => row.map(() => false));
                cmd._cursorRow = 0;
                cmd._cursorCol = cmd._solution[0].indexOf(digit);
                cmd._board[0][cmd._cursorCol] = 0;
                cmd._render();
            };
            prepareCompletion(4, [7]);
            H.system.handleInput('4');
            assert(cmd._focusNumber === 7, 'completion skips already complete numbers');
            assert(cmd._sidebarVB._buffer[13].slice(1, 6).every(cell => cell.bg === 17),
                'automatic focus advances the sidebar highlight');
            H.system.handleInput('4');
            assert(cmd._focusNumber === 4, 'reentering the same digit does not advance focus');
            prepareCompletion(9, [2]);
            cmd._autoCheck = false;
            H.system.handleInput('9');
            assert(cmd._focusNumber === 2, 'completion wraps past 9 even with check disabled');
            key('keydown', { key: 'Control', ctrlKey: true });
            assert(cmd._hintVisible && !cmd._hintMask.some(Boolean),
                'hint uses the automatically selected number, absent from this fixture');
            prepareCompletion(4, [7]);
            const extraCol = cmd._solution[1].indexOf(7);
            cmd._board[1][extraCol] = 4;
            H.system.handleInput('4');
            assert(cmd._focusNumber === 4, 'conflicting digits do not count as complete');
            prepareCompletion(9, []);
            H.system.handleInput('9');
            assert(cmd._completed && cmd._focusNumber === 9,
                'final completion wins and retains focus when no unfinished number remains');
            cmd._restart();
            H.system.handleInput('r');
            assert(cmd._focusNumber === 1 && !hasHint(), 'restart resets focus and hint');
            assert(cmd._sidebarVB._buffer[13].slice(1, 6).every(cell => cell.bg !== 17),
                'previous focus background is removed');
            key('keydown', { key: 'Control', ctrlKey: true });
            H.system.handleInput('g');
            assert(!key('keydown', { key: '1', ctrlKey: true }).defaultPrevented,
                'parent does not intercept shortcuts while a dialog is open');
            H.system.handleInput('\x1B');
            await settle();
            H.system.handleInput('q');
            await settle();
            assert(!key('keydown', { key: '1', ctrlKey: true }).defaultPrevented,
                'shortcut listener is inactive after exit');
        } finally {
            H.system._cmdInstances.sudoku?.onCancel();
            H.system.dispose();
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
        }
    });

    if (failed > 0) {
        console.error(`\n================================`);
        console.error(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
        console.error(`================================\n`);
        process.exit(1);
    }
    console.log(`\n================================`);
    console.log(`Tests: ${passed} | Passed: ${passed} | Failed: 0`);
    console.log(`================================\n`);
}

run();
