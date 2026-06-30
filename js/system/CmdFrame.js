import { CURSOR_HIDE, CURSOR_SHOW } from '../util/sgr.js';
import { SystemManager } from './system.js';

export class CmdFrame {
    constructor() {
        this.system = SystemManager.instance;
        this.term = this.system.term;
        this.done = false;
        this.started = false;
    }

    get label() { return this.constructor.name; }

    get persistent() { return false; }
    onActivate() {}

    start() {}
    get blocked() { return false; }
    handleInput(data) { return false; }

    finish() {
        if (this.done) return;
        this.done = true;
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
        const handler = this.system.commands[this.cmdName];
        if (handler) {
            const result = handler(this.args);
            if (result instanceof Promise) {
                this._asyncPending = true;
                result.then(() => {
                    this._asyncPending = false;
                    if (!this.done) this.system._tick();
                });
                return;
            }
        } else {
            this.system.print('\x1B[31mCommand not found: ' + this.cmdName + '\x1B[0m\n');
            this.system.print('Try \x1B[33mhelp\x1B[0m.\n');
        }
        if (!this.blocked) this.finish();
    }

    handleInput(data) {
        if (this.cmd && !this.cmd.closed && typeof this.cmd.handleKey === 'function') {
            this.cmd.handleKey(data);
            if (this.cmd.closed) this.finish();
            return true;
        }
        return false;
    }

    get blocked() {
        if (!this.started || this.done) return false;
        return (this.cmd && !this.cmd.closed) || this._asyncPending || this.system.typewriter.isActive() || this.system.busy;
    }
}

export class DialogFrame extends CmdFrame {
    constructor(dialog) {
        super();
        this.dialog = dialog;
        this._savedCursor = null;
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
            x: this.term.curX,
            y: this.term.curY,
            cursorHidden: this.term.cursorHidden,
        };
        this.term.cursorHidden = true;
        this.term.write(CURSOR_HIDE);
    }

    finish() {
        if (this.done) return;
        if (this._savedCursor) {
            const s = this._savedCursor;
            this.term.cursorHidden = s.cursorHidden;
            this.term.write(s.cursorHidden ? CURSOR_HIDE : CURSOR_SHOW);
            this.term.curX = s.x;
            this.term.curY = s.y;
        }
        for (const fn of (this.system._dialogRestoreHooks || [])) fn();
        super.finish();
    }

    handleInput(data) {
        this.dialog.handleKey(data);
        if (this.dialog.closed) this.finish();
        return true;
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
        if (this.system._readLineState) return false;
        this.cmd.handleKey(data);
        return true;
    }

    onActivate() {
        this.cmd.showPrompt();
    }
}
