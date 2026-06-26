export class CmdFrame {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this.done = false;
        this.started = false;
    }

    get label() { return this.constructor.name; }

    start() {}
    get blocked() { return false; }
    handleInput(data) { return false; }

    finish() {
        if (this.done) return;
        this.done = true;
    }
}

export class SyncCmdFrame extends CmdFrame {
    constructor(shell, cmdName, args, cmd) {
        super(shell);
        this.cmdName = cmdName;
        this.args = args;
        this.cmd = cmd;
        this._asyncPending = false;
    }

    get label() { return this.cmdName; }

    start() {
        const handler = this.shell.commands[this.cmdName];
        if (handler) {
            const result = handler(this.args);
            if (result instanceof Promise) {
                this._asyncPending = true;
                result.then(() => {
                    this._asyncPending = false;
                    if (!this.done) this.shell._tick();
                });
                return;
            }
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
        return (this.cmd && !this.cmd.closed) || this._asyncPending || this.shell.typewriter.isActive() || this.shell._busy;
    }
}

export class DialogFrame extends CmdFrame {
    constructor(shell, dialog) {
        super(shell);
        this.dialog = dialog;
    }

    get label() {
        const d = this.dialog;
        const ctor = d.constructor;
        const name = ctor && ctor.name;
        if (ctor && ctor.commandName) return 'cmd:' + ctor.commandName;
        return 'dialog:' + (name || '?');
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
