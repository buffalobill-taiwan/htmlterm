import { SystemManager } from '../system.js';
import { red, bold, yellow, CURSOR_SHOW, CURSOR_HIDE } from '../sgr.js';
import { ShowDialog } from '../dialog/ShowDialog.js';
import { InputDialog } from '../dialog/InputDialog.js';
import { defaultGridMove, defaultGridRender } from '../select-grid.js';

export class CmdBase {
    constructor() {
        this.system = SystemManager.instance;
        this.term = this.system.term;
        this.closed = true;
        this.isTyping = false;
        this._cbSession = 0;
        this._selectResolve = null;
    }
    execute(args) {}
    print(text) { this.system.print(text); }
    readLine(callback) { this.system.readLine(callback); }
    _afterDrain(callback) {
        const cb = () => { this.system.typewriter.removeOnDrain(cb); callback(); };
        this.system.typewriter.onDrain(cb);
    }
    holdBusy() { this.system.holdBusy(); }
    releaseBusy() { this.system.releaseBusy(); }
    get abortGeneration() { return this.system.abortGeneration; }
    get cmdList() { return this.system.cmdList; }

    toggleWidget(key, WidgetClass) {
        const wm = this.system.widgetManager;
        const existing = wm._widgets.find(w => w.constructor === WidgetClass);
        if (existing) { wm.remove(existing); return false; }
        wm.add(new WidgetClass());
        return true;
    }

    static get commandName() { return ''; }
    static get help() { return ''; }
    static get menu() { return null; }
    static get usage() { return null; }

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
        this.term.write(CURSOR_SHOW);
        this.system._tick();
    }

    onCancel() {
        if (this._selectResolve) {
            this._selectResolve(null);
            this._selectResolve = null;
        }
        this.close();
    }

    printThen(text, callback) {
        this._cbSession++;
        const session = this._cbSession;
        this.print(text);
        const cb = () => {
            this.system.typewriter.removeOnDrain(cb);
            if (this.closed || session !== this._cbSession) return;
            callback();
        };
        this.system.typewriter.onDrain(cb);
    }

    handleKey(data) {
        if (this.closed) return;
        this._handleKey(data);
    }

    _handleKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        if (code === 0x03) {
            this._selectState = null;
            if (this.system.typewriter.isActive()) {
                this.system.typewriter.dispose();
            }
            this.onCancel();
            return;
        }
        if (this.isTyping) {
            if (this.system.typewriter.isActive()) {
                this.system.typewriter.abort();
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

        this.closed = false;
        this._selectState = {
            options: opts.options,
            move: opts.move || defaultGridMove,
            render,
            onPick: opts.onPick,
            onCancel: opts.onCancel || null,
            term: this.term,
            selRow: 0,
            selCol: 0,
        };

        this.isTyping = true;
        this.printThen(opts.text || '', () => {
            this.isTyping = false;
            this.term.write(CURSOR_HIDE);
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
        this.isTyping = true;
        this.printThen(text, () => {
            this.isTyping = false;
            this.system.readLine(onInput);
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
            const dlg = new ShowDialog(this.term, {
                message: msg,
                onExit: resolve,
            });
            this.system.pushDialogFrame(dlg);
        });
    }

    ask(question) {
        return new Promise(resolve => {
            const dlg = new InputDialog(this.term, {
                title: 'Input',
                prompt: question,
                onConfirm: val => resolve(val),
                onCancel: () => resolve(null),
            });
            this.system.pushDialogFrame(dlg);
        });
    }

    async confirm(question) {
        this.closed = false;
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
}
