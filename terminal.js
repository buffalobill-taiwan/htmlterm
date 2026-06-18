const XTERM_COLORS = [
    '#000000', '#CD0000', '#00CD00', '#CDCD00',
    '#0000EE', '#CD00CD', '#00CDCD', '#E5E5E5',
    '#7F7F7F', '#FF0000', '#00FF00', '#FFFF00',
    '#5C5CFF', '#FF00FF', '#00FFFF', '#FFFFFF',
];

class Terminal {
    constructor(container, opts = {}) {
        this.container = container;
        this.cols = opts.cols || 80;
        this.rows = opts.rows || 25;
        this._baseCharWidth = opts.charWidth || 8;
        this._baseCharHeight = opts.charHeight || 16;
        this.charWidth = this._baseCharWidth;
        this.charHeight = this._baseCharHeight;
        this._scale = 1;
        this.scrollbackSize = 2000;

        this.onData = null;
        this.onResize = null;

        this.textarea = document.getElementById('hidden-input');
        this._isComposing = false;

        this.buffer = [];
        this.scrollback = [];
        this.viewOffset = 0;
        this.dirtyRows = new Set();

        this.curX = 0;
        this.curY = 0;
        this.savedX = -1;
        this.savedY = -1;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;

        this.attr = this._defaultAttr();

        this.modes = {
            applicationCursorKeys: false,
            bracketedPaste: false,
        };

        this.mouseMode = 0;
        this.mouseBtn = 0;
        this.mouseX = 0;
        this.mouseY = 0;

        this._privateMarker = '';
        this._oscString = '';
        this._buf = '';
        this._state = 'ground';

        this._initDOM();
        this._initBuffer();
        this._bindEvents();
        this._initResizeListener();
        this.fitToViewport();

        if (!opts.noAutoRender) this._startRenderLoop();
    }

    _defaultAttr() {
        return { fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false };
    }

    _isWide(ch) {
        const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
        if (code < 0x1100) return false;
        if (code <= 0x11FF) return true;
        if (code >= 0x2E80 && code <= 0x9FFF) return true;
        if (code >= 0xAC00 && code <= 0xD7AF) return true;
        if (code >= 0xF900 && code <= 0xFAFF) return true;
        if (code >= 0xFE10 && code <= 0xFE19) return true;
        if (code >= 0xFE30 && code <= 0xFE6F) return true;
        if (code >= 0xFF01 && code <= 0xFF60) return true;
        if (code >= 0xFFE0 && code <= 0xFFE6) return true;
        if (code >= 0x20000 && code <= 0x2FFFF) return true;
        if (code >= 0x30000 && code <= 0x3FFFF) return true;
        return false;
    }

    _makeCell(ch) {
        const w = this._isWide(ch) ? 2 : 1;
        return {
            ch: ch || ' ',
            fg: this.attr.fg,
            bg: this.attr.bg,
            bold: this.attr.bold,
            dim: this.attr.dim,
            italic: this.attr.italic,
            underline: this.attr.underline,
            blink: this.attr.blink,
            inverse: this.attr.inverse,
            conceal: this.attr.conceal,
            crossedOut: this.attr.crossedOut,
            width: w,
        };
    }

    _initDOM() {
        this.container.style.position = 'absolute';
        this.container.style.top = '0';
        this.container.style.left = '0';

        this.cursorEl = document.createElement('div');
        this.cursorEl.id = 'cursor';
        this.container.appendChild(this.cursorEl);

        this.rowEls = [];
        for (let i = 0; i < this.rows; i++) {
            const row = document.createElement('div');
            row.className = 'row';
            this.container.appendChild(row);
            this.rowEls.push(row);
        }

        this._setScale(1);
    }

    _initBuffer() {
        this.buffer = [];
        for (let i = 0; i < this.rows; i++) {
            this.buffer.push(this._emptyRow());
        }
        this.scrollback = [];
        this.viewOffset = 0;
        this.curX = 0;
        this.curY = 0;
        this.attr = this._defaultAttr();
        this._markAllDirty();
    }

    _emptyRow() {
        const row = new Array(this.cols);
        for (let i = 0; i < this.cols; i++) {
            row[i] = this._makeCell(' ');
        }
        return row;
    }

