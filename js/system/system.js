import { Typewriter } from './typewriter.js';
import { LineEditor } from './LineEditor.js';
import { tokenize } from '../util/tokenize.js';
import { ShellCmd } from '../cmd/ShellCmd.js';
import { ShellFrame, SyncCmdFrame, DialogFrame } from './CmdFrame.js';
import { getSystem, setSystem } from './sys.js';
import { CommandRegistry } from './CommandRegistry.js';
import { WidgetManager } from './WidgetManager.js';
export { WidgetManager } from './WidgetManager.js';
import { bold, green, yellow, gray, warn, CURSOR_SHOW } from '../util/sgr.js';
import { MenuDialog } from '../dialog/MenuDialog.js';

export class SystemManager {
    static get instance() { return getSystem(); }
    static set instance(value) { setSystem(value); }

    constructor(term, cmdModule) {
        SystemManager.instance = this;
        this.term = term;
        this._disposed = false;

        this.cmdStack = [];
        this._tickQueued = false;
        this._queuedInput = [];
        this._busyDepth = 0;
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

        const registry = new CommandRegistry(cmdModule);
        this.cmdList = registry.cmdList;
        this.menuItems = registry.menuItems;
        this.commands = registry.commands;
        this._cmdInstances = registry.instances;
        this.prompt = '$ ';
        this.running = false;

        this.dialogRestoreHooks = [];
        this._dialogPositions = {};

        this.widgetManager = new WidgetManager(this);
        this._dragTarget = null;
        this.menuDialog = null;

        this.editor.setCommands(Object.keys(this.commands));
        this.editor.setPrompt(this.prompt);
        this.start();
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

    get busy() { return this._busyDepth > 0; }
    get abortEpoch() { return this._abortEpoch; }

    // Counted, not boolean: animations and flash effects nest, and a single
    // release() from an inner effect used to unblock input the outer one still owned.
    holdBusy() { this._busyDepth++; }
    releaseBusy() {
        if (this._busyDepth > 0) this._busyDepth--;
        if (this._busyDepth === 0 && !this._disposed) this.tick();
    }

    print(text) {
        if (this._disposed) return;
        this.typewriter.enqueue(text);
    }

    tick() {
        if (this._disposed) return;
        if (this._tickQueued) return;
        this._tickQueued = true;
        Promise.resolve().then(() => {
            this._tickQueued = false;
            if (this._disposed) return;
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
        // Typed-ahead input is queued while output streams. A frame blocked on
        // readLine() never re-enters the flush path by itself, so deliver here.
        if (this.readLineState && this._queuedInput.length > 0 &&
            !this.typewriter.isActive() && this._busyDepth === 0) {
            this.flushQueuedInput();
        }
        while (true) {
            while (this.cmdStack.length > 0 && this.cmdStack[this.cmdStack.length - 1].done) {
                const finished = this.cmdStack.pop();
                finished.onPop?.();
                for (const fn of this._framePopHooks.slice()) fn();
                if (this.cmdStack.length > 0 && this.cmdStack[this.cmdStack.length - 1].persistent) {
                    this.cmdStack[this.cmdStack.length - 1]._pendingActivate = true;
                }
            }

            if (this.cmdStack.length === 0) {
                return;
            }

            const frame = this.cmdStack[this.cmdStack.length - 1];

            try {
                if (!frame.started) {
                    frame.started = true;
                    frame.start();
                    continue;
                }

                if (frame.blocked) return;

                if (frame.persistent) {
                    if (frame._pendingActivate) {
                        if (this.typewriter.isActive() || this._busyDepth > 0 || this.readLineState) return;
                        frame.onActivate();
                        frame._pendingActivate = false;
                        this.flushQueuedInput();
                    }
                    return;
                }

                frame.finish();
            } catch (err) {
                this.failFrame(frame, err);
            }
        }
    }

    execCmd(line) {
        if (this._disposed) return;
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
        if (this._disposed) return;
        if (this.readLineState) {
            warn('readLine called while another readLine is pending — overwriting');
        }
        const editor = new LineEditor(this.term, {
            echoCtrlC: false,
            onExecute: (line) => {
                this.readLineState = null;
                callback(line.trim());
                this.tick();
            },
            onShowPrompt: () => {
                // Cancel the owning command too, settling its pending input promise.
                this._abortAll();
            },
        });
        editor.setPrompt('');
        this.readLineState = { editor };
        if (!this.typewriter.isActive()) this.flushQueuedInput();
    }

    _handleReadLineInput(data) {
        const editor = this.readLineState.editor;
        editor.handleKey(data);
        this.requeueRest(editor);
    }

    // Text after Enter must re-enter the queue: the command it starts may want it.
    requeueRest(editor) {
        const rest = editor.takeRest();
        if (rest) this._queuedInput.unshift(rest);
    }

    getCommandFrame(cmd) {
        return this.cmdStack.slice().reverse().find(f => f.cmd === cmd);
    }

    addCommandCleanup(cmd, fn) {
        const frame = this.getCommandFrame(cmd);
        if (!frame) throw new Error('No active command frame');
        return frame.addCleanup(fn);
    }

    _cancelFrames(fromIndex) {
        this._abortEpoch++;
        this._busyDepth = 0;
        this._queuedInput = [];
        this.readLineState = null;
        this._dragTarget = null;
        this.typewriter.cancel();
        for (let i = this.cmdStack.length - 1; i >= fromIndex; i--) {
            try { this.cmdStack[i].cancel(); } catch (err) { console.error(err); }
        }
    }

    failFrame(frame, err) {
        const index = this.cmdStack.indexOf(frame);
        if (index < 0 || frame.done || this._disposed) return;
        this._cancelFrames(index);
        this.print('\x1B[31mError: ' + String(err) + '\x1B[0m\n');
        this.tick();
    }

    _abortAll() {
        this._cancelFrames(1);
        this.term.write('^C\n');
        const shell = this.cmdStack[0];
        if (shell) shell._pendingActivate = true;
        this.tick();
    }

    _checkCtrlC(data) {
        for (let i = 0; i < data.length; i++) {
            const code = data.charCodeAt(i);
            if (code === 0x03) {
                this._abortAll();
                return;
            }
        }
        this._queuedInput.push(data);
    }

    handleInput(data) {
        if (!this.running || this._disposed) return;

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
        this.requeueRest(this.editor);
    }

    closeDialog(dialog) {
        const frame = this.cmdStack.find(f => f.dialog === dialog);
        if (!frame || frame.done || this._disposed) return;
        frame.finish();
        this.tick();
    }

    replaceDialog(dialog, DialogClass, key, opts, ...ctorArgs) {
        const frame = this.cmdStack.find(f => f.dialog === dialog);
        if (!frame || frame.done || this._disposed) return null;
        frame.finish();
        return this.createDialog(DialogClass, key, opts, ...ctorArgs);
    }

    pushDialogFrame(dlg) {
        if (this._disposed) {
            dlg.close();
            return;
        }
        const frame = new DialogFrame(dlg);
        frame._saveCursor();
        dlg.open();
        frame.started = true;
        this._pushFrame(frame);
        this.tick();
    }

    flushQueuedInput() {
        if (this._flushingInput) return;
        this._flushingInput = true;
        try {
            const batch = this._queuedInput;
            this._queuedInput = [];
            for (let i = 0; i < batch.length; i++) {
                if (this.typewriter.isActive()) {
                    // Anything typed while draining goes after this backlog, not
                    // before it: put the remainder back in front.
                    this._queuedInput = batch.slice(i).concat(this._queuedInput);
                    return;
                }
                this.handleInput(batch[i]);
            }
        } finally {
            this._flushingInput = false;
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
        if (this._disposed) return false;
        if (type === 'mousedown') {
            const ovs = this.term.overlays;
            for (let i = ovs.length - 1; i >= 0; i--) {
                const ov = ovs[i];
                if (ov.owner?._peekHeld) continue;
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
            const target = this._dragTarget;
            this._dragTarget = null;
            try { target.endDrag(); } catch (err) { console.error(err); }
            return true;
        }

        return false;
    }

    handleKeyUp(key) {
        if (this._disposed) return;
        const top = this.cmdStack[this.cmdStack.length - 1];
        const target = top?.dialog || top?.cmd;
        target?.handleKeyUp?.(key);
    }

    /**
     * Construct a dialog and push it on the DialogFrame stack.
     * Prefer this (or CmdBase.openDialog) over calling dialog.open() directly so
     * input routing and overlay teardown stay with DialogFrame.
     * @param {Function} DialogClass
     * @param {string|null} key - Position-persistence key, or null to skip
     * @param {object} opts - Dialog options (merged last before saved x/y)
     * @param {...any} ctorArgs - Extra constructor args before opts
     */
    createDialog(DialogClass, key, opts, ...ctorArgs) {
        if (this._disposed) return null;
        const dlgOpts = { ...(opts || {}) };
        if (key != null) {
            const pos = this._dialogPositions[key] || {};
            if (pos.x != null) dlgOpts.x = pos.x;
            if (pos.y != null) dlgOpts.y = pos.y;
            dlgOpts.savePos = (x, y) => { this._dialogPositions[key] = { x, y }; };
        }
        const dlg = new DialogClass(this.term, ...ctorArgs, dlgOpts);
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
            onCancel: () => { this.menuDialog = null; }
        }, this.menuItems);
        this.menuDialog = menuDlg;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this.running = false;
        this._abortEpoch++;
        this._busyDepth = 0;
        this._queuedInput = [];
        this.readLineState = null;
        this._dragTarget = null;

        this._cancelFrames(1);

        this.typewriter.dispose();
        this.term.cursorHidden = false;
        this.term.write(CURSOR_SHOW);
        this.widgetManager.destroy();
        for (const overlay of this.term.overlays.slice()) {
            this.term.removeOverlay(overlay);
        }
        this.cmdStack = [];
        this._framePopHooks = [];
        this.dialogRestoreHooks = [];
        this.menuDialog = null;

        if (SystemManager.instance === this) SystemManager.instance = null;
    }

}
