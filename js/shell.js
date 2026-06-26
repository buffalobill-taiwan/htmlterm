import { MenuDialog, InputDialog, ShowDialog } from './dialog/index.js';
import { Typewriter } from './typewriter.js';
import { LineEditor } from './LineEditor.js';
import * as cmdModule from './cmd/index.js';
import { SyncCmdFrame, DialogFrame } from './CmdFrame.js';
import { bold, green, yellow, gray, red, white, warn } from './sgr.js';
import { tokenize } from './tokenize.js';
import { safeEval } from './calc-expr.js';

export class DemoShell {
    constructor(term) {
        this.term = term;
        this.prompt = '$ ';
        this.running = false;
        this.menuDialog = null;
        this.commands = {};
        this.menuItems = [];
        this.cmdList = [];

        this.typewriter = new Typewriter(this.term);
        this.typewriter.onDrain(() => this._tick());
        this.editor = new LineEditor(this.term, {
            onExecute: (line) => { this.execute(line); },
            onShowPrompt: () => this._tick(),
        });
        this.editor.setPrompt(this.prompt);

        this._dialogRestoreHooks = [];
        this.widgetManager = new ShellWidgetManager(this);
        this._registerCommands();

        this.editor.setCommands(Object.keys(this.commands));
        this._cmdStack = [];
        this._tickQueued = false;
        this._queuedInput = [];
        this._busy = false;
        this._abortGeneration = 0;
        this._readLinePending = null;
        this._readLineBuffer = '';
        this._dragTarget = null;
        this._savedPositions = {};

        this.start();
    }

    get busy() { return this._busy; }

    holdBusy() { this._busy = true; }

    releaseBusy() {
        this._busy = false;
        this._tick();
    }

    get abortGeneration() { return this._abortGeneration; }

    addDialogRestoreHook(fn) {
        this._dialogRestoreHooks.push(fn);
    }

    removeDialogRestoreHook(fn) {
        const i = this._dialogRestoreHooks.indexOf(fn);
        if (i >= 0) this._dialogRestoreHooks.splice(i, 1);
    }

    pushDialogFrame(dlg) {
        const frame = new DialogFrame(this, dlg);
        frame._saveCursor();
        dlg.open();
        frame.started = true;
        this._pushFrame(frame);
        this._tick();
    }

    _registerCommands() {
        this._cmdInstances = {};
        for (const Cls of Object.values(cmdModule)) {
            if (typeof Cls !== 'function' || !Cls.commandName) continue;
            const cmd = new Cls(this);
            const name = Cls.commandName;
            const help = Cls.help;
            const menu = Cls.menu;
            this._cmdInstances[name] = cmd;
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
            warn('readLine called while another readLine is pending — overwriting');
        }
        this._readLinePending = callback;
        this._readLineBuffer = '';
    }

    _tick() {
        if (this._tickQueued) return;
        this._tickQueued = true;
        Promise.resolve().then(() => {
            this._tickQueued = false;
            this._processStack();
        });
    }

    _pushFrame(frame) {
        this._cmdStack.push(frame);
    }

    _processStack() {
        while (true) {
            while (this._cmdStack.length > 0 && this._cmdStack[this._cmdStack.length - 1].done) {
                this._cmdStack.pop();
            }

            if (this._cmdStack.length === 0) {
                if (this.typewriter.isActive()) return;
                if (!this._busy && !this._readLinePending) {
                    this.showPrompt();
                }
                return;
            }

            const frame = this._cmdStack[this._cmdStack.length - 1];

            if (!frame.started) {
                frame.started = true;
                frame.start();
                continue;
            }

            if (frame.blocked) return;

            frame.finish();
        }
    }

    execute(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) { this._tick(); return; }
        this.editor.history.push(trimmed);
        if (this.editor.history.length > 100) this.editor.history.shift();

        const tokens = tokenize(trimmed);
        const cmd = tokens[0] ? tokens[0].toLowerCase() : '';
        const args = tokens.slice(1);