    _startRenderLoop() {
        this._loopRunning = true;
        const loop = () => {
            if (!this._loopRunning) return;
            this._render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stopRenderLoop() {
        this._loopRunning = false;
    }

    _render() {
        this._renderRows();
        this._renderCursor();
    }

    _renderRows() {
        for (const rowIdx of this.dirtyRows) {
            if (rowIdx < 0 || rowIdx >= this.rows) continue;
            this._renderRow(rowIdx);
        }
        this.dirtyRows.clear();
    }

    _renderRow(rowIdx) {
        const dataRow = this._getDataRow(rowIdx);
        if (!dataRow) {
            this.rowEls[rowIdx].textContent = '';
            return;
        }
        this.rowEls[rowIdx].innerHTML = this._rowToHTML(dataRow);
    }

    _getDataRow(displayRow) {
        if (this.viewOffset === 0) {
            return this.buffer[displayRow];
        }
        const idx = this.scrollback.length - this.viewOffset + displayRow;
        if (idx >= 0 && idx < this.scrollback.length) {
            return this.scrollback[idx];
        }
        if (idx >= this.scrollback.length) {
            return this.buffer[idx - this.scrollback.length];
        }
        return null;
    }

    _rowToHTML(row) {
        let html = '';
        let i = 0;
        while (i < row.length) {
            const cell = row[i];
            if (cell.width === 0) { i++; continue; }
            let fg = cell.fg;
            let bg = cell.bg;
            const bold = cell.bold;
            const dim = cell.dim;
            const inverse = cell.inverse;

            if (inverse) {
                const tmp = fg; fg = bg; bg = tmp;
            }
            if (bold && typeof fg === 'number' && fg < 8) fg += 8;

            const cls = this._spanClass(fg, bg, cell.italic, cell.underline, cell.crossedOut, cell.blink, dim);
            let j = i + 1;
            while (j < row.length) {
                const c = row[j];
                let cf = c.fg;
                let cb = c.bg;
                const b = c.bold;
                const d = c.dim;
                const inv = c.inverse;
                if (inv) { const t = cf; cf = cb; cb = t; }
                if (b && typeof cf === 'number' && cf < 8) cf += 8;
                if (cf !== fg || cb !== bg || c.bold !== bold || c.dim !== dim ||
                    c.italic !== cell.italic || c.underline !== cell.underline ||
                    c.crossedOut !== cell.crossedOut || c.blink !== cell.blink ||
                    c.inverse !== inverse) break;
                j++;
            }

            let text = '';
            for (let k = i; k < j; k++) {
                const ch = row[k].ch;
                if (ch === '&') text += '&amp;';
                else if (ch === '<') text += '&lt;';
                else if (ch === '>') text += '&gt;';
                else if (ch === '"') text += '&quot;';
                else text += ch;
            }

            html += '<span class="' + cls + '">' + text + '</span>';
            i = j;
        }
        return html;
    }

    _spanClass(fg, bg, italic, underline, crossedOut, blink, dim) {
        const parts = [];
        if (typeof fg === 'number' && fg <= 15) parts.push('q' + fg);
        else parts.push('qhi');
        if (typeof bg === 'number' && bg <= 15) parts.push('b' + bg);
        else parts.push('bhi');
        if (italic) parts.push('i');
        if (underline) parts.push('u');
        if (crossedOut) parts.push('s');
        if (blink) parts.push('blink');
        if (dim) parts.push('dim');
        return parts.join(' ');
    }

    _renderCursor() {
        const row = this.buffer[this.curY];
        if (!row || this.viewOffset !== 0 || this.curX < 0 || this.curX >= this.cols) {
            this.cursorEl.className = 'hidden';
            return;
        }

        const cell = row[this.curX];
        let fg = cell.fg;
        let bg = cell.bg;
        if (cell.inverse) { const t = fg; fg = bg; bg = t; }

        this.cursorEl.className = '';
        this.cursorEl.textContent = cell.ch;
        this.cursorEl.style.left = (this.curX * this.charWidth) + 'px';
        this.cursorEl.style.top = (this.curY * this.charHeight) + 'px';
        this.cursorEl.style.width = this.charWidth + 'px';
        this.cursorEl.style.height = this.charHeight + 'px';
        this.cursorEl.style.fontSize = this.charHeight + 'px';
        this.cursorEl.style.lineHeight = this.charHeight + 'px';
        this.cursorEl.style.textAlign = 'center';
        this.cursorEl.style.backgroundColor = (typeof fg === 'number' && fg <= 15) ? XTERM_COLORS[fg] : (typeof fg === 'string' ? fg : '#C0C0C0');
        this.cursorEl.style.color = (typeof bg === 'number' && bg <= 15) ? XTERM_COLORS[bg] : (typeof bg === 'string' ? bg : '#000000');
        this.cursorEl.style.fontFamily = 'UnifontTerm, monospace';
    }

    _bindEvents() {
        this._keydownHandler = (e) => this._onKeyDown(e);
        this._beforeInputHandler = (e) => this._onBeforeInput(e);
        this._keyupHandler = (e) => this._onKeyUp(e);
        this._compStartHandler = () => { this._isComposing = true; };
        this._compEndHandler = (e) => this._onCompositionEnd(e);
        this._pasteHandler = (e) => this._onPaste(e);
        this._wheelHandler = (e) => this._onWheel(e);
        this._mouseDownHandler = (e) => this._onMouseDown(e);
        this._mouseUpHandler = (e) => this._onMouseUp(e);
        this._mouseMoveHandler = (e) => this._onMouseMove(e);
        this._contextHandler = (e) => e.preventDefault();

        document.addEventListener('keydown', this._keydownHandler);
        this.textarea.addEventListener('beforeinput', this._beforeInputHandler);
        document.addEventListener('keyup', this._keyupHandler);
        this.textarea.addEventListener('compositionstart', this._compStartHandler);
        this.textarea.addEventListener('compositionend', this._compEndHandler);
        this.textarea.addEventListener('paste', this._pasteHandler);
        this.container.addEventListener('wheel', this._wheelHandler, { passive: true });
        this.container.addEventListener('mousedown', this._mouseDownHandler);
        document.addEventListener('mouseup', this._mouseUpHandler);
        document.addEventListener('mousemove', this._mouseMoveHandler);
        this.container.addEventListener('contextmenu', this._contextHandler);
    }

    _onKeyDown(e) {
        if (!this.onData) return;
        if (this._isComposing || e.isComposing) return;
        if (e.ctrlKey && e.key === ' ') return;

        const key = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const alt = e.altKey;
        const shift = e.shiftKey;

        if (ctrl && key === 'v') return;

        if (ctrl && alt && key === 'c') return;

        if (ctrl && key === 'z') { this._send('\x1A'); e.preventDefault(); return; }
        if (ctrl && key === 'd') { this._send('\x04'); e.preventDefault(); return; }
        if (ctrl && key === 'a') { this._send('\x01'); e.preventDefault(); return; }
        if (ctrl && key === 'e') { this._send('\x05'); e.preventDefault(); return; }
        if (ctrl && key === 'l') { this._send('\x0C'); e.preventDefault(); return; }
        if (ctrl && key === 'u') { this._send('\x15'); e.preventDefault(); return; }
        if (ctrl && key === 'k') { this._send('\x0B'); e.preventDefault(); return; }
        if (ctrl && key === 'w') { this._send('\x17'); e.preventDefault(); return; }
        if (ctrl && key === 'r') { this._send('\x12'); e.preventDefault(); return; }

        if (key === 'Enter') { this._send('\r'); e.preventDefault(); return; }
        if (key === 'Backspace') { this._send('\x7F'); e.preventDefault(); return; }
        if (key === 'Tab') { this._send(shift ? '\x1B[Z' : '\t'); e.preventDefault(); return; }
        if (key === 'Escape') { this._send('\x1B'); e.preventDefault(); return; }

        if (key === 'ArrowUp') { this._send(this.modes.applicationCursorKeys ? '\x1BOA' : '\x1B[A'); e.preventDefault(); return; }
        if (key === 'ArrowDown') { this._send(this.modes.applicationCursorKeys ? '\x1BOB' : '\x1B[B'); e.preventDefault(); return; }
        if (key === 'ArrowRight') { this._send(this.modes.applicationCursorKeys ? '\x1BOC' : '\x1B[C'); e.preventDefault(); return; }
        if (key === 'ArrowLeft') { this._send(this.modes.applicationCursorKeys ? '\x1BOD' : '\x1B[D'); e.preventDefault(); return; }

        if (key === 'Home') { this._send('\x1B[H'); e.preventDefault(); return; }
        if (key === 'End') { this._send('\x1B[F'); e.preventDefault(); return; }
        if (key === 'Insert') { this._send('\x1B[2~'); e.preventDefault(); return; }
        if (key === 'Delete') { this._send('\x1B[3~'); e.preventDefault(); return; }
        if (key === 'PageUp') { this._send('\x1B[5~'); e.preventDefault(); return; }
        if (key === 'PageDown') { this._send('\x1B[6~'); e.preventDefault(); return; }

        const fMap = {
            F1: '\x1BOP', F2: '\x1BOQ', F3: '\x1BOR', F4: '\x1BOS',
            F5: '\x1B[15~', F6: '\x1B[17~', F7: '\x1B[18~', F8: '\x1B[19~',
            F9: '\x1B[20~', F10: '\x1B[21~', F11: '\x1B[23~', F12: '\x1B[24~',
        };
        if (fMap[key]) { this._send(fMap[key]); e.preventDefault(); return; }

        if (key && key.length === 1 && !ctrl && !alt && !e.metaKey) {
            if (document.activeElement !== this.textarea) {
                this._send(key);
                e.preventDefault();
            }
            return;
        }

        if (ctrl && shift && (key === '+' || key === '=')) {
            this.viewOffset = Math.max(0, this.viewOffset - 1);
            this._markAllDirty();
            e.preventDefault();
            return;
        }
        if (ctrl && key === '-') {
            this.viewOffset = Math.min(this._maxViewOffset(), this.viewOffset + 1);
            this._markAllDirty();
            e.preventDefault();
            return;
        }
    }

    _onBeforeInput(e) {
        if (this._isComposing) return;
        if (!this.onData || !e.data) return;
        if (e.inputType === 'insertText') {
            this._send(e.data);
            e.preventDefault();
        }
    }

    _onKeyUp(e) {
        if (this._isComposing) return;
        const code = e.keyCode;
        if (code === 16 || code === 17 || code === 18 || code === 91) return;
        if (code > 15) this._focusInput();
    }

    _onCompositionEnd(e) {
        this._isComposing = false;
        if (!this.onData) return;
        if (e.data) this._send(e.data);
        this._focusInput();
    }

    _onPaste(e) {
        if (!this.onData) return;
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        if (this.modes.bracketedPaste) {
            this._send('\x1B[200~' + text + '\x1B[201~');
        } else {
            this._send(text);
        }
        this._focusInput();
    }

    _send(data) {
        if (this.viewOffset > 0) {
            this.viewOffset = 0;
            this._markAllDirty();
        }
        if (this.onData) this.onData(data);
    }

    _focusInput() {
        this.textarea.focus();
        this.textarea.value = '';
    }

    _markAllDirty() {
        for (let i = 0; i < this.rows; i++) this.dirtyRows.add(i);
    }

    _markRowDirty(rowIdx) {
        if (rowIdx >= 0 && rowIdx < this.rows) this.dirtyRows.add(rowIdx);
    }

    _maxViewOffset() {
        return Math.min(this.scrollback.length, this.scrollbackSize);
    }

    focus() {
        this._focusInput();
    }

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
                if (ch >= '@' && ch <= '~') {
                    this._processCSI(this._buf);
                    this._buf = '';
                    this._state = 'ground';
                }
                continue;
            }
            if (this._state === 'osc') {
                if (ch === '\x07' || (ch === '\x1B' && data[i + 1] === '\\')) {
                    if (ch === '\x1B') i++;
                    this._processOSC(this._oscString);
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
            if (code === 0x0D) { this._carriageReturn(); continue; }
            if (code === 0x0A) { this._carriageReturn(); this._lineFeed(); continue; }
            if (code === 0x08) { this._backspace(); continue; }
            if (code === 0x09) { this._tab(); continue; }
            if (code === 0x07) { continue; }
            if (code === 0x0B || code === 0x0C) { this._lineFeed(); continue; }
            if (code < 0x20) continue;

            this._writeChar(ch);
        }
    }

    _processEscape(ch) {
        const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
        if (code === 0x5B) { this._state = 'csi'; this._buf = ''; return; }
        if (code === 0x5D) { this._state = 'osc'; this._oscString = ''; return; }
        if (code === 0x50) { this._state = 'dcs'; return; }
        if (code === 0x58) { this._state = 'sos'; return; }
        if (code === 0x5E) { this._state = 'pm'; return; }
        if (code === 0x5F) { this._state = 'apc'; return; }
        if (code === 0x4E || code === 0x4F) { this._state = 'ground'; return; }
        if (code === 0x44) { this._lineFeed(); this._state = 'ground'; return; }
        if (code === 0x45) { this._lineFeed(); this._carriageReturn(); this._state = 'ground'; return; }
        if (code === 0x48) { this._setTabStop(); this._state = 'ground'; return; }
        if (code === 0x4D) { this._reverseIndex(); this._state = 'ground'; return; }
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
            if (code >= 0x30 && code <= 0x3F) {
                n += ch;
                continue;
            }
            if (code >= 0x40 && code <= 0x7E) {
                const parts = n ? n.split(';').map(Number) : [];
                this._dispatchCSI(privateMarker, parts, ch);
                return;
            }
            if (ch === '?' || ch === '>' || ch === '!' || ch === '<' || ch === "'") {
                privateMarker += ch;
                continue;
            }
        }
    }

