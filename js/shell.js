/**
 * DemoShell — line-editing shell with history, tab completion,
 * command dispatch, dialog integration, and clock mode.
 *
 * ShellWidgetManager — manages TSR widget lifecycle with scroll region.
 */

import { StateStack, MenuDialog, InputDialog, ClockDialog, ShowDialog } from './dialog.js';
import { Typewriter } from './typewriter.js';
import { formatTime } from './time.js';
import {
    Help, Clear, Echo, DateCmd, Uname, Neofetch, Cowsay, Ascii,
    Fortune, Calc, Exit, Whoami, MenuCmd, ClockCmd, WidgetCmd, Quiz,
} from './cmd/index.js';

export class DemoShell {
    constructor(term) {
        this.term = term;
        this.line = '';
        this.prompt = '$ ';
        this.promptShown = false;
        this.running = false;
        this.history = [];
        this.historyPos = -1;
        this.stateStack = new StateStack(this.term);
        this.activeDialog = null;
        this.menuDialog = null;
        this._pendingAction = null;
        this.commands = {};
        this.menuItems = [];
        this.cmdList = [];

        this._clockCleanup = null;
        this.typewriter = new Typewriter(this.term);
        this._pendingPrompt = false;
        this.typewriter.onDrain(() => {
            if (this._pendingPrompt) {
                this._pendingPrompt = false;
                this.showPrompt();
            }
        });
        this.widgetManager = new ShellWidgetManager(this);
        this._registerCommands();
        this.start();
    }

