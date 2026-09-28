import { CURSOR_HIDE, CURSOR_SHOW } from '../util/sgr.js';
import { system, term } from './sys.js';

export class CmdFrame {
    constructor() {
        this.done = false;
        this.started = false;
        this._cleanups = new Set();
    }

    get label() { return this.constructor.name; }

    get persistent() { return false; }
    onActivate() {}

    start() {}
    get blocked() { return false; }
    handleInput(data) { return false; }

    addCleanup(fn) {
        if (this.done) { fn(); return () => {}; }
        this._cleanups.add(fn);
        return () => this._cleanups.delete(fn);
    }

    cancel() { this.finish(); }

    finish() {
        if (this.done) return;
        this.done = true;
        for (const fn of this._cleanups) {
            try { fn(); } catch (err) { console.error(err); }
        }
        this._cleanups.clear();
    }
}

export class SyncCmdFrame extends CmdFrame {
    constructor(cmdName, args, cmd) {
        super();
        this.cmdName = cmdName;
        this.args = args;
        this.cmd = cmd;
        this._asyncPending = false;
    }

    get label() { return this.cmdName; }

    start() {
        try {
            const handler = system.commands[this.cmdName];
            if (handler) {
                const result = handler(this.args);
                if (result && typeof result.then === 'function') {
                    this._asyncPending = true;
                    Promise.resolve(result).then(() => {
                        this._asyncPending = false;
                        if (!this.done) system.tick();
                    }, err => {
                        this._asyncPending = false;
                        if (!this.done) system.failFrame(this, err);
                    });
                    return;
                }
            } else if (this.cmdName) {
                system.print('\x1B[31mCommand not found: ' + this.cmdName + '\x1B[0m\n');
                system.print('Try \x1B[33mhelp\x1B[0m.\n');
            }
            if (!this.blocked) this.finish();
        } catch (err) {
            system.failFrame(this, err);
        }
    }

    cancel() {
        if (this.done) return;
        this._asyncPending = false;
        try {
            if (this.cmd) this.cmd.onCancel();
        } finally {
            if (this.cmd) {
                this.cmd.closed = true;
                this.cmd._awaitingTypewriterDrain = false;
                this.cmd._selectState = null;
            }
            this.finish();
        }
    }

    handleInput(data) {
        if (system.readLineState) return false;
        if (this.cmd && !this.cmd.closed && typeof this.cmd.handleKey === 'function') {
            this.cmd.handleKey(data);
            if (!this.blocked) this.finish();
            return true;
        }
        return false;
    }

    get blocked() {
        if (!this.started || this.done) return false;
        return (this.cmd && !this.cmd.closed) || this._asyncPending || system.typewriter.isActive() || system.busy;
    }
}

export class DialogFrame extends CmdFrame {
    constructor(dialog) {
        super();
        this.dialog = dialog;
        this._savedCursor = null;
        this._afterClose = null;
    }

    get label() {
        const d = this.dialog;
        const ctor = d.constructor;
        const name = ctor && ctor.name;
        if (ctor && ctor.commandName) return 'cmd:' + ctor.commandName;
        return 'dialog:' + (name || '?');
    }

    _saveCursor() {
        this._savedCursor = {
            x: term.curX,
            y: term.curY,
            cursorHidden: term.cursorHidden,
        };
        term.cursorHidden = true;
        term.write(CURSOR_HIDE);
    }

    finish() {
        if (this.done) return;
        this.dialog.close();
        if (this._savedCursor) {
            const s = this._savedCursor;
            term.cursorHidden = s.cursorHidden;
            term.write(s.cursorHidden ? CURSOR_HIDE : CURSOR_SHOW);
            term.curX = s.x;
            term.curY = s.y;
        }
        for (const fn of (system.dialogRestoreHooks || [])) fn();
        super.finish();
    }

    handleInput(data) {
        if (this.done) return true;
        this.dialog.handleKey(data);
        if (this.dialog.closed) {
            this._afterClose = this.dialog._completion;
            this.dialog._completion = null;
            this.finish();
        }
        return true;
    }

    onPop() {
        const callback = this._afterClose;
        this._afterClose = null;
        callback?.();
    }

    cancel() {
        this._afterClose = null;
        this.dialog._completion = null;
        this.finish();
    }

    get blocked() {
        return !this.dialog.closed;
    }
}

export class ShellFrame extends CmdFrame {
    constructor(cmd) {
        super();
        this.cmd = cmd;
        this._pendingActivate = true;
    }

    get persistent() { return true; }

    get label() {
        const ctor = this.cmd && this.cmd.constructor;
        return (ctor && ctor.commandName) || 'shell';
    }

    start() {
        this.cmd.start();
    }

    handleInput(data) {
        if (system.readLineState) return false;
        this.cmd.handleKey(data);
        return true;
    }

    onActivate() {
        this.cmd.showPrompt();
    }
}