    _dispatchCSI(privateMarker, params, finalByte) {
        if (privateMarker === '?') {
            this._privateCSI(params, finalByte);
            return;
        }
        if (privateMarker === '>') return;

        const p0 = params[0] || 0;
        const p1 = params[1] || 0;

        switch (finalByte) {
            case 'A': this._cursorUp(Math.max(1, p0)); break;
            case 'B': this._cursorDown(Math.max(1, p0)); break;
            case 'C': this._cursorForward(Math.max(1, p0)); break;
            case 'D': this._cursorBack(Math.max(1, p0)); break;
            case 'E': this._cursorDown(Math.max(1, p0)); this.curX = 0; break;
            case 'F': this._cursorUp(Math.max(1, p0)); this.curX = 0; break;
            case 'G': this.curX = Math.max(0, Math.min(this.cols - 1, (p0 || 1) - 1)); break;
            case 'H': case 'f': this._cursorPos(p0 || 1, p1 || 1); break;
            case 'J': this._eraseDisplay(p0); break;
            case 'K': this._eraseLine(p0); break;
            case 'L': this._insertLines(Math.max(1, p0)); break;
            case 'M': this._deleteLines(Math.max(1, p0)); break;
            case 'P': this._deleteChars(Math.max(1, p0)); break;
            case '@': this._insertChars(Math.max(1, p0)); break;
            case 'X': this._eraseChars(Math.max(1, p0)); break;
            case 'd': this._rowPos(p0 || 1); break;
            case 'S': this._scrollUp(Math.max(1, p0)); break;
            case 'T': this._scrollDown(Math.max(1, p0)); break;
            case 'm': this._setSGR(params); break;
            case 's': this.savedX = this.curX; this.savedY = this.curY; break;
            case 'u': if (this.savedX >= 0) { this.curX = this.savedX; this.curY = this.savedY; this._markRowDirty(this.curY); } break;
            case 'h': this._setMode(params); break;
            case 'l': this._resetMode(params); break;
            case 'n': this._deviceStatusReport(p0); break;
            case 'q': break;
        }
    }

