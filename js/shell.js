/**
 * DemoShell — line-editing shell with history, tab completion,
 * command dispatch, and dialog integration.
 *
 * ShellWidgetManager — manages TSR widget lifecycle with scroll region.
 */

import { StateStack, MenuDialog, InputDialog, ShowDialog } from './dialog.js';
import { Typewriter } from './typewriter.js';
import { LineEditor } from './LineEditor.js';
import * as cmdModule from './cmd/index.js';
import { bold, green, yellow, gray, red, white } from './sgr.js';

function tokenize(str) {
    const args = [];
    let i = 0;
    while (i < str.length) {
        while (i < str.length && str[i] === ' ') i++;
        if (i >= str.length) break;

        let arg = '';
        while (i < str.length && str[i] !== ' ') {
            const ch = str[i];
            if (ch === '\\') {
                i++;
                if (i < str.length) arg += str[i];
                i++;
            } else if (ch === '\'') {
                i++;
                while (i < str.length && str[i] !== '\'') {
                    arg += str[i];
                    i++;
                }
                if (i < str.length) i++;
            } else if (ch === '"') {
                i++;
                while (i < str.length && str[i] !== '"') {
                    if (str[i] === '\\') {
                        i++;
                        if (i < str.length) {
                            const next = str[i];
                            if (next === '"' || next === '\\' || next === '$' || next === '`') {
                                arg += next;
                            } else {
                                arg += '\\' + next;
                            }
                            i++;
                        }
                    } else {
                        arg += str[i];
                        i++;
                    }
                }
                if (i < str.length) i++;
            } else {
                arg += ch;
                i++;
            }
        }
        args.push(arg);
    }
    return args;
}

export class DemoShell {
    constructor(term) {
        this.term = term;
        this.prompt = '$ ';
        this.promptShown = false;
        this.running = false;
        this.stateStack = new StateStack(this.term);
        this.activeDialog = null;
        this.menuDialog = null;
        this.commands = {};
        this.menuItems = [];
        this.cmdList = [];

        this.typewriter = new Typewriter(this.term);
        this.typewriter.onDrain(() => this._schedulePrompt());
        this.editor = new LineEditor(this.term, {
            onExecute: (line) => {
                this.execute(line);
                this._schedulePrompt();
            },
            onShowPrompt: () => this._schedulePrompt(),
        });
        this.editor.setPrompt(this.prompt);

        this.widgetManager = new ShellWidgetManager(this);
        this._registerCommands();

        this.editor.setCommands(Object.keys(this.commands));
        this._queuedInput = [];
        this._busy = false;
        this._dragTarget = null;
        this._savedPositions = {};

        this.start();
    }

    _registerCommands() {
        for (const Cls of Object.values(cmdModule)) {
            if (typeof Cls !== 'function' || !Cls.commandName) continue;
            const cmd = new Cls(this);
            const name = Cls.commandName;
            const help = Cls.help;
            const menu = Cls.menu;
            this.commands[name] = cmd.execute.bind(cmd);
            this.cmdList.push({ name, help });
            if (menu) this.menuItems.push({ name, desc: menu });
        }
        this.cmdList.sort((a, b) => a.name.localeCompare(b.name));
        this.menuItems.sort((a, b) => a.name.localeCompare(b.name));
    }

    start() {
        this.running = true;
        this.term.write('\x1B[2J\x1B[H');
        this.term.write(bold(green('OpenCode Terminal v1.0.0')) + '\n');
        this.term.write('Type ' + yellow('help') + ' for available commands.\n\n');
        this.term.write(gray('AEIOUÀÈÌÒÙ金木水火土鑫森淼焱垚あいうえおアイウエオ') + '\n\n');
        this.showPrompt();
    }

    showPrompt() {
        this.term.write(this.prompt);
        this.promptShown = true;
        this.editor.reset();
        this._flushQueuedInput();
    }

    _flushQueuedInput() {
        const batch = this._queuedInput;
        this._queuedInput = [];
        for (let i = 0; i < batch.length; i++) {
            if (this.typewriter.isActive()) {
                this._queuedInput.push(...batch.slice(i));
                return;
            }
            this.handleInput(batch[i]);
        }
    }

    readLine(callback) {
        if (this._readLinePending) {
            if (typeof console !== 'undefined') console.warn('readLine called while another readLine is pending — overwriting');
        }
        this._readLinePending = callback;
        this._readLineBuffer = '';
    }