    _registerCommands() {
        const classes = [
            Ascii, Calc, Clear, ClockCmd, Cowsay, DateCmd, Echo,
            Exit, Fortune, Help, MenuCmd, Neofetch, Quiz, Uname, Whoami, WidgetCmd,
        ];
        for (const Cls of classes) {
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
        this.term.write('\x1B[1;32mOpenCode Terminal v1.0.0\x1B[0m\n');
        this.term.write('Type \x1B[33mhelp\x1B[0m for available commands.\n\n');
        this.term.write('\x1B[90m日本語テスト漢字常用字非常用擴充字\x1B[0m');
        this.term.write('  \x1B[90m\u2200\u2600\u2665\u2713\x1B[0m\n\n');
        this.showPrompt();
    }

    showPrompt() {
        this.term.write(this.prompt);
        this.promptShown = true;
        this.line = '';
        this.historyPos = -1;
    }

    readLine(callback) {
        this._readLinePending = callback;
        this._readLineBuffer = '';
    }

    /**
     * Main input pipeline. Processing order:
     * 1. clock mode → only ESC exits
     * 2. active dialog → handleKey, then consume _pendingAction
     * 3. shell line editing → Ctrl/C, D, L, Enter, BS, Tab, arrow history
     */
    handleInput(data) {
        if (!this.running) return;

        if (this._clockCleanup) {
            for (let i = 0; i < data.length; i++) {
                const code = data.charCodeAt ? data.charCodeAt(i) : data[i];
                if (code === 0x1B) {
                    const fn = this._clockCleanup;
                    this._clockCleanup = null;
                    fn();
                    return;
                }
            }
            return;
        }

        if (this.typewriter.isActive()) {
            for (let i = 0; i < data.length; i++) {
                const ch = data[i];
                const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
                if (code === 0x03) {
                    this._pendingPrompt = false;
                    this._readLinePending = null;
                    this._readLineBuffer = '';
                    this.typewriter.abort();
                    this.term.write('^C\n');
                    this.showPrompt();
                    return;
                }
            }
            return;
        }

        if (this.activeDialog && !this.activeDialog.closed) {
            this.activeDialog.handleKey(data);
            if (this.activeDialog && this.activeDialog.closed) {
                this.activeDialog = null;
            }
            if (this._pendingAction) {
                const a = this._pendingAction;
                this._pendingAction = null;
                if (a.type === 'show-calc-result') {
                    const showDlg = new ShowDialog(this.term, {
                        message: a.message,
                        stack: this.stateStack,
                        onExit: () => { this.activeDialog = this.menuDialog; },
                    });
                    this.activeDialog = showDlg;
                    showDlg.open();
                    return;
                } else if (a.type === 'exec') {
                    this.menuDialog = null;
                    this.commands[a.cmd](a.args);
                }
            }
            if (!this.activeDialog) this._checkTypewriterDrain();
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
                    this._checkTypewriterDrain();
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

        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;

            if (code === 0x03) {
                this.term.write('^C\n');
                this.showPrompt();
                continue;
            }

            if (code === 0x04) {
                if (this.line.length === 0) {
                    this.term.write('exit\n');
                    this.showPrompt();
                }
                continue;
            }

            if (code === 0x0C) {
                this.term.write('\x1B[2J\x1B[H');
                this.term.write(this.prompt + this.line);
                continue;
            }

            if (code === 0x0D || code === 0x0A) {
                this.term.write('\r\n');
                this.execute(this.line);
                this.line = '';
                if (!this.activeDialog && !this._clockCleanup && !this._readLinePending) this._checkTypewriterDrain();
                continue;
            }

            if (code === 0x7F || code === 0x08) {
                if (this.line.length > 0) {
                    const last = this.line[this.line.length - 1];
                    const w = this.term.isWide(last) ? 2 : 1;
                    this.line = this.line.slice(0, -1);
                    this.term.write('\b'.repeat(w) + ' '.repeat(w) + '\b'.repeat(w));
                }
                continue;
            }

            if (code === 0x09) {
                const completions = Object.keys(this.commands).filter(cmd => cmd.startsWith(this.line));
                if (completions.length === 1) {
                    const rest = completions[0].slice(this.line.length);
                    this.line = completions[0];
                    this.term.write(rest);
                } else if (completions.length > 1) {
                    this.term.write('\r\n');
                    this.term.write(completions.join('  ') + '\n');
                    this.term.write(this.prompt + this.line);
                }
                continue;
            }

            if (code === 0x1B) {
                if (data[i + 1] === '[' || data[i + 1] === 'O') {
                    const seq = data.slice(i, i + 3);
                    if (seq === '\x1B[A') {
                        if (this.history.length > 0) {
                            if (this.historyPos === -1) this.historyPos = this.history.length - 1;
                            else if (this.historyPos > 0) this.historyPos--;
                            const newLine = this.history[this.historyPos];
                            const diff = this.line.length;
                            this.term.write('\b \b'.repeat(diff));
                            this.line = newLine;
                            this.term.write(newLine);
                        }
                        i += 2;
                        continue;
                    }
                    if (seq === '\x1B[B') {
                        if (this.historyPos >= 0) {
                            this.historyPos++;
                            const diff = this.line.length;
                            this.term.write('\b \b'.repeat(diff));
                            if (this.historyPos >= this.history.length) {
                                this.line = '';
                                this.historyPos = -1;
                            } else {
                                this.line = this.history[this.historyPos];
                                this.term.write(this.line);
                            }
                        }
                        i += 2;
                        continue;
                    }
                    if (seq === '\x1B[C' || seq === '\x1B[D') {
                        i += 2;
                        continue;
                    }
                }
                continue;
            }

            if (code >= 0x20) {
                this.line += ch;
                this.term.write(ch);
            }
        }
    }

    execute(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        this.history.push(trimmed);
        if (this.history.length > 100) this.history.shift();

        const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        const cmd = parts[0] ? parts[0].toLowerCase() : '';
        const args = parts.slice(1).map(a => a.replace(/^"(.*)"$/, '$1'));

        const handler = this.commands[cmd];
        if (handler) {
            handler(args);
        } else {
            this.print('\x1B[91mCommand not found: ' + cmd + '\x1B[0m\n');
            this.print('Try \x1B[33mhelp\x1B[0m.\n');
        }
    }

    print(text) {
        this.typewriter.enqueue(text);
    }

    _checkTypewriterDrain() {
        if (this.typewriter.isActive()) {
            this._pendingPrompt = true;
        } else {
            this.showPrompt();
        }
    }

    clockMode() {
        const lineY = this.term.curY;
        let running = true;
        this.term.write('\x1B[?25l');
        const draw = () => {
            if (!running) return;
            const t = formatTime(new Date());
            this.term.write(`\x1B[${lineY + 1};1H\x1B[2K\x1B[36m${t}\x1B[0m`);
        };
        draw();
        const id = setInterval(draw, 1000);
        this._clockCleanup = () => {
            running = false;
            clearInterval(id);
            const clampY = Math.min(lineY, Math.max(0, this.term.rows - 2));
            this.term.write(`\x1B[${clampY + 2};1H\x1B[?25h`);
            this.showPrompt();
        };
    }

    _openCalcDialog(menuDlg) {
        const inputDlg = new InputDialog(this.term, {
            title: '\u8ACB\u8F38\u5165\u7B97\u5F0F',
            prompt: '\u7B97\u5F0F\uFF1A',
            footer: 'Enter Confirm  ESC Back',
            stack: this.stateStack,
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
                    msg = '\x1B[91mError:\x1B[0m ' + e.message;
                }
                this._pendingAction = { type: 'show-calc-result', message: msg };
            },
            onCancel: () => {
                this.activeDialog = menuDlg;
            }
        });
        this.activeDialog = inputDlg;
        inputDlg.open();
    }

    _openQuizDialog(menuDlg) {
        const a = Math.floor(Math.random() * 9) + 1;
        let b = Math.floor(Math.random() * 9) + 1;
        const ops = ['+', '-', '\u00D7'];
        const op = ops[Math.floor(Math.random() * 3)];
        if (op === '-' && a < b) b = [a, a = b][0];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

        const inputDlg = new InputDialog(this.term, {
            title: 'Quiz',
            prompt: `${a} ${op} ${b} = ?`,
            footer: 'Enter Answer  ESC Back',
            stack: this.stateStack,
            onConfirm: (expr) => {
                if (!expr.trim()) {
                    if (menuDlg) this.activeDialog = menuDlg;
                    return;
                }
                const userAns = parseInt(expr.trim(), 10);
                let msg;
                if (userAns === answer) {
                    msg = '\x1B[1;32m\u2713 Correct!\x1B[0m';
                } else {
                    msg = `\x1B[1;31m\u2717 Wrong!\x1B[0m  Answer: \x1B[1;37m${answer}\x1B[0m`;
                }
                this._pendingAction = { type: 'show-calc-result', message: msg };
            },
            onCancel: () => {
                if (menuDlg) this.activeDialog = menuDlg;
            }
        });
        this.activeDialog = inputDlg;
        inputDlg.open();
    }

    _openClockDialog() {
        const clockDlg = new ClockDialog(this.term, {
            stack: this.stateStack,
            onExit: () => {
                this.activeDialog = this.menuDialog;
            }
        });
        this.activeDialog = clockDlg;
        clockDlg.open();
    }

    menuCmd() {
        const menuDlg = new MenuDialog(this.term, this.menuItems, {
            width: 44,
            title: 'Command Menu',
            footer: '\u2191\u2193 Navigate  \u21A9 Execute  ESC Quit',
            visibleCount: 5,
            stack: this.stateStack,
            onSelect: (item) => {
                if (item.name === 'calc') {
                    this._openCalcDialog(menuDlg);
                    return;
                }
                if (item.name === 'quiz') {
                    this._openQuizDialog(menuDlg);
                    return;
                }
                if (item.name === 'clock') {
                    this._openClockDialog();
                    return;
                }
                this._pendingAction = { type: 'exec', cmd: item.name, args: [] };
                return 'close';
            },
            onCancel: () => {
                this._pendingAction = null;
            }
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
        widget._row = n;
        const total = n + 1;
        this._setScrollTop(total);
        widget.start();
        this._widgets.push(widget);
    }

    remove(widget) {
        const i = this._widgets.indexOf(widget);
        if (i < 0) return;
        widget.stop();
        this._widgets.splice(i, 1);
        for (let j = 0; j < this._widgets.length; j++) {
            this._widgets[j]._row = j;
        }
        const total = this._widgets.length;
        this._setScrollTop(total);
        this.redrawAll();
    }

    redrawAll() {
        for (const w of this._widgets) {
            if (!this.shell.stateStack.isCovered(w._row)) {
                w.draw();
            }
        }
    }

    _setScrollTop(n) {
        this.term.scrollTop = n;
        this.term.scrollBottom = this.term.rows - 1;
        this.term.markAllDirty();
    }

    destroy() {
        this.shell.stateStack.removeRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
        this._setScrollTop(0);
    }
}
