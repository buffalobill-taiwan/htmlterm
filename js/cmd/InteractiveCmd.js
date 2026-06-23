import { CmdBase } from './CmdBase.js';
import { green, bold } from '../sgr.js';

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
            this._selectState = null;
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
        if (this._selectState) {
            this._handleSelectKey(data);
            return;
        }
        this._onKey(data);
    }

    _onKey(data) {}

    select(opts) {
        let rendered = false;
        const defaultRender = (r, c, options, term) => {
            const rows = options.length;
            let s = '';
            if (rendered && rows > 1) {
                s += '\x1B[' + (rows - 1) + 'A';
            }
            const numCols = Math.max(...options.map(row => row.length));
            const colWidths = [];
            for (let ci = 0; ci < numCols; ci++) {
                let maxW = 0;
                for (const row of options) {
                    if (ci < row.length) {
                        maxW = Math.max(maxW, _displayWidth(row[ci]));
                    }
                }
                colWidths.push(maxW);
            }
            for (let ri = 0; ri < rows; ri++) {
                if (ri > 0) s += '\r\n';
                s += '\r\x1B[K';
                for (let ci = 0; ci < options[ri].length; ci++) {
                    const name = options[ri][ci];
                    const isSel = ri === r && ci === c;
                    const prefix = isSel ? bold(green('▶ ')) : '  ';
                    const padded = name + ' '.repeat(colWidths[ci] - _displayWidth(name) + 2);
                    s += prefix + padded;
                }
            }
            term.write(s);
        };

        this._selectState = {
            options: opts.options,
            move: opts.move || _defaultGridMove,
            render: opts.render || defaultRender,
            onPick: opts.onPick,
            onCancel: opts.onCancel || null,
            term: this.term,
            selRow: 0,
            selCol: 0,
        };

        this.isTyping = true;
        this.printThen(opts.text || '', () => {
            this.isTyping = false;
            this.term.write('\x1B[?25l');
            const ss = this._selectState;
            ss.render(ss.selRow, ss.selCol, ss.options, ss.term);
            rendered = true;
        });
    }

    _handleSelectKey(data) {
        const ss = this._selectState;
        if (data.length === 1 && data.charCodeAt(0) === 0x1B) {
            this._selectState = null;
            (ss.onCancel || this.onCancel).call(this);
            return;
        }
        const code = data.charCodeAt(0);
        if (code === 0x0D || code === 0x0A) {
            this._selectState = null;
            const value = ss.options[ss.selRow][ss.selCol];
            ss.onPick(ss.selRow, ss.selCol, value);
            return;
        }
        const result = ss.move(data, ss.selRow, ss.selCol, ss.options);
        if (result.row !== ss.selRow || result.col !== ss.selCol) {
            ss.selRow = result.row;
            ss.selCol = result.col;
            ss.render(ss.selRow, ss.selCol, ss.options, ss.term);
        }
    }

    prompt(text, onInput) {
        this.isTyping = true;
        this.printThen(text, () => {
            this.isTyping = false;
            this.shell.readLine(onInput);
        });
    }
}

function _defaultGridMove(data, row, col, options) {
    if (data === '\x1B[A') {
        if (row === 0) return { row, col };
        const prev = options[row - 1];
        return { row: row - 1, col: Math.min(col, prev.length - 1) };
    }
    if (data === '\x1B[B') {
        if (row === options.length - 1) return { row, col };
        const next = options[row + 1];
        return { row: row + 1, col: Math.min(col, next.length - 1) };
    }
    if (data === '\x1B[D') {
        if (col === 0) return { row, col };
        return { row, col: col - 1 };
    }
    if (data === '\x1B[C') {
        const cur = options[row];
        if (col === cur.length - 1) return { row, col };
        return { row, col: col + 1 };
    }
    return { row, col };
}

function _displayWidth(s) {
    let w = 0;
    for (const ch of s) {
        w += ch.codePointAt(0) > 0x2E7F ? 2 : 1;
    }
    return w;
}