    handleInput(data) {
        if (!this.running) return;

        if (this.activeDialog && !this.activeDialog.closed) {
            this.activeDialog.handleKey(data);
            if (this.activeDialog && this.activeDialog.closed) {
                this.activeDialog = null;
            }
            if (!this.activeDialog) this._schedulePrompt();
            return;
        }

        if (this.typewriter.isActive()) {
            for (let i = 0; i < data.length; i++) {
                const ch = data[i];
                const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
                if (code === 0x03) {
                    this._queuedInput = [];
                    this._readLinePending = null;
                    this._readLineBuffer = '';
                    this.typewriter.abort();
                    this.term.write('^C\n');
                    this.showPrompt();
                    return;
                }
            }
            this._queuedInput.push(data);
            return;
        }

        if (this._readLinePending) {
            for (let i = 0; i < data.length; i++) {
                const ch = data[i];
                const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
                if (code === 0x0D || code === 0x0A) {
                    const cb = this._readLinePending;
                    this._readLinePending = null;
                    this.term.write('\r\n');
                    cb(this._readLineBuffer.trim());
                    this._readLineBuffer = '';
                    this._schedulePrompt();
                    return;
                }
                if (code === 0x03) {
                    this._readLinePending = null;
                    this._readLineBuffer = '';
                    this.term.write('^C\n');
                    this.showPrompt();
                    return;
                }
                if (code === 0x7F || code === 0x08) {
                    if (this._readLineBuffer.length > 0) {
                        const last = this._readLineBuffer[this._readLineBuffer.length - 1];
                        const w = this.term.isWide(last) ? 2 : 1;
                        this._readLineBuffer = this._readLineBuffer.slice(0, -1);
                        this.term.write('\b'.repeat(w) + ' '.repeat(w) + '\b'.repeat(w));
                    }
                    continue;
                }
                if (code === 0x1B) {
                    if (data[i + 1] === '[' || data[i + 1] === 'O') i += 2;
                    continue;
                }
                if (code < 0x20) continue;
                this._readLineBuffer += ch;
                this.term.write(ch);
            }
            return;
        }

        this.editor.handleKey(data);
    }

    handleMouse(type, info) {
        if (type === 'mousedown') {
            const ovs = this.term.overlays;
            for (let i = ovs.length - 1; i >= 0; i--) {
                const ov = ovs[i];
                if (info.col >= ov.x && info.col < ov.x + ov.w &&
                    info.row >= ov.y && info.row < ov.y + ov.h) {
                    const owner = ov.owner;
                    if (owner && typeof owner.startDrag === 'function') {
                        this._dragTarget = owner;
                        owner.startDrag(info.col, info.row);
                        return true;
                    }
                    break;
                }
            }
            return false;
        }

        if (type === 'mousemove' && this._dragTarget) {
            this._dragTarget.moveDrag(info.col, info.row);
            return true;
        }

        if (type === 'mouseup' && this._dragTarget) {
            this._dragTarget.endDrag();
            this._dragTarget = null;
            return true;
        }

        return false;
    }

    execute(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        this.editor.history.push(trimmed);
        if (this.editor.history.length > 100) this.editor.history.shift();

        const tokens = tokenize(trimmed);
        const cmd = tokens[0] ? tokens[0].toLowerCase() : '';
        const args = tokens.slice(1);

        const handler = this.commands[cmd];
        if (handler) {
            handler(args);
        } else {
            this.print(red('Command not found: ' + cmd) + '\n');
            this.print('Try ' + yellow('help') + '.\n');
        }
    }

    print(text) {
        this.typewriter.enqueue(text);
    }

    _schedulePrompt() {
        if (this._busy || this.activeDialog || this._readLinePending || this.typewriter.isActive()) return;
        this.showPrompt();
    }

    _openCalcDialog(menuDlg) {
        const pos = this._savedPositions['calc'] || {};
        const inputDlg = new InputDialog(this.term, {
            title: '\u8ACB\u8F38\u5165\u7B97\u5F0F',
            prompt: '\u7B97\u5F0F\uFF1A',
            footer: 'Enter Confirm  ESC Back',
            stack: this.stateStack,
            x: pos.x,
            y: pos.y,
            savePos: (x, y) => { this._savedPositions['calc'] = { x, y }; },
            onConfirm: (expr) => {
                if (!expr.trim()) {
                    this.activeDialog = menuDlg;
                    return;
                }
                let msg;
                try {
                    const result = Function('"use strict"; return (' + expr + ')')();
                    msg = String(result);
                } catch (e) {
                    msg = red('Error:') + ' ' + e.message;
                }
                const showPos = this._savedPositions['show'] || {};
                const showDlg = new ShowDialog(this.term, {
                    message: msg,
                    stack: this.stateStack,
                    x: showPos.x,
                    y: showPos.y,
                    savePos: (x, y) => { this._savedPositions['show'] = { x, y }; },
                    onExit: () => {
                        if (menuDlg && !menuDlg.closed) {
                            this.activeDialog = menuDlg;
                        } else {
                            this.activeDialog = null;
                            this._schedulePrompt();
                        }
                    },
                });
                this.activeDialog = showDlg;
                showDlg.open();
            },
            onCancel: () => {
                this.activeDialog = menuDlg;
            }
        });
        this.activeDialog = inputDlg;
        inputDlg.open();
    }

