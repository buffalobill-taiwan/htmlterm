import { system, term } from '../system/sys.js';
import { red, bold, yellow, CURSOR_SHOW, CURSOR_HIDE } from '../util/sgr.js';
import { ShowDialog } from '../dialog/ShowDialog.js';
import { InputDialog } from '../dialog/InputDialog.js';
import { defaultGridMove, defaultGridRender } from '../util/select-grid.js';

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

    // Override _onKey(data) for interactive key handling inside select()/prompt() flows.
    // Only override handleKey() directly if you must bypass all infrastructure
    // (Ctrl+C, typewriter guard, select intercept) — ShellCmd is the sole example.
    // Most interactive cmds should use select()/readLine()/prompt() instead.
    // Private implementation — use printThen() for interactive flows (select/prompt).
    // Use _afterDrain() directly only when cmd.closed stays true (e.g. pure-output async cmds
    // like anime that hold busy and don't open interactive mode).
    _afterDrain(callback) {
        const cb = () => { system.typewriter.removeOnDrain(cb); callback(); };
        system.typewriter.onDrain(cb);
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

    parseArgs(args) {
        const result = { hasHelp: false, rest: [] };
        const flags = {};
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
                    flags[a.substring(0, eqIdx)] = a.substring(eqIdx + 1);
                } else {
                    flags[a] = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[++i] : true;
                }
            } else if (a.startsWith('-') && a.length === 2) {
                flags[a] = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[++i] : true;
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
        term.write(CURSOR_SHOW);
        system.tick();
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
        const cb = () => {
            system.typewriter.removeOnDrain(cb);
            if (this.closed || epoch !== this._printCallbackEpoch) return;
            callback();
        };
        system.typewriter.onDrain(cb);
    }

    handleKey(data) {
        if (this.closed) return;
        this._handleKey(data);
    }

    _handleKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        if (code === 0x03) {
            this._selectState = null;
            if (system.typewriter.isActive()) {
                system.typewriter.dispose();
            }
            this.onCancel();
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
        return new Promise(resolve => this.readLine(resolve));
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
        return new Promise(resolve => this._afterDrain(resolve));
    }

    // === Quick dialog helpers ===

    showMessage(msg) {
        return new Promise(resolve => {
            const dlg = new ShowDialog(term, {
                message: msg,
                onExit: resolve,
            });
            system.pushDialogFrame(dlg);
        });
    }

    ask(question) {
        return new Promise(resolve => {
            const dlg = new InputDialog(term, {
                title: 'Input',
                prompt: question,
                onConfirm: val => resolve(val),
                onCancel: () => resolve(null),
            });
            system.pushDialogFrame(dlg);
        });
    }

    async confirm(question) {
        this.open();
        try {
            const result = await this.selectAsync({
                text: question + '\n',
                options: [['Yes', 'No']],
            });
            return result ? result.col === 0 : false;
        } finally {
            this.close();
        }
    }

    // === Additional dialog helpers ===

    /**
     * Menu selection helper: show items and return selected value.
     * @param {string} prompt - Prompt text
     * @param {Array<string>} items - Menu items
     * @returns {Promise<string|null>} Selected item or null if cancelled
     */
    async choose(prompt, items) {
        this.open();
        try {
            const result = await this.selectAsync({
                text: prompt + '\n',
                options: [items],
            });
            return result ? items[result.col] : null;
        } finally {
            this.close();
        }
    }

    /**
     * Multi-select helper: show checkboxes and return selected indices.
     * @param {string} prompt - Prompt text
     * @param {Array<string>} items - Items to select from
     * @returns {Promise<Array<number>>} Array of selected indices
     */
    async multiSelect(prompt, items) {
        this.open();
        try {
            const selected = [];
            const marked = items.map(() => false);

            while (true) {
                const result = await this.selectAsync({
                    text: prompt + '\n' + items.map((item, i) =>
                        (marked[i] ? '[✓] ' : '[ ] ') + item
                    ).join('\n') + '\n\nEnter to confirm, Esc to cancel\n',
                    options: [items],
                });

                if (!result) break;
                marked[result.col] = !marked[result.col];
            }

            return marked
                .map((mark, i) => mark ? i : null)
                .filter(i => i !== null);
        } finally {
            this.close();
        }
    }

    /**
     * Progress bar display helper.
     * @param {number} current - Current progress
     * @param {number} max - Maximum progress
     * @param {string} label - Optional label
     * @returns {string} Formatted progress bar
     */
    formatProgressBar(current, max, label = '') {
        const width = 30;
        const filled = Math.round((current / max) * width);
        const empty = width - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        const pct = Math.round((current / max) * 100);
        return `${label} [${bar}] ${pct}%`;
    }
}