        const handler = this.commands[cmd];
        if (handler) {
            const cmdInstance = this._cmdInstances[cmd];
            this._pushFrame(new SyncCmdFrame(this, cmd, args, cmdInstance));
            this._tick();
        } else {
            this.print(red('Command not found: ' + cmd) + '\n');
            this.print('Try ' + yellow('help') + '.\n');
        }
    }

    print(text) {
        this.typewriter.enqueue(text);
    }

    _handleReadLineInput(data) {
        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
            if (code === 0x0D || code === 0x0A) {
                const cb = this._readLinePending;
                this._readLinePending = null;
                this.term.write('\r\n');
                cb(this._readLineBuffer.trim());
                this._readLineBuffer = '';
                this._tick();
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
    }

    _abortAll() {
        this._abortGeneration++;
        this._busy = false;
        this._queuedInput = [];
        this._readLinePending = null;
        this._readLineBuffer = '';
        this._cmdStack = [];
        this.typewriter.abort();
        this.term.write('^C\n');
        this._tick();
    }

    _checkCtrlC(data) {
        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
            if (code === 0x03) {
                this._abortAll();
                return;
            }
        }
        this._queuedInput.push(data);
    }

    handleInput(data) {
        if (!this.running) return;

        const top = this._cmdStack[this._cmdStack.length - 1];

        if (top) {
            if (top.handleInput) {
                const handled = top.handleInput(data);
                if (top.done) this._tick();
                if (handled) return;
            }
            if (this._readLinePending) {
                this._handleReadLineInput(data);
                return;
            }
            if (top.blocked) {
                this._checkCtrlC(data);
                return;
            }
            this._tick();
            return;
        }

        if (this.typewriter.isActive()) {
            this._checkCtrlC(data);
            return;
        }
        if (this._readLinePending) {
            this._handleReadLineInput(data);
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

    _createDialog(DialogClass, key, opts, ...ctorArgs) {
        const pos = this._savedPositions[key] || {};
        const dlg = new DialogClass(this.term, ...ctorArgs, {
            ...opts,
            x: pos.x,
            y: pos.y,
            savePos: (x, y) => { this._savedPositions[key] = { x, y }; },
        });
        this.pushDialogFrame(dlg);
        return dlg;
    }

    _showResultDialog(msg) {
        setTimeout(() => {
            this._createDialog(ShowDialog, 'show', {
                message: msg,
                onExit: () => {},
            });
        }, 0);
    }

    _openCalcDialog(menuDlg) {
        this._createDialog(InputDialog, 'calc', {
            title: '\u8ACB\u8F38\u5165\u7B97\u5F0F',
            prompt: '\u7B97\u5F0F\uFF1A',
            footer: 'Enter Confirm  ESC Back',
            onConfirm: (expr) => {
                if (!expr.trim()) return;
                let msg;
                try {
                    msg = String(safeEval(expr));
                } catch (e) {
                    msg = red('Error:') + ' ' + (e.message || 'invalid expression');
                }
                this._showResultDialog(msg);
            },
            onCancel: () => {},
        });
    }

    _openQuizDialog(menuDlg) {
        let a = Math.floor(Math.random() * 9) + 1;
        let b = Math.floor(Math.random() * 9) + 1;
        const ops = ['+', '-', '\u00D7'];
        const op = ops[Math.floor(Math.random() * 3)];
        if (op === '-' && a < b) b = [a, a = b][0];
        const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;

        this._createDialog(InputDialog, 'quiz', {
            title: 'Quiz',
            prompt: `${a} ${op} ${b} = ?`,
            footer: 'Enter Answer  ESC Back',
            onConfirm: (expr) => {
                if (!expr.trim()) return;
                const userAns = parseInt(expr.trim(), 10);
                let msg;
                if (userAns === answer) {
                    msg = bold(green('\u2713 Correct!'));
                } else {
                    msg = bold(red('\u2717 Wrong!')) + '  Answer: ' + bold(white('' + answer));
                }
                this._showResultDialog(msg);
            },
            onCancel: () => {},
        });
    }

    menuCmd() {
        this.menuDialog = null;
        const menuDlg = this._createDialog(MenuDialog, 'menu', {
            width: 44,
            title: 'Command Menu',
            footer: '\u2191\u2193 Navigate  \u21A9 Execute  ESC Quit',
            visibleCount: 5,
            onSelect: (item) => {
                if (item.name === 'calc') {
                    this._openCalcDialog(menuDlg);
                    return;
                }
                if (item.name === 'quiz') {
                    this._openQuizDialog(menuDlg);
                    return;
                }
                this._pushFrame(new SyncCmdFrame(this, item.name, [], this._cmdInstances[item.name]));
                this.menuDialog = null;
                return 'close';
            },
            onCancel: () => {}
        }, this.menuItems);
        this.menuDialog = menuDlg;
    }
}

export class ShellWidgetManager {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this._widgets = [];
        this._savedState = new Map();
        this._hook = () => this.redrawAll();
        shell.addDialogRestoreHook(this._hook);
    }

    add(widget) {
        const key = widget.constructor.name;
        if (this._savedState.has(key)) {
            widget.restoreSaveState(this._savedState.get(key));
        }
        widget.start();
        this._widgets.push(widget);
    }

    remove(widget) {
        const i = this._widgets.indexOf(widget);
        if (i < 0) return;
        this._savedState.set(widget.constructor.name, widget.getSaveState());
        widget.stop();
        this._widgets.splice(i, 1);
        this.redrawAll();
    }

    redrawAll() {
        for (const w of this._widgets) {
            w.draw();
        }
    }

    destroy() {
        this.shell.removeDialogRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
    }
}
