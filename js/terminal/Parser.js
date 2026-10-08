/**
 * Parser — VT100/ANSI escape sequence parser.
 *
 * State machine processes raw bytes and delegates buffer mutations to Screen.
 * Emits `send(data)` for DSR responses and similar outbound control sequences.
 */

import { isFinalByte } from '../util/sgr.js';
import {
    CSI_INTRODUCER, ESC, ESC_OSC, ESC_DCS, ESC_SOS, ESC_PM, ESC_APC,
    ESC_SS2, ESC_SS3, ESC_IND, ESC_NEL, ESC_SAVE, ESC_RESTORE,
    ESC_TABSET, ESC_RI, ESC_ST, BEL, CR, LF, BS, TAB, DEL, CAN, SUB,
    MOUSE_SGR, MOUSE_EVENT_MODES,
} from '../util/constants.js';

// A CSI parameter block longer than this is corrupt: drop it instead of
// accumulating attacker-controlled text without bound.
const CSI_MAX_LEN = 128;

export class Parser {
    constructor(screen, callbacks = {}) {
        this.screen = screen;
        this._send = callbacks.onSend || (() => {});

        this._state = 'ground';
        this._retained = '';
        this._stringEscape = false;
    }

    /**
     * Write string data into the parser. Astral characters are kept whole so
     * an emoji occupies one cell instead of two broken surrogates.
     * @param {string} data
     */
    write(data) {
        if (!data) return;
        const len = data.length;
        let i = 0;
        while (i < len) {
            const ch = data[i];
            const code = data.charCodeAt(i);
            i++;

            if (this._state === 'escape') { this._handleEscape(ch); continue; }

            if (this._state === 'csi') {
                if (code === CAN || code === SUB) { this._state = 'ground'; this._retained = ''; continue; }
                if (this._retained.length < CSI_MAX_LEN) this._retained += ch;
                if (isFinalByte(code)) {
                    this._handleCSI(this._retained);
                    this._retained = '';
                    this._state = 'ground';
                }
                continue;
            }

            if (this._state === 'osc' || this._state === 'dcs' || this._state === 'sos' ||
                this._state === 'pm' || this._state === 'apc') {
                this._feedStringMode(ch);
                continue;
            }

            let text = ch;
            if (code >= 0xD800 && code <= 0xDBFF && i < len) {
                const next = data.charCodeAt(i);
                if (next >= 0xDC00 && next <= 0xDFFF) {
                    text = data.slice(i - 1, i + 1);
                    i++;
                }
            }
            this._feedGround(text);
        }
    }

    _feedGround(ch) {
        const screen = this.screen;
        const code = ch.charCodeAt(0);
        if (code === ESC) {
            this._state = 'escape';
            this._retained = '';
            return;
        }
        if (code === CR) { screen.carriageReturn(); return; }
        if (code === LF) { screen.carriageReturn(); screen.lineFeedEdge(); return; }
        if (code === BS) { screen.backspace(); return; }
        if (code === TAB) { screen.tab(); return; }
        if (code === BEL) { return; }
        if (code === 0x0B || code === 0x0C) { screen.lineFeedEdge(); return; }
        if (code === DEL) { return; }          // delete is never printable
        if (code < 0x20) return;
        screen.writeChar(ch);
    }

    _feedStringMode(ch) {
        // ST may be split across two Parser.write() calls. Keep the ESC
        // pending until the following character confirms ESC + backslash.
        // Payloads are consumed, never stored: OSC/DCS are not implemented.
        if (this._stringEscape) {
            this._stringEscape = false;
            if (ch === '\\') { this._state = 'ground'; return; }
        }
        if (ch === '\x07') this._state = 'ground';
        else if (ch === '\x1B') this._stringEscape = true;
    }

