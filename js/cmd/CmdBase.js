import { system, term } from '../system/sys.js';
import { red, bold, yellow, CURSOR_SHOW, CURSOR_HIDE } from '../util/sgr.js';
import { ShowDialog } from '../dialog/ShowDialog.js';
import { InputDialog } from '../dialog/InputDialog.js';
import { defaultGridMove, defaultGridRender } from '../util/select-grid.js';

function isDigit(ch) { return ch >= '0' && ch <= '9'; }

export class CmdBase {
    constructor() {
        this.closed = true;
        this._awaitingTypewriterDrain = false;
        // Monotonically-increasing version number used by printThen() to detect stale
        // callbacks: a later printThen() bump silently cancels any callback from an
        // earlier call that hasn't fired yet.
        this._printCallbackEpoch = 0;
        this._selectResolve = null;
    }

    static get commandName() { return ''; }
    static get help() { return ''; }
    static get menu() { return null; }
    static get usage() { return null; }
    static get persistent() { return false; }

    execute(args) {}
    print(text) { system.print(text); }
    readLine(callback) { system.readLine(callback); }
    addCleanup(fn) { return system.addCommandCleanup(this, fn); }

    // Capture the owning frame, not the reusable command or the live system proxy.
    executionGuard() {
        const frame = system.getCommandFrame(this);
        return () => !!frame && !frame.done;
    }

    // Override _onKey(data) for interactive key handling inside select()/prompt() flows.
    // Only override handleKey() directly if you must bypass all infrastructure
    // (Ctrl+C, typewriter guard, select intercept) — ShellCmd is the sole example.
    // Most interactive cmds should use select()/readLine()/prompt() instead.
    // Private implementation — use printThen() for interactive flows (select/prompt).
    // Use _afterDrain() directly only when cmd.closed stays true (e.g. pure-output async cmds
    // like anime that hold busy and don't open interactive mode).
    _afterDrain(callback) {
        const writer = system.typewriter;
        if (!writer.isActive()) {
            callback();
            return;
        }
        let remove = () => {};
        const cb = () => { writer.removeOnDrain(cb); remove(); callback(); };
        remove = this.addCleanup(() => writer.removeOnDrain(cb));
        writer.onDrain(cb);
    }
    holdBusy() { system.holdBusy(); }
    releaseBusy() { system.releaseBusy(); }
    get abortEpoch() { return system.abortEpoch; }
    get cmdList() { return system.cmdList; }

    toggleWidget(key, WidgetClass) {
        const wm = system.widgetManager;
        const existing = wm._widgets.find(w => w.constructor === WidgetClass);
        if (existing) { wm.remove(existing); return false; }
        wm.add(new WidgetClass());
        return true;
    }

    error(text) {
        this.print(red('Error: ' + text) + '\n');
    }