    _privateCSI(params, finalByte) {
        const p0 = params[0] || 0;
        switch (finalByte) {
            case 'h':
                if (p0 === 25) return;
                if (p0 === 1000) { this.mouseMode = 1000; return; }
                if (p0 === 1002) { this.mouseMode = 1002; return; }
                if (p0 === 1003) { this.mouseMode = 1003; return; }
                if (p0 === 1006) { this.mouseMode = 1006; return; }
                if (p0 === 1049) { this._altBuffer(); return; }
                if (p0 === 1) { this.modes.applicationCursorKeys = true; return; }
                if (p0 === 2000) { this.modes.bracketedPaste = true; return; }
                break;
            case 'l':
                if (p0 === 25) return;
                if (p0 === 1000 || p0 === 1002 || p0 === 1003) { this.mouseMode = 0; return; }
                if (p0 === 1006) { this.mouseMode = 0; return; }
                if (p0 === 1049) { this._normalBuffer(); return; }
                if (p0 === 1) { this.modes.applicationCursorKeys = false; return; }
                if (p0 === 2000) { this.modes.bracketedPaste = false; return; }
                break;
            case 'n':
                if (p0 === 6) this._send('\x1B[' + (this.curY + 1) + ';' + (this.curX + 1) + 'R');
                break;
        }
    }

