import * as cmdModule from './cmd/index.js';
import { SyncCmdFrame, DialogFrame } from './CmdFrame.js';
import { SystemManager } from './system.js';
import { bold, green, yellow, red, gray, warn } from './sgr.js';
import { tokenize } from './tokenize.js';

export class DemoShell {
    constructor(term) {
        this.term = term;
        this.prompt = '$ ';
        this.running = false;
        this.commands = {};
        this.menuItems = [];
        this.cmdList = [];

        this._cmdStack = [];
        this._tickQueued = false;
        this._queuedInput = [];
        this._busy = false;
        this._abortGeneration = 0;
        this._readLineState = null;

        this.system = new SystemManager(this);
        this._registerCommands();
        this.system.setup();

        this.typewriter = this.system.typewriter;
        this.editor = this.system.editor;
        this.widgetManager = this.system.widgetManager;
        this._dialogRestoreHooks = this.system._dialogRestoreHooks;
        this.menuDialog = null;

        this.start();
    }

    get busy() { return this._busy; }

    get abortGeneration() { return this._abortGeneration; }

    holdBusy() { this._busy = true; }

    releaseBusy() {
        this._busy = false;
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
        if (this._readLineState) {
            warn('readLine called while another readLine is pending — overwriting');
        }
        this._readLineState = { callback, buffer: '' };
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
                if (!this._busy && !this._readLineState) {
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
                const state = this._readLineState;
                this._readLineState = null;
                this.term.write('\r\n');
                state.callback(state.buffer.trim());
                this._tick();
                return;
            }
            if (code === 0x03) {
                this._readLineState = null;
                this.term.write('^C\n');
                this.showPrompt();
                return;
            }
            if (code === 0x7F || code === 0x08) {
                if (this._readLineState && this._readLineState.buffer.length > 0) {
                    const last = this._readLineState.buffer[this._readLineState.buffer.length - 1];
                    const w = this.term.isWide(last) ? 2 : 1;
                    this._readLineState.buffer = this._readLineState.buffer.slice(0, -1);
                    this.term.write('\b'.repeat(w) + ' '.repeat(w) + '\b'.repeat(w));
                }
                continue;
            }
            if (code === 0x1B) {
                if (data[i + 1] === '[' || data[i + 1] === 'O') i += 2;
                continue;
            }
            if (code < 0x20) continue;
            if (this._readLineState) this._readLineState.buffer += ch;
            this.term.write(ch);
        }
    }

    _abortAll() {
        this._abortGeneration++;
        this._busy = false;
        this._queuedInput = [];
        this._readLineState = null;
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
            if (this._readLineState) {
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
        if (this._readLineState) {
            this._handleReadLineInput(data);
            return;
        }
        this.editor.handleKey(data);
    }

    pushDialogFrame(dlg) {
        const frame = new DialogFrame(this, dlg);
        frame._saveCursor();
        dlg.open();
        frame.started = true;
        this._pushFrame(frame);
        this._tick();
    }
}