    parseArgs(args, opts = {}) {
        const result = { hasHelp: false, rest: [] };
        const flags = {};
        const flagTypes = opts.flags || {};
        result.flag = (long, short) =>
            flags[long] !== undefined ? flags[long] :
            (flags[short] !== undefined ? flags[short] : null);

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '--help' || a === '-h') {
                result.hasHelp = true;
            } else if (a.startsWith('--')) {
                const eqIdx = a.indexOf('=');
                if (eqIdx > 0) {
                    const name = a.substring(0, eqIdx);
                    const val = a.substring(eqIdx + 1);
                    if (flagTypes[name] === Boolean) {
                        flags[name] = val !== 'false' && val !== '0';
                    } else {
                        flags[name] = flagTypes[name] === Number ? Number(val) : val;
                    }
                } else if (flagTypes[a] === Boolean) {
                    flags[a] = true;
                } else {
                    flags[a] = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[++i] : true;
                }
            } else if (a.startsWith('-') && a.length === 2 && !isDigit(a[1])) {
                if (flagTypes[a] === Boolean) {
                    flags[a] = true;
                } else {
                    flags[a] = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[++i] : true;
                }
            } else {
                result.rest.push(a);
            }
        }
        return result;
    }

    showHelp() {
        const name = this.constructor.commandName;
        const help = this.constructor.help;
        const usage = this.constructor.usage;
        if (name) this.print(bold(yellow(name)) + '\n');
        if (help) this.print('  ' + help + '\n');
        if (usage) this.print('  Usage: ' + usage + '\n');
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this._awaitingTypewriterDrain = false;
        this._printCallbackEpoch++;
        term.write(CURSOR_SHOW);
        system.tick();
    }

    /**
     * Position the cursor where ShellFrame should write the next prompt.
     * Command layout coordinates are zero-based; the parser receives ANSI
     * one-based cursor coordinates.
     */
    placeShellCursor(row, col = 0) {
        const y = Math.max(0, Math.min(term.rows - 1, row));
        const x = Math.max(0, Math.min(term.cols - 1, col));
        term.write(`\x1B[${y + 1};${x + 1}H`);
    }

    // Opens the command for interactive input (paired with close()).
    // Sets cmd.closed=false so SyncCmdFrame routes key events to handleKey().
    open() {
        this.closed = false;
    }

    onCancel() {
        if (this._selectResolve) {
            this._selectResolve(null);
            this._selectResolve = null;
        }
        this.close();
    }

    printThen(text, callback) {
        this._printCallbackEpoch++;
        const epoch = this._printCallbackEpoch;
        this.print(text);
        const writer = system.typewriter;
        if (!writer.isActive()) {
            // Empty text never activates the typewriter, so an onDrain callback
            // would be registered for an event that can never arrive.
            if (!this.closed && epoch === this._printCallbackEpoch) callback();
            return;
        }
        let remove = () => {};
        const cb = () => {
            writer.removeOnDrain(cb);
            remove();
            if (this.closed || epoch !== this._printCallbackEpoch) return;
            callback();
        };
        remove = this.addCleanup(() => writer.removeOnDrain(cb));
        writer.onDrain(cb);
    }

    handleKey(data) {
        if (this.closed) return;
        this._handleKey(data);
    }

    _handleKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        if (code === 0x03) {
            system._abortAll();
            return;
        }
        if (this._awaitingTypewriterDrain) {
            if (system.typewriter.isActive()) {
                system.typewriter.abort();
            }
            return;
        }
        if (this._selectState) {
            this._handleSelectKey(data);
            return;
        }
        this._onKey(data);
    }

    _onKey(data) {}

    handleKeyUp(key) {}

    select(opts) {
        const renderedRef = { value: false };
        const render = opts.render || defaultGridRender(renderedRef);

        this.open();
        this._selectState = {
            options: opts.options,
            move: opts.move || defaultGridMove,
            render,
            onPick: opts.onPick,
            onCancel: opts.onCancel || null,
            term: term,
            selRow: 0,
            selCol: 0,
        };

        this._awaitingTypewriterDrain = true;
        this.printThen(opts.text || '', () => {
            this._awaitingTypewriterDrain = false;
            term.write(CURSOR_HIDE);
            const ss = this._selectState;
            ss.render(ss.selRow, ss.selCol, ss.options, ss.term);
            renderedRef.value = true;
        });
    }

    _handleSelectKey(data) {
        const ss = this._selectState;
        const isStr = typeof data === 'string';
        const code = isStr ? data.charCodeAt(0) : data;
        if (isStr && data.length === 1 && code === 0x1B) {
            this._selectState = null;
            (ss.onCancel || this.onCancel).call(this);
            return;
        }
        if (code === 0x0D || code === 0x0A) {
            this._selectState = null;
            const value = ss.options[ss.selRow][ss.selCol];
            ss.onPick(ss.selRow, ss.selCol, value);
            return;
        }
        const result = ss.move(data, ss.selRow, ss.selCol, ss.options);
        if (result.row !== ss.selRow || result.col !== ss.selCol) {
            ss.selRow = result.row;
            ss.selCol = result.col;
            ss.render(ss.selRow, ss.selCol, ss.options, ss.term);
        }
    }

    prompt(text, onInput) {
        this._awaitingTypewriterDrain = true;
        this.printThen(text, () => {
            this._awaitingTypewriterDrain = false;
            system.readLine(onInput);
        });
    }

    // === Promise-based APIs ===

    readLineAsync() {
        return new Promise(resolve => {
            const remove = this.addCleanup(() => resolve(null));
            this.readLine(value => { remove(); resolve(value); });
        });
    }

    selectAsync(opts) {
        return new Promise(resolve => {
            this._selectResolve = resolve;
            this.select({
                ...opts,
                onPick: (row, col, value) => {
                    this._selectResolve = null;
                    resolve({ row, col, value });
                },
                onCancel: () => {
                    this._selectResolve = null;
                    resolve(null);
                },
            });
        });
    }

    waitForPrint() {
        if (!system.typewriter.isActive()) return Promise.resolve(true);
        return new Promise(resolve => {
            const remove = this.addCleanup(() => resolve(false));
            this._afterDrain(() => { remove(); resolve(true); });
        });
    }

    /**
     * Open a dialog via DialogFrame. Do not call dialog.open() yourself.
     * @param {Function} DialogClass
     * @param {string|null} key - Position-persistence key, or null to skip
     * @param {object} opts
     * @param {...any} ctorArgs - Extra constructor args before opts
     * @returns {object|null} Dialog instance
     */
    openDialog(DialogClass, key, opts, ...ctorArgs) {
        return system.createDialog(DialogClass, key, opts, ...ctorArgs);
    }
}
