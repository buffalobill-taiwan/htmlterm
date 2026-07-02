import { Typewriter } from './typewriter.js';
import { LineEditor } from './LineEditor.js';
import { tokenize } from '../util/tokenize.js';
import { ShellCmd } from '../cmd/ShellCmd.js';
import { ShellFrame, SyncCmdFrame, DialogFrame } from './CmdFrame.js';
import { system } from './sys.js';
import { bold, green, yellow, gray, warn } from '../util/sgr.js';
import { MenuDialog } from '../dialog/MenuDialog.js';

export class SystemManager {
    static instance = null;

    constructor(term, cmdModule) {
        SystemManager.instance = this;
        this.term = term;

        this.cmdStack = [];
        this._tickQueued = false;
        this._queuedInput = [];
        this._busy = false;
        this.readLineState = null;
        this._abortEpoch = 0;
        this._framePopHooks = [];

        this.typewriter = new Typewriter(this.term);
        this.typewriter.onDrain(() => this.tick());

        this.editor = new LineEditor(this.term, {
            onExecute: (line) => this.execute(line),
            onShowPrompt: () => {
                const top = this.cmdStack[this.cmdStack.length - 1];
                if (top && top.persistent) top._pendingActivate = true;
                this.tick();
            },
        });

        this.cmdList = [];
        this.menuItems = [];
        this.commands = {};
        this._cmdInstances = {};
        this.prompt = '$ ';
        this.running = false;

        this.dialogRestoreHooks = [];
        this._dialogPositions = {};

        this.widgetManager = new WidgetManager();
        this._dragTarget = null;
        this.menuDialog = null;

        this._registerCommands(cmdModule);
        this.start();
    }