    _handleEscape(ch) {
        const screen = this.screen;
        const code = ch.charCodeAt(0);
        if (code === CSI_INTRODUCER) { this._state = 'csi'; this._retained = ''; return; }
        if (code === ESC_OSC) { this._state = 'osc'; this._stringEscape = false; return; }
        if (code === ESC_DCS) { this._state = 'dcs'; this._stringEscape = false; return; }
        if (code === ESC_SOS) { this._state = 'sos'; this._stringEscape = false; return; }
        if (code === ESC_PM) { this._state = 'pm'; this._stringEscape = false; return; }
        if (code === ESC_APC) { this._state = 'apc'; this._stringEscape = false; return; }
        if (code === ESC_SS2 || code === ESC_SS3) { this._state = 'ground'; return; }
        if (code === ESC_IND) { screen.lineFeedEdge(); this._state = 'ground'; return; }
        if (code === ESC_NEL) { screen.lineFeedEdge(); screen.carriageReturn(); this._state = 'ground'; return; }
        if (code === ESC_SAVE) { screen.savedX = screen.curX; screen.savedY = screen.curY; this._state = 'ground'; return; }
        if (code === ESC_RESTORE) { if (screen.savedX >= 0) { screen.curX = screen.savedX; screen.curY = screen.savedY; } this._state = 'ground'; return; }
        if (code === ESC_TABSET) { this._state = 'ground'; return; }
        if (code === ESC_RI) { screen.reverseScroll(); this._state = 'ground'; return; }
        if (code === ESC_ST) { this._state = 'ground'; return; }
        if (code >= 0x40 && code <= 0x5F) { this._state = 'ground'; return; }
        this._state = 'ground';
    }

    _handleCSI(buf) {
        let decPrivate = '';
        let n = '';
        for (let i = 0; i < buf.length; i++) {
            const ch = buf[i];
            const code = ch.charCodeAt(0);
            if (isFinalByte(code)) {
                if (n && "?!><'".includes(n[0])) {
                    decPrivate = n[0];
                    n = n.substring(1);
                }
                const parts = n ? n.split(';').map(Number) : [];
                this._executeCSI(decPrivate, parts, ch);
                return;
            }
            n += ch;
        }
    }

    _executeCSI(decPrivate, params, finalByte) {
        const screen = this.screen;

        if (decPrivate === '?') {
            this._privateCSI(params, finalByte);
            return;
        }
        if (decPrivate === '>') return;

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
            case 'u': if (screen.savedX >= 0) { screen.curX = screen.savedX; screen.curY = screen.savedY; } break;
            case 'h': if (p0 === 4) screen.modes.insertMode = true; break;
            case 'l': if (p0 === 4) screen.modes.insertMode = false; break;
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

    /**
     * DEC private modes — `CSI ? Pm h` / `CSI ? Pm l`.
     * Every entry of Pm is applied: applications commonly send
     * `CSI ?1000;1002;1006h` as one sequence.
     */
    _privateCSI(params, finalByte) {
        const screen = this.screen;
        if (finalByte === 'n') {
            if ((params[0] || 0) === 6) this._deviceStatusReport(6);
            return;
        }
        const set = finalByte === 'h';
        if (!set && finalByte !== 'l') return;
        for (let i = 0; i < params.length; i++) {
            const p = params[i] || 0;
            if (MOUSE_EVENT_MODES.includes(p)) {
                // Event mode: each value replaces the previous one; clearing
                // only applies when it matches the active mode.
                if (set) screen.mouseMode = p;
                else if (screen.mouseMode === p) screen.mouseMode = 0;
                continue;
            }
            switch (p) {
                case 1:
                    screen.modes.applicationCursorKeys = set; break;
                case 25:
                    screen.cursorHidden = !set; break;
                case MOUSE_SGR:
                    // SGR encoding is independent of the event mode.
                    screen.mouseEncoding = set ? MOUSE_SGR : 0;
                    break;
                case 1049:
                    if (set) screen.useAltBuffer(); else screen.restorePrimaryBuffer();
                    break;
                case 2000: // project-specific bracketed-paste flag
                case 2004: // standard DEC bracketed-paste mode
                    screen.modes.bracketedPaste = set; break;
            }
        }
    }

    _deviceStatusReport(p0) {
        const screen = this.screen;
        if (p0 === 5) this._send('\x1B[0n');
        if (p0 === 6) this._send('\x1B[' + (screen.curY + 1) + ';' + (screen.curX + 1) + 'R');
    }

}