    _processOSC(str) {
        const idx = str.indexOf(';');
        if (idx < 0) return;
        const cmd = parseInt(str.substring(0, idx), 10);
        if (cmd === 0 || cmd === 2) {
        } else if (cmd === 8) {
        }
    }

    _deviceStatusReport(p0) {
        if (p0 === 5) this._send('\x1B[0n');
        if (p0 === 6) this._send('\x1B[' + (this.curY + 1) + ';' + (this.curX + 1) + 'R');
    }

    _setMode(params) {
    }

    _resetMode(params) {
    }

    _setSGR(params) {
        if (params.length === 0) params = [0];

        for (let i = 0; i < params.length; i++) {
            const p = params[i];
            if (p === 0) {
                this.attr = this._defaultAttr();
            } else if (p === 1) {
                this.attr.bold = true;
            } else if (p === 2) {
                this.attr.dim = true;
            } else if (p === 3) {
                this.attr.italic = true;
            } else if (p === 4) {
                this.attr.underline = true;
            } else if (p === 5 || p === 6) {
                this.attr.blink = true;
            } else if (p === 7) {
                this.attr.inverse = true;
            } else if (p === 8) {
                this.attr.conceal = true;
            } else if (p === 9) {
                this.attr.crossedOut = true;
            } else if (p === 21 || p === 22) {
                this.attr.bold = false; this.attr.dim = false;
            } else if (p === 23) {
                this.attr.italic = false;
            } else if (p === 24) {
                this.attr.underline = false;
            } else if (p === 25) {
                this.attr.blink = false;
            } else if (p === 27) {
                this.attr.inverse = false;
            } else if (p === 28) {
                this.attr.conceal = false;
            } else if (p === 29) {
                this.attr.crossedOut = false;
            } else if (p >= 30 && p <= 37) {
                this.attr.fg = p - 30;
            } else if (p === 38) {
                i = this._parseExtendedColor(params, i, 'fg');
            } else if (p === 39) {
                this.attr.fg = 7;
            } else if (p >= 40 && p <= 47) {
                this.attr.bg = p - 40;
            } else if (p === 48) {
                i = this._parseExtendedColor(params, i, 'bg');
            } else if (p === 49) {
                this.attr.bg = 0;
            } else if (p >= 90 && p <= 97) {
                this.attr.fg = p - 90 + 8;
            } else if (p >= 100 && p <= 107) {
                this.attr.bg = p - 100 + 8;
            }
        }
    }

