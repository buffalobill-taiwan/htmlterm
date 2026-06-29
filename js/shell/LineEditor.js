/**
 * LineEditor — command line editing backed by TextInputModel.
 *
 * Owns terminal output only: _redraw(), cursor escape sequences,
 * history management, and tab completion display.
 */
import { TextInputModel, parseCSI } from './TextInputModel.js';

export class LineEditor {
    constructor(term, callbacks = {}) {
        this.term = term;
        this._onExecute    = callbacks.onExecute    || (() => {});
        this._onShowPrompt = callbacks.onShowPrompt || (() => {});

        this._model   = new TextInputModel();
        this.history  = [];
        this.historyPos  = -1;
        this._savedLine  = null;

        this._commands = [];
        this._prompt   = '$ ';
    }

    setCommands(names) { this._commands = names; }
    setPrompt(text)    { this._prompt = text; }

    get line() { return this._model.value; }

    reset() {
        this._model.reset();
        this.historyPos = -1;
        this._savedLine = null;
    }

    // ── Rendering ─────────────────────────────────────────────────────────────

    _redraw() {
        const after = this._model.widthRange(this._model.cursor, this._model.length);
        this.term.write(
            '\r' + this._prompt +
            this._model.value +
            '\x1B[K' +
            (after > 0 ? `\x1B[${after}D` : '')
        );
    }

    // ── History ───────────────────────────────────────────────────────────────

    _loadHistory(idx) {
        this._model.set(idx === -1 ? (this._savedLine || '') : this.history[idx]);
        this._redraw();
    }

    _historyUp() {
        if (this.history.length === 0) return;
        if (this.historyPos === -1) {
            this._savedLine = this._model.value;
            this.historyPos = this.history.length - 1;
        } else if (this.historyPos > 0) {
            this.historyPos--;
        } else return;
        this._loadHistory(this.historyPos);
    }

    _historyDown() {
        if (this.historyPos === -1) return;
        this.historyPos++;
        if (this.historyPos >= this.history.length) this.historyPos = -1;
        this._loadHistory(this.historyPos);
    }

    // ── Tab completion ────────────────────────────────────────────────────────

    _handleTab() {
        const prefix  = this._model.value;
        const matches = this._commands.filter(c => c.startsWith(prefix));
        if (matches.length === 0) return;

        const common = _commonPrefix(matches);
        if (common.length > prefix.length) {
            const rest = common.slice(prefix.length);
            this._model.insert(rest);
            this.term.write(rest);
            return;
        }
        // Already at common prefix — show candidates
        this.term.write('\r\n' + matches.join('  ') + '\n');
        this.term.write(this._prompt + this._model.value);
        const after = this._model.widthRange(this._model.cursor, this._model.length);
        if (after > 0) this.term.write(`\x1B[${after}D`);
    }

    // ── Key handler ───────────────────────────────────────────────────────────

    handleKey(data) {
        let consumed = false;
        let i = 0;
        while (i < data.length) {
            const ch   = data[i];
            const code = ch.charCodeAt(0);

            if (code === 0x03) {                          // Ctrl+C
                this.term.write('^C\n');
                this._model.reset();
                this._onShowPrompt();
                consumed = true; i++; continue;
            }
            if (code === 0x04) {                          // Ctrl+D
                if (this._model.length === 0) {
                    this.term.write('exit\n');
                    this._onShowPrompt();
                }
                consumed = true; i++; continue;
            }
            if (code === 0x0C) {                          // Ctrl+L
                this.term.write('\x1B[2J\x1B[H');
                this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x0D || code === 0x0A) {         // Enter
                this.term.write('\r\n');
                const line = this._model.value;
                this._model.reset();
                this.historyPos = -1;
                this._savedLine = null;
                this._onExecute(line);
                consumed = true; i++; continue;
            }
            if (code === 0x7F || code === 0x08) {         // Backspace
                if (this._model.backspace() !== 'none') this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x09) {                          // Tab
                this._handleTab();
                consumed = true; i++; continue;
            }
            if (code === 0x01) {                          // Ctrl+A
                if (this._model.moveHome() !== 'none') this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x05) {                          // Ctrl+E
                if (this._model.moveEnd() !== 'none') this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x15) {                          // Ctrl+U
                if (this._model.deleteToStart() !== 'none') this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x0B) {                          // Ctrl+K
                if (this._model.deleteToEnd() !== 'none') this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x17) {                          // Ctrl+W
                if (this._model.deleteWordBefore() !== 'none') this._redraw();
                consumed = true; i++; continue;
            }
            if (code === 0x1B) {                          // Escape sequence
                const csi = parseCSI(data.slice(i));
                if (csi) {
                    this._handleCSIFinal(csi.final, csi.params);
                    i += csi.consumed;
                } else {
                    i += 2; // lone ESC or unknown
                }
                consumed = true; continue;
            }
            if (code >= 0x20) {                           // Printable
                const cp = data.codePointAt(i);
                const c  = String.fromCodePoint(cp);
                this._model.insert(c);
                if (this._model.cursor === this._model.length) {
                    this.term.write(c);                   // fast path: at end
                } else {
                    this._redraw();
                }
                i += cp > 0xFFFF ? 2 : 1;
                consumed = true; continue;
            }
            i++;
        }
        return consumed;
    }

    _handleCSIFinal(final, params) {
        const m = this._model;
        switch (final) {
            case 'A': this._historyUp();   break;
            case 'B': this._historyDown(); break;
            case 'C': { const w = m.charWidth(m.cursor); if (m.moveRight() !== 'none') this.term.write(`\x1B[${w}C`); break; }
            case 'D': { const w = m.charWidth(m.cursor - 1); if (m.moveLeft()  !== 'none') this.term.write(`\x1B[${w}D`); break; }
            case 'H': if (m.moveHome() !== 'none') this._redraw(); break;
            case 'F': if (m.moveEnd()  !== 'none') this._redraw(); break;
            case '~':
                if (params === '1' || params === '7') { if (m.moveHome()      !== 'none') this._redraw(); }
                else if (params === '4' || params === '8') { if (m.moveEnd()  !== 'none') this._redraw(); }
                else if (params === '3')              { if (m.deleteForward() !== 'none') this._redraw(); }
                break;
        }
    }
}

function _commonPrefix(strs) {
    if (!strs.length) return '';
    let p = strs[0];
    for (let i = 1; i < strs.length; i++) while (!strs[i].startsWith(p)) p = p.slice(0, -1);
    return p;
}
