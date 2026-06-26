/**
 * Abstract base for all shell commands.
 *
 * Subclasses must implement execute(args) and define static getters:
 * - commandName → registration key
 * - help → description shown in `help` output
 * - menu → menu description (or null to hide from menu)
 * - usage → "commandName [--flag VALUE]" for auto --help output
 *
 * Built-in helpers:
 *   error(text)        — print red "Error: text" + newline
 *   parseArgs(args)    — returns { hasHelp, flag(long,short), rest[] }
 *   showHelp()         — prints commandName + help + usage
 *   select(opts)       — 2D grid selection (interactive commands)
 *   prompt(text, cb)   — readLine with Typewriter gating (interactive commands)
 *
 * Promise-based APIs (use from async execute()):
 *   await readLineAsync()     — Promise<string> user input
 *   await selectAsync(opts)   — Promise<{row,col,value}|null>
 *   await waitForPrint()      — resolve when typewriter drains
 *   await showMessage(msg)    — quick ShowDialog, resolves on close
 *   await ask(question)       — quick InputDialog, Promise<string|null>
 *   await confirm(question)   — quick Y/N selection
 */

import { red, bold, yellow, green } from '../sgr.js';
import { DialogFrame } from '../CmdFrame.js';
import { ShowDialog } from '../dialog/ShowDialog.js';
import { InputDialog } from '../dialog/InputDialog.js';

export class CmdBase {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this.closed = true;
        this.isTyping = false;
        this._cbSession = 0;
        this._selectResolve = null;
    }
    execute(args) {}
    print(text) { this.shell.print(text); }
    readLine(callback) { this.shell.readLine(callback); }
    _afterDrain(callback) {
        const cb = () => { this.shell.typewriter.removeOnDrain(cb); callback(); };
        this.shell.typewriter.onDrain(cb);
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
        this.term.write('\x1B[?25h');
        this.shell._tick();
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
            this.shell.typewriter.removeOnDrain(cb);
            if (this.closed || session !== this._cbSession) return;
            callback();
        };
        this.shell.typewriter.onDrain(cb);
    }

    handleKey(data) {
        if (this.closed) return;
        this._handleKey(data);
    }

    _handleKey(data) {
        if (data.charCodeAt(0) === 0x03) {
            this._selectState = null;
            if (this.shell.typewriter.isActive()) {
                this.shell.typewriter.dispose();
            }
            this.onCancel();
            return;
        }
        if (this.isTyping) {
            if (this.shell.typewriter.isActive()) {
                this.shell.typewriter.abort();
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
        let rendered = false;
        const defaultRender = (r, c, options, term) => {
            const rows = options.length;
            let s = '';
            if (rendered && rows > 1) {
                s += '\x1B[' + (rows - 1) + 'A';
            }
            const numCols = Math.max(...options.map(row => row.length));
            const colWidths = [];
            for (let ci = 0; ci < numCols; ci++) {
                let maxW = 0;
                for (const row of options) {
                    if (ci < row.length) {
                        maxW = Math.max(maxW, _displayWidth(row[ci]));
                    }
                }
                colWidths.push(maxW);
            }
            for (let ri = 0; ri < rows; ri++) {
                if (ri > 0) s += '\r\n';
                s += '\r\x1B[K';
                for (let ci = 0; ci < options[ri].length; ci++) {
                    const name = options[ri][ci];
                    const isSel = ri === r && ci === c;
                    const prefix = isSel ? bold(green('▶ ')) : '  ';
                    const padded = name + ' '.repeat(colWidths[ci] - _displayWidth(name) + 2);
                    s += prefix + padded;
                }
            }
            term.write(s);
        };

        this.closed = false;
        this._selectState = {
            options: opts.options,
            move: opts.move || _defaultGridMove,
            render: opts.render || defaultRender,
            onPick: opts.onPick,
            onCancel: opts.onCancel || null,
            term: this.term,
            selRow: 0,
            selCol: 0,
        };

        this.isTyping = true;
        this.printThen(opts.text || '', () => {
            this.isTyping = false;
            this.term.write('\x1B[?25l');
            const ss = this._selectState;
            ss.render(ss.selRow, ss.selCol, ss.options, ss.term);
            rendered = true;
        });
    }

    _handleSelectKey(data) {
        const ss = this._selectState;
        if (data.length === 1 && data.charCodeAt(0) === 0x1B) {
            this._selectState = null;
            (ss.onCancel || this.onCancel).call(this);
            return;
        }
        const code = data.charCodeAt(0);
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
            this.shell.readLine(onInput);
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
            dlg.open();
            const frame = new DialogFrame(this.shell, dlg);
            frame.started = true;
            this.shell._pushFrame(frame);
            this.shell._tick();
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
            dlg.open();
            const frame = new DialogFrame(this.shell, dlg);
            frame.started = true;
            this.shell._pushFrame(frame);
            this.shell._tick();
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

function _defaultGridMove(data, row, col, options) {
    if (data === '\x1B[A') {
        if (row === 0) return { row, col };
        const prev = options[row - 1];
        return { row: row - 1, col: Math.min(col, prev.length - 1) };
    }
    if (data === '\x1B[B') {
        if (row === options.length - 1) return { row, col };
        const next = options[row + 1];
        return { row: row + 1, col: Math.min(col, next.length - 1) };
    }
    if (data === '\x1B[D') {
        if (col === 0) return { row, col };
        return { row, col: col - 1 };
    }
    if (data === '\x1B[C') {
        const cur = options[row];
        if (col === cur.length - 1) return { row, col };
        return { row, col: col + 1 };
    }
    return { row, col };
}

function _displayWidth(s) {
    let w = 0;
    for (const ch of s) {
        w += ch.codePointAt(0) > 0x2E7F ? 2 : 1;
    }
    return w;
}