    _parseExtendedColor(params, i, type) {
        if (i + 1 >= params.length) return i;
        const mode = params[i + 1];
        if (mode === 5 && i + 2 < params.length) {
            const idx = params[i + 2];
            if (type === 'fg') this.attr.fg = idx;
            else this.attr.bg = idx;
            return i + 2;
        }
        if (mode === 2 && i + 4 < params.length) {
            const r = params[i + 2], g = params[i + 3], b = params[i + 4];
            const hex = '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
            if (type === 'fg') this.attr.fg = hex;
            else this.attr.bg = hex;
            return i + 4;
        }
        return i;
    }

    _cursorUp(n) {
        this._markRowDirty(this.curY);
        this.curY = Math.max(0, this.curY - n);
        this._markRowDirty(this.curY);
    }

    _cursorDown(n) {
        this._markRowDirty(this.curY);
        this.curY = Math.min(this.rows - 1, this.curY + n);
        this._markRowDirty(this.curY);
    }

    _cursorForward(n) {
        this.curX = Math.min(this.cols - 1, this.curX + n);
    }

    _cursorBack(n) {
        this.curX = Math.max(0, this.curX - n);
    }

    _cursorPos(row, col) {
        this._markRowDirty(this.curY);
        this.curY = Math.max(0, Math.min(this.rows - 1, row - 1));
        this.curX = Math.max(0, Math.min(this.cols - 1, col - 1));
        this._markRowDirty(this.curY);
    }

    _rowPos(row) {
        this._markRowDirty(this.curY);
        this.curY = Math.max(0, Math.min(this.rows - 1, row - 1));
        this._markRowDirty(this.curY);
    }

    _lineFeed() {
        this._markRowDirty(this.curY);
        if (this.curY === this.scrollBottom) {
            this._scrollUp(1);
        } else {
            this.curY++;
        }
    }

    _carriageReturn() {
        this.curX = 0;
    }

    _backspace() {
        if (this.curX > 0) this.curX--;
    }

    _tab() {
        const next = (this.curX + 8) & ~7;
        this.curX = Math.min(this.cols - 1, next);
    }

    _reverseIndex() {
        this._markRowDirty(this.curY);
        if (this.curY === this.scrollTop) {
            this._scrollDown(1);
        } else {
            this.curY--;
        }
        this._markRowDirty(this.curY);
    }

    _scrollUp(n) {
        for (let i = 0; i < n; i++) {
            if (this.scrollTop === 0) {
                this.scrollback.push(Array.from(this.buffer[0]));
                if (this.scrollback.length > this.scrollbackSize) {
                    this.scrollback.shift();
                }
            }
            for (let r = this.scrollTop; r < this.scrollBottom; r++) {
                this.buffer[r] = this.buffer[r + 1];
            }
            this.buffer[this.scrollBottom] = this._emptyRow();
        }
        if (this.viewOffset > 0) this.viewOffset = Math.min(this.viewOffset, this._maxViewOffset());
        this._markAllDirty();
    }

    _scrollDown(n) {
        for (let i = 0; i < n; i++) {
            for (let r = this.scrollBottom; r > this.scrollTop; r--) {
                this.buffer[r] = this.buffer[r - 1];
            }
            this.buffer[this.scrollTop] = this._emptyRow();
        }
        this._markAllDirty();
    }