    _openQuizDialog(menuDlg) {
        let a = Math.floor(Math.random() * 9) + 1;
        let b = Math.floor(Math.random() * 9) + 1;
        const ops = ['+', '-', '\u00D7'];
        const op = ops[Math.floor(Math.random() * 3)];
        if (op === '-' && a < b) b = [a, a = b][0];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

        const pos = this._savedPositions['quiz'] || {};
        const inputDlg = new InputDialog(this.term, {
            title: 'Quiz',
            prompt: `${a} ${op} ${b} = ?`,
            footer: 'Enter Answer  ESC Back',
            stack: this.stateStack,
            x: pos.x,
            y: pos.y,
            savePos: (x, y) => { this._savedPositions['quiz'] = { x, y }; },
            onConfirm: (expr) => {
                if (!expr.trim()) {
                    if (menuDlg) this.activeDialog = menuDlg;
                    return;
                }
                const userAns = parseInt(expr.trim(), 10);
                let msg;
                if (userAns === answer) {
                    msg = bold(green('\u2713 Correct!'));
                } else {
                    msg = bold(red('\u2717 Wrong!')) + '  Answer: ' + bold(white('' + answer));
                }
                const showPos = this._savedPositions['show'] || {};
                const showDlg = new ShowDialog(this.term, {
                    message: msg,
                    stack: this.stateStack,
                    x: showPos.x,
                    y: showPos.y,
                    savePos: (x, y) => { this._savedPositions['show'] = { x, y }; },
                    onExit: () => {
                        if (menuDlg && !menuDlg.closed) {
                            this.activeDialog = menuDlg;
                        } else {
                            this.activeDialog = null;
                            this._schedulePrompt();
                        }
                    },
                });
                this.activeDialog = showDlg;
                showDlg.open();
            },
            onCancel: () => {
                if (menuDlg) this.activeDialog = menuDlg;
            }
        });
        this.activeDialog = inputDlg;
        inputDlg.open();
    }

    menuCmd() {
        const pos = this._savedPositions['menu'] || {};
        const menuDlg = new MenuDialog(this.term, this.menuItems, {
            width: 44,
            title: 'Command Menu',
            footer: '\u2191\u2193 Navigate  \u21A9 Execute  ESC Quit',
            visibleCount: 5,
            stack: this.stateStack,
            x: pos.x,
            y: pos.y,
            savePos: (x, y) => { this._savedPositions['menu'] = { x, y }; },
            onSelect: (item) => {
                if (item.name === 'calc') {
                    this._openCalcDialog(menuDlg);
                    return;
                }
                if (item.name === 'quiz') {
                    this._openQuizDialog(menuDlg);
                    return;
                }
                this.menuDialog = null;
                this.commands[item.name]([]);
                this._schedulePrompt();
                return 'close';
            },
            onCancel: () => {} 
        });
        this.activeDialog = menuDlg;
        this.menuDialog = menuDlg;
        menuDlg.open();
    }
}

export class ShellWidgetManager {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this._widgets = [];
        this._hook = () => this.redrawAll();
        shell.stateStack.addRestoreHook(this._hook);
    }

    add(widget) {
        const n = this._widgets.length;
        widget.setPosition(widget._x, n);
        widget.start();
        this._widgets.push(widget);
    }

    remove(widget) {
        const i = this._widgets.indexOf(widget);
        if (i < 0) return;
        widget.stop();
        this._widgets.splice(i, 1);
        for (let j = 0; j < this._widgets.length; j++) {
            const w = this._widgets[j];
            w.setPosition(w._x, j);
        }
        this.redrawAll();
    }

    redrawAll() {
        for (const w of this._widgets) {
            w.draw();
        }
    }

    destroy() {
        this.shell.stateStack.removeRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
    }
}
