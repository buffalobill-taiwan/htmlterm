import { Typewriter } from './typewriter.js';
import { LineEditor } from './LineEditor.js';
import { MenuDialog } from './dialog/index.js';
import { SyncCmdFrame, DialogFrame } from './CmdFrame.js';
import { red, yellow, warn } from './sgr.js';
import { tokenize } from './tokenize.js';

export class SystemManager {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;

        this._cmdStack = [];
        this._tickQueued = false;
        this._queuedInput = [];
        this._busy = false;
        this._readLineState = null;
        this._abortGeneration = 0;

        this.typewriter = new Typewriter(this.term);
        this.typewriter.onDrain(() => this._tick());

        this.editor = new LineEditor(this.term, {
            onExecute: (line) => this.execute(line),
            onShowPrompt: () => this._tick(),
        });

        this._dialogRestoreHooks = [];
        this._dialogPositions = {};

        this.widgetManager = new WidgetManager(this);
        this._dragTarget = null;
        this.menuDialog = null;
    }

    setup() {
        this.editor.setPrompt(this.shell.prompt);
        this.editor.setCommands(Object.keys(this.shell.commands));
    }

    get busy() { return this._busy; }

    get abortGeneration() { return this._abortGeneration; }

    holdBusy() { this._busy = true; }

    releaseBusy() {
        this._busy = false;
        this._tick();
    }

    print(text) {
        this.typewriter.enqueue(text);
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
                    this.shell.showPrompt();
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

        const handler = this.shell.commands[cmd];
        if (handler) {
            const cmdInstance = this.shell._cmdInstances[cmd];
            this._pushFrame(new SyncCmdFrame(this.shell, cmd, args, cmdInstance));
            this._tick();
        } else {
            this.print(red('Command not found: ' + cmd) + '\n');
            this.print('Try ' + yellow('help') + '.\n');
        }
    }

    readLine(callback) {
        if (this._readLineState) {
            warn('readLine called while another readLine is pending — overwriting');
        }
        this._readLineState = { callback, buffer: '' };
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
                this.shell.showPrompt();
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
        if (!this.shell.running) return;

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
        const frame = new DialogFrame(this.shell, dlg);
        frame._saveCursor();
        dlg.open();
        frame.started = true;
        this._pushFrame(frame);
        this._tick();
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

    addDialogRestoreHook(fn) {
        this._dialogRestoreHooks.push(fn);
    }

    removeDialogRestoreHook(fn) {
        const i = this._dialogRestoreHooks.indexOf(fn);
        if (i >= 0) this._dialogRestoreHooks.splice(i, 1);
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
        const pos = this._dialogPositions[key] || {};
        const dlg = new DialogClass(this.term, ...ctorArgs, {
            ...opts,
            x: pos.x,
            y: pos.y,
            savePos: (x, y) => { this._dialogPositions[key] = { x, y }; },
        });
        this.pushDialogFrame(dlg);
        return dlg;
    }

    menuCmd() {
        this.menuDialog = null;
        const menuDlg = this._createDialog(MenuDialog, 'menu', {
            width: 44,
            title: 'Command Menu',
            footer: '↑↓ Navigate  ↩ Execute  ESC Quit',
            visibleCount: 5,
            onSelect: (item) => {
                const inst = this.shell._cmdInstances[item.name];
                if (inst && inst.constructor.openMenuDialog) {
                    inst.constructor.openMenuDialog(this.shell, menuDlg);
                    return;
                }
                this._pushFrame(new SyncCmdFrame(this.shell, item.name, [], inst));
                this.menuDialog = null;
                return 'close';
            },
            onCancel: () => {}
        }, this.shell.menuItems);
        this.menuDialog = menuDlg;
    }
}

export class WidgetManager {
    constructor(system) {
        this.system = system;
        this.shell = system.shell;
        this.term = system.term;
        this._widgets = [];
        this._savedState = new Map();
        this._hook = () => this.redrawAll();
        system.addDialogRestoreHook(this._hook);
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
        this.system.removeDialogRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
    }
}