    _eraseDisplay(mode) {
        if (mode === 0) {
            this._eraseLine(0);
            for (let r = this.curY + 1; r < this.rows; r++) {
                this.buffer[r] = this._emptyRow();
                this._markRowDirty(r);
            }
        } else if (mode === 1) {
            for (let r = 0; r < this.curY; r++) {
                this.buffer[r] = this._emptyRow();
                this._markRowDirty(r);
            }
            this._eraseLine(1);
        } else if (mode === 2 || mode === 3) {
            for (let r = 0; r < this.rows; r++) {
                this.buffer[r] = this._emptyRow();
                this._markRowDirty(r);
            }
        }
    }

    _eraseLine(mode) {
        const row = this.buffer[this.curY];
        if (!row) return;
        if (mode === 0) {
            for (let c = this.curX; c < this.cols; c++) row[c] = this._makeCell(' ');
        } else if (mode === 1) {
            for (let c = 0; c <= this.curX; c++) row[c] = this._makeCell(' ');
        } else if (mode === 2) {
            for (let c = 0; c < this.cols; c++) row[c] = this._makeCell(' ');
        }
        this._markRowDirty(this.curY);
    }

    _insertLines(n) {
        n = Math.min(n, this.rows - this.curY);
        for (let i = 0; i < n; i++) {
            for (let r = this.scrollBottom; r > this.curY; r--) {
                this.buffer[r] = this.buffer[r - 1];
            }
            this.buffer[this.curY] = this._emptyRow();
        }
        this._markAllDirty();
    }

    _deleteLines(n) {
        n = Math.min(n, this.rows - this.curY);
        for (let i = 0; i < n; i++) {
            for (let r = this.curY; r < this.scrollBottom; r++) {
                this.buffer[r] = this.buffer[r + 1];
            }
            this.buffer[this.scrollBottom] = this._emptyRow();
        }
        this._markAllDirty();
    }

