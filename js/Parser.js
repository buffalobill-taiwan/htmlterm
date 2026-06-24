/**
 * Parser — VT100/ANSI escape sequence parser.
 *
 * State machine processes raw bytes and delegates buffer mutations to Screen.
 * Emits `send(data)` for DSR responses and similar outbound control sequences.
 */

export class Parser {
    constructor(screen, callbacks = {}) {
        this.screen = screen;
        this._send = callbacks.onSend || (() => {});

        this._state = 'ground';
        this._buf = '';
        this._privateMarker = '';
        this._oscString = '';
    }

    /**
     * Write string or byte data into the parser.
     * @param {string|number[]} data
     */
    write(data) {
        if (!data) return;
        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            if (this._state === 'escape') {
                this._processEscape(ch);
                continue;
            }
            if (this._state === 'csi') {
                this._buf += ch;
                const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
                if (code >= 0x40 && code <= 0x7E) {
                    this._processCSI(this._buf);
                    this._buf = '';
                    this._state = 'ground';
                }
                continue;
            }
            if (this._state === 'osc') {
                if (ch === '\x07' || (ch === '\x1B' && data[i + 1] === '\\')) {
                    if (ch === '\x1B') i++;
                    this._oscString = '';
                    this._state = 'ground';
                } else {
                    this._oscString += ch;
                }
                continue;
            }
            if (this._state === 'dcs' || this._state === 'sos' || this._state === 'pm' || this._state === 'apc') {
                if (ch === '\x07' || (ch === '\x1B' && data[i + 1] === '\\')) {
                    if (ch === '\x1B') i++;
                    this._state = 'ground';
                }
                continue;
            }

            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
            if (code === 0x1B) {
                this._state = 'escape';
                this._buf = '';
                this._privateMarker = '';
                continue;
            }
            if (code === 0x0D) { this.screen.carriageReturn(); continue; }
            if (code === 0x0A) { this.screen.carriageReturn(); this.screen.lineFeed(); continue; }
            if (code === 0x08) { this.screen.backspace(); continue; }
            if (code === 0x09) { this.screen.tab(); continue; }
            if (code === 0x07) { continue; }
            if (code === 0x0B || code === 0x0C) { this.screen.lineFeed(); continue; }
            if (code < 0x20) continue;

            this.screen.writeChar(ch);
        }
    }

    _processEscape(ch) {
        const screen = this.screen;
        const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
        if (code === 0x5B) { this._state = 'csi'; this._buf = ''; return; }
        if (code === 0x5D) { this._state = 'osc'; this._oscString = ''; return; }
        if (code === 0x50) { this._state = 'dcs'; return; }
        if (code === 0x58) { this._state = 'sos'; return; }
        if (code === 0x5E) { this._state = 'pm'; return; }
        if (code === 0x5F) { this._state = 'apc'; return; }
        if (code === 0x4E || code === 0x4F) { this._state = 'ground'; return; }
        if (code === 0x44) { screen.lineFeed(); this._state = 'ground'; return; }
        if (code === 0x45) { screen.lineFeed(); screen.carriageReturn(); this._state = 'ground'; return; }
        if (code === 0x37) { screen.savedX = screen.curX; screen.savedY = screen.curY; this._state = 'ground'; return; }
        if (code === 0x38) { if (screen.savedX >= 0) { screen.curX = screen.savedX; screen.curY = screen.savedY; screen.markRowDirty(screen.curY); } this._state = 'ground'; return; }
        if (code === 0x48) { this._state = 'ground'; return; }
        if (code === 0x4D) { screen.reverseIndex(); this._state = 'ground'; return; }
        if (code === 0x5C) { this._state = 'ground'; return; }
        if (code >= 0x40 && code <= 0x5F) { this._state = 'ground'; return; }
        this._state = 'ground';
    }

    _processCSI(buf) {
        let privateMarker = '';
        let n = '';
        for (let i = 0; i < buf.length; i++) {
            const ch = buf[i];
            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
            if (code >= 0x40 && code <= 0x7E) {
                if (n && (n[0] === '?' || n[0] === '>' || n[0] === '!' || n[0] === '<' || n[0] === "'")) {
                    privateMarker = n[0];
                    n = n.substring(1);
                }
                const parts = n ? n.split(';').map(Number) : [];
                this._dispatchCSI(privateMarker, parts, ch);
                return;
            }
            n += ch;
        }
    }

    _dispatchCSI(privateMarker, params, finalByte) {
        const screen = this.screen;

        if (privateMarker === '?') {
            this._privateCSI(params, finalByte);
            return;
        }
        if (privateMarker === '>') return;

        const p0 = params[0] || 0;
        const p1 = params[1] || 0;

        switch (finalByte) {
            case 'A': screen.cursorUp(Math.max(1, p0)); break;
            case 'B': screen.cursorDown(Math.max(1, p0)); break;
            case 'C': screen.cursorForward(Math.max(1, p0)); break;
            case 'D': screen.cursorBack(Math.max(1, p0)); break;
            case 'E': screen.cursorDown(Math.max(1, p0)); screen.curX = 0; break;
            case 'F': screen.cursorUp(Math.max(1, p0)); screen.curX = 0; break;
            case 'G': screen.curX = Math.max(0, Math.min(screen.cols - 1, (p0 || 1) - 1)); break;
            case 'H': case 'f': screen.cursorPos(p0 || 1, p1 || 1); break;
            case 'J': screen.eraseDisplay(p0); break;
            case 'K': screen.eraseLine(p0); break;
            case 'L': screen.insertLines(Math.max(1, p0)); break;
            case 'M': screen.deleteLines(Math.max(1, p0)); break;
            case 'P': screen.deleteChars(Math.max(1, p0)); break;
            case '@': screen.insertChars(Math.max(1, p0)); break;
            case 'X': screen.eraseChars(Math.max(1, p0)); break;
            case 'd': screen.rowPos(p0 || 1); break;
            case 'S': screen._scrollUp(Math.max(1, p0)); break;
            case 'T': screen._scrollDown(Math.max(1, p0)); break;
            case 'm': screen.setSGR(params); break;
            case 's': screen.savedX = screen.curX; screen.savedY = screen.curY; break;
            case 'u': if (screen.savedX >= 0) { screen.curX = screen.savedX; screen.curY = screen.savedY; screen.markRowDirty(screen.curY); } break;
            case 'h': this._setMode(params); break;
            case 'l': this._resetMode(params); break;
            case 'n': this._deviceStatusReport(p0); break;
            case 'r': {
                const top = Math.max(0, (params[0] || 1) - 1);
                const bot = Math.min(screen.rows - 1, (params[1] || screen.rows) - 1);
                if (top < bot) {
                    screen.scrollTop = top;
                    screen.scrollBottom = bot;
                    screen.curX = 0;
                    screen.curY = top;
                    screen.markAllDirty();
                }
                break;
            }
            case 'q': break;
        }
    }

    _privateCSI(params, finalByte) {
        const screen = this.screen;
        const p0 = params[0] || 0;
        switch (finalByte) {
            case 'h':
                if (p0 === 25) { screen.cursorHidden = false; return; }
                if (p0 === 1000) { screen.mouseMode = 1000; return; }
                if (p0 === 1002) { screen.mouseMode = 1002; return; }
                if (p0 === 1003) { screen.mouseMode = 1003; return; }
                if (p0 === 1006) { screen.mouseMode = 1006; return; }
                if (p0 === 1049) { screen.altBuffer(); return; }
                if (p0 === 1) { screen.modes.applicationCursorKeys = true; return; }
                if (p0 === 2000) { screen.modes.bracketedPaste = true; return; }
                break;
            case 'l':
                if (p0 === 25) { screen.cursorHidden = true; return; }
                if (p0 === 1000 || p0 === 1002 || p0 === 1003) { screen.mouseMode = 0; return; }
                if (p0 === 1006) { screen.mouseMode = 0; return; }
                if (p0 === 1049) { screen.normalBuffer(); return; }
                if (p0 === 1) { screen.modes.applicationCursorKeys = false; return; }
                if (p0 === 2000) { screen.modes.bracketedPaste = false; return; }
                break;
            case 'n':
                if (p0 === 6) this._send('\x1B[' + (screen.curY + 1) + ';' + (screen.curX + 1) + 'R');
                break;
        }
    }

    _deviceStatusReport(p0) {
        const screen = this.screen;
        if (p0 === 5) this._send('\x1B[0n');
        if (p0 === 6) this._send('\x1B[' + (screen.curY + 1) + ';' + (screen.curX + 1) + 'R');
    }

    _setMode(params) {
        const screen = this.screen;
        for (const p of params) {
            if (p === 4) screen.modes.insertMode = true;
        }
    }

    _resetMode(params) {
        const screen = this.screen;
        for (const p of params) {
            if (p === 4) screen.modes.insertMode = false;
        }
    }
}