    _registerCommands(cmdModule) {
        for (const Cls of Object.values(cmdModule)) {
            if (typeof Cls !== 'function' || !Cls.commandName) continue;
            if (Cls.commandName === 'shell') continue; // persistent shell, not a user command
            const cmd = new Cls();
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
        this.editor.setCommands(Object.keys(this.commands));
        this.editor.setPrompt(this.prompt);
    }

    start() {
        this.running = true;
        this.term.write('\x1B[2J\x1B[H');
        this.term.write(bold(green('HTML Term')) + '\n');
        this.term.write('Type ' + yellow('help') + ' for available commands.\n\n');
        this.term.write(gray('AEIOUÀÈÌÒÙ金木水火土鑫森淼焱垚あいうえおアイウエオ✂✓✕✨❄') + '\n\n');
        this._pushFrame(new ShellFrame(new ShellCmd()));
        this.tick();
    }

    get busy() { return this._busy; }
    get abortEpoch() { return this._abortEpoch; }

    holdBusy() { this._busy = true; }
    releaseBusy() {
        this._busy = false;
        this.tick();
    }

    print(text) {
        this.typewriter.enqueue(text);
    }

    tick() {
        if (this._tickQueued) return;
        this._tickQueued = true;
        Promise.resolve().then(() => {
            this._tickQueued = false;
            this._processStack();
        });
    }

    _pushFrame(frame) {
        this.cmdStack.push(frame);
    }

    addFramePopHook(fn) {
        this._framePopHooks.push(fn);
        return () => {
            const idx = this._framePopHooks.indexOf(fn);
            if (idx >= 0) this._framePopHooks.splice(idx, 1);
        };
    }

    _processStack() {
        while (true) {
            while (this.cmdStack.length > 0 && this.cmdStack[this.cmdStack.length - 1].done) {
                this.cmdStack.pop();
                for (const fn of this._framePopHooks.slice()) fn();
                if (this.cmdStack.length > 0 && this.cmdStack[this.cmdStack.length - 1].persistent) {
                    this.cmdStack[this.cmdStack.length - 1]._pendingActivate = true;
                }
            }

            if (this.cmdStack.length === 0) {
                return;
            }

            const frame = this.cmdStack[this.cmdStack.length - 1];

            if (!frame.started) {
                frame.started = true;
                frame.start();
                continue;
            }

            if (frame.blocked) return;

            if (frame.persistent) {
                if (frame._pendingActivate) {
                    if (this.typewriter.isActive() || this._busy || this.readLineState) return;
                    frame.onActivate();
                    frame._pendingActivate = false;
                    this.flushQueuedInput();
                }
                return;
            }

            frame.finish();
        }
    }

    execCmd(line) {
        const trimmed = line.trim();
        const tokens = tokenize(trimmed);
        const cmd = tokens[0] ? tokens[0].toLowerCase() : '';
        const args = tokens.slice(1);

        const handler = this.commands[cmd];
        if (handler) {
            const cmdInstance = this._cmdInstances[cmd];
            this._pushFrame(new SyncCmdFrame(cmd, args, cmdInstance));
        } else {
            this._pushFrame(new SyncCmdFrame(cmd, args, null));
        }
        this.tick();
    }

    execute(line) {
        this.editor.history.push(line.trim());
        if (this.editor.history.length > 100) this.editor.history.shift();
        this.execCmd(line);
    }

    readLine(callback) {
        if (this.readLineState) {
            warn('readLine called while another readLine is pending — overwriting');
        }
        const editor = new LineEditor(this.term, {
            onExecute: (line) => {
                this.readLineState = null;
                callback(line.trim());
                this.tick();
            },
            onShowPrompt: () => {
                // Ctrl+C / Ctrl+D inside readLine — cancel
                this.readLineState = null;
                const top = this.cmdStack[this.cmdStack.length - 1];
                if (top && top.persistent) top._pendingActivate = true;
                this.tick();
            },
        });
        editor.setPrompt('');
        this.readLineState = { editor };
    }

    _handleReadLineInput(data) {
        this.readLineState.editor.handleKey(data);
    }

    _abortAll() {
        this._abortEpoch++;
        this._busy = false;
        this._queuedInput = [];
        this.readLineState = null;
        while (this.cmdStack.length > 1) this.cmdStack.pop();
        this.typewriter.abort();
        this.term.write('^C\n');
        this._pushFrame(new SyncCmdFrame('', [], null));
        this.tick();
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

        const top = this.cmdStack[this.cmdStack.length - 1];

        if (top) {
            if (top.handleInput) {
                const handled = top.handleInput(data);
                if (top.done) this.tick();
                if (handled) return;
            }
            if (this.readLineState) {
                this._handleReadLineInput(data);
                return;
            }
            if (top.blocked) {
                this._checkCtrlC(data);
                return;
            }
            this.tick();
            return;
        }

        if (this.typewriter.isActive()) {
            this._checkCtrlC(data);
            return;
        }
        if (this.readLineState) {
            this._handleReadLineInput(data);
            return;
        }
        this.editor.handleKey(data);
    }

    pushDialogFrame(dlg) {
        const frame = new DialogFrame(dlg);
        frame._saveCursor();
        dlg.open();
        frame.started = true;
        this._pushFrame(frame);
        this.tick();
    }

    flushQueuedInput() {
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
        this.dialogRestoreHooks.push(fn);
    }

    removeDialogRestoreHook(fn) {
        const i = this.dialogRestoreHooks.indexOf(fn);
        if (i >= 0) this.dialogRestoreHooks.splice(i, 1);
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

    createDialog(DialogClass, key, opts, ...ctorArgs) {
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
        const menuDlg = this.createDialog(MenuDialog, 'menu', {
            width: 44,
            title: 'Command Menu',
            footer: '↑↓ Move  PgUp/Dn Page  ↩ Run  ESC Quit',
            visibleCount: 5,
            onSelect: (item) => {
                const inst = this._cmdInstances[item.name];
                if (inst && inst.constructor.openMenuDialog) {
                    inst.constructor.openMenuDialog();
                    return;
                }
                this._pushFrame(new SyncCmdFrame(item.name, [], inst));
                this.menuDialog = null;
                return 'close';
            },
            onCancel: () => {}
        }, this.menuItems);
        this.menuDialog = menuDlg;
    }

}

export class WidgetManager {
    constructor() {
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
        system.removeDialogRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
    }
}