    _insertChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        n = Math.min(n, this.cols - this.curX);
        for (let c = this.cols - 1; c >= this.curX + n; c--) {
            row[c] = row[c - n];
        }
        for (let c = this.curX; c < this.curX + n; c++) {
            row[c] = this._makeCell(' ');
        }
        this._markRowDirty(this.curY);
    }

    _deleteChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        n = Math.min(n, this.cols - this.curX);
        for (let c = this.curX; c < this.cols - n; c++) {
            row[c] = row[c + n];
        }
        for (let c = this.cols - n; c < this.cols; c++) {
            row[c] = this._makeCell(' ');
        }
        this._markRowDirty(this.curY);
    }

    _eraseChars(n) {
        const row = this.buffer[this.curY];
        if (!row) return;
        n = Math.min(n, this.cols - this.curX);
        for (let c = this.curX; c < this.curX + n; c++) {
            row[c] = this._makeCell(' ');
        }
        this._markRowDirty(this.curY);
    }

    _writeChar(ch) {
        const cell = this._makeCell(ch);
        if (cell.width === 2 && this.curX >= this.cols - 1) {
            this.curX = 0;
            this._lineFeed();
        }
        if (this.curX >= this.cols) {
            this.curX = 0;
            this._lineFeed();
        }

        const row = this.buffer[this.curY];
        if (!row) return;

        row[this.curX] = cell;
        if (cell.width === 2 && this.curX + 1 < this.cols) {
            row[this.curX + 1] = {
                ch: '', fg: this.attr.fg, bg: this.attr.bg,
                bold: this.attr.bold, dim: this.attr.dim,
                italic: this.attr.italic, underline: this.attr.underline,
                blink: this.attr.blink, inverse: this.attr.inverse,
                conceal: this.attr.conceal, crossedOut: this.attr.crossedOut,
                width: 0,
            };
        }
        this._markRowDirty(this.curY);
        this.curX += cell.width;
    }

    cursorUp(n) { this._cursorUp(n); }
    cursorDown(n) { this._cursorDown(n); }
    cursorForward(n) { this._cursorForward(n); }
    cursorBack(n) { this._cursorBack(n); }
    lineFeed() { this._lineFeed(); }
    carriageReturn() { this._carriageReturn(); }

    _altBuffer() {
        this._normalLines = this.buffer;
        this._normalCurX = this.curX;
        this._normalCurY = this.curY;
        this._normalViewOffset = this.viewOffset;
        this._saveScroll = { top: this.scrollTop, bottom: this.scrollBottom };

        this.buffer = [];
        for (let i = 0; i < this.rows; i++) this.buffer.push(this._emptyRow());
        this.curX = 0;
        this.curY = 0;
        this.viewOffset = 0;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
        this._markAllDirty();
    }

    _normalBuffer() {
        if (!this._normalLines) return;
        this.buffer = this._normalLines;
        this.curX = this._normalCurX || 0;
        this.curY = this._normalCurY || 0;
        this.viewOffset = this._normalViewOffset || 0;
        if (this._saveScroll) {
            this.scrollTop = this._saveScroll.top;
            this.scrollBottom = this._saveScroll.bottom;
        }
        this._normalLines = null;
        this._markAllDirty();
    }

    scrollbackUp(n) {
        this.viewOffset = Math.min(this._maxViewOffset(), this.viewOffset + n);
        this._markAllDirty();
    }

    scrollbackDown(n) {
        this.viewOffset = Math.max(0, this.viewOffset - n);
        this._markAllDirty();
    }

    clearBuffer() {
        this._initBuffer();
    }

    _setScale(scale) {
        this._scale = scale;
        this.charWidth = this._baseCharWidth * scale;
        this.charHeight = this._baseCharHeight * scale;

        const w = this.cols * this.charWidth;
        const h = this.rows * this.charHeight;

        this.container.style.width = w + 'px';
        this.container.style.height = h + 'px';
        this.container.style.fontSize = this.charHeight + 'px';
        this.container.style.lineHeight = this.charHeight + 'px';

        for (const el of this.rowEls) {
            el.style.height = this.charHeight + 'px';
            el.style.lineHeight = this.charHeight + 'px';
        }

        const wrapper = this.container.parentElement;
        if (wrapper) {
            wrapper.style.width = w + 'px';
            wrapper.style.height = h + 'px';
        }

        this._markAllDirty();
    }

    fitToViewport() {
        const pad = 8;
        const maxW = window.innerWidth - pad * 2;
        const maxH = window.innerHeight - pad * 2;

        if (maxW <= 0 || maxH <= 0) return;

        const baseW = this.cols * this._baseCharWidth;
        const baseH = this.rows * this._baseCharHeight;

        let scale = Math.min(maxW / baseW, maxH / baseH);
        if (scale < 1) scale = 1;

        this._setScale(scale);
    }

    _initResizeListener() {
        let timer;
        window.addEventListener('resize', () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.fitToViewport(), 80);
        });
    }

    resize(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.scrollBottom = rows - 1;
        while (this.rowEls.length < rows) {
            const row = document.createElement('div');
            row.className = 'row';
            this.container.appendChild(row);
            this.rowEls.push(row);
        }
        while (this.rowEls.length > rows) {
            this.container.removeChild(this.rowEls.pop());
        }
        this._initBuffer();
        this._setScale(this._scale);
        if (this.onResize) this.onResize(cols, rows);
    }

    _onWheel(e) {
        if (e.deltaY < 0) this.scrollbackUp(3);
        else this.scrollbackDown(3);
    }

    _onMouseDown(e) {
        this._focusInput();
        if (!this.onData || this.mouseMode === 0) return;
        e.preventDefault();

        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const col = Math.floor(x / this.charWidth);
        const row = Math.floor(y / this.charHeight);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;

        let btn = 0;
        if (e.button === 0) btn = 0;
        else if (e.button === 1) btn = 1;
        else if (e.button === 2) btn = 2;

        if (e.shiftKey) btn += 4;
        if (e.altKey) btn += 8;
        if (e.ctrlKey) btn += 16;

        this.mouseBtn = btn;
        this.mouseX = col;
        this.mouseY = row;

        if (this.mouseMode === 9 || this.mouseMode === 1000 || this.mouseMode === 1002 || this.mouseMode === 1003) {
            this._sendMouseEvent('M', btn, col + 1, row + 1);
        }
    }

    _onMouseUp(e) {
        if (!this.onData || this.mouseMode === 0) return;
        if (this.mouseMode === 1000 || this.mouseMode === 1002 || this.mouseMode === 1003) {
            const rect = this.container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const col = Math.floor(x / this.charWidth);
            const row = Math.floor(y / this.charHeight);
            if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
            if (this.mouseMode === 9) return;
            const btn = this.mouseBtn + 32;
            this._sendMouseEvent('m', btn, col + 1, row + 1);
        }
        this.mouseBtn = 0;
    }

    _onMouseMove(e) {
        if (!this.onData || this.mouseMode !== 1003) return;
        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const col = Math.floor(x / this.charWidth);
        const row = Math.floor(y / this.charHeight);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
        this._sendMouseEvent('M', this.mouseBtn + 32, col + 1, row + 1);
    }

    _sendMouseEvent(prefix, btn, col, row) {
        if (this.mouseMode === 1006) {
            this._send('\x1B[' + prefix + btn + ';' + col + ';' + row);
        } else {
            this._send('\x1B[' + prefix + String.fromCharCode(btn + 32) + String.fromCharCode(col + 32) + String.fromCharCode(row + 32));
        }
    }
}
