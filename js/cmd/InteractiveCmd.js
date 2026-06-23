import { CmdBase } from './CmdBase.js';
import { red } from '../sgr.js';

export class InteractiveCmd extends CmdBase {
    constructor(shell) {
        super(shell);
        this.closed = true;
        this.isTyping = false;
        this.inHandleKey = false;
        this._cbSession = 0;
    }

    open() {
        this.closed = false;
        this.shell.activeDialog = this;
        this.term.write('\x1B[?25l');
    }

    close() {
        this.closed = true;
        this.term.write('\x1B[?25h');
        if (!this.inHandleKey) {
            if (this.shell.activeDialog === this) {
                this.shell.activeDialog = null;
            }
            this.shell._schedulePrompt();
        }
    }

    onCancel() {
        this.close();
    }

    printThen(text, callback) {
        this._cbSession++;
        const session = this._cbSession;
        this.print(text);
        const cb = () => {
            this.shell.typewriter.removeOnDrain(cb);
            if (this.closed || session !== this._cbSession) return;
            callback();
        };
        this.shell.typewriter.onDrain(cb);
    }

    handleKey(data) {
        if (this.closed) return;
        this.inHandleKey = true;
        try {
            this._handleKey(data);
        } finally {
            this.inHandleKey = false;
        }
    }

    _handleKey(data) {
        if (data.charCodeAt(0) === 0x03) {
            if (this.shell.typewriter.isActive()) {
                this.shell.typewriter.dispose();
            }
            this.onCancel();
            return;
        }
        if (this.isTyping) {
            if (this.shell.typewriter.isActive()) {
                this.shell.typewriter.abort();
            }
            return;
        }
        this._onKey(data);
    }

    _onKey(data) {}

    ask(text, options, render, onPick) {
        if (typeof render === 'function' && !onPick) {
            onPick = render;
            render = null;
        }
        this.isTyping = true;
        this._askOptions = options;
        this._askRender = render || defaultOptionRender;
        this._askOnPick = onPick;
        this._askSelected = 0;
        this._askScrollOffset = 0;

        this.printThen(text, () => {
            this.isTyping = false;
            this._drawAsk();
        });
    }

    _drawAsk() {
        this._askRender(this._askSelected, this._askOptions, this._askScrollOffset, this.term);
    }

    prompt(text, onInput) {
        this.isTyping = true;
        this.printThen(text, () => {
            this.isTyping = false;
            this.shell.readLine(onInput);
        });
    }
}

function defaultOptionRender(selected, options, scrollOffset, term) {
    const h = 5;
    const start = Math.max(0, Math.min(scrollOffset, options.length - h));
    const end = Math.min(start + h, options.length);
    for (let i = start; i < end; i++) {
        const prefix = i === selected ? '\x1B[7m ▶ ' : '   ';
        const suffix = i === selected ? '\x1B[0m' : '';
        term.write('\r\n' + prefix + options[i] + suffix);
    }
}
