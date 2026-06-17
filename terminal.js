function isWide(ch) {
    const c = ch.charCodeAt(0);
    if (c >= 0x1100 && c <= 0x115F) return true;
    if (c === 0x2329 || c === 0x232A) return true;
    if (c >= 0x2E80 && c <= 0x303E) return true;
    if (c >= 0x3040 && c <= 0x33BF) return true;
    if (c >= 0x3400 && c <= 0x4DBF) return true;
    if (c >= 0x4E00 && c <= 0xA4CF) return true;
    if (c >= 0xAC00 && c <= 0xD7A3) return true;
    if (c >= 0xF900 && c <= 0xFAFF) return true;
    if (c >= 0xFE10 && c <= 0xFE19) return true;
    if (c >= 0xFE30 && c <= 0xFE6F) return true;
    if (c >= 0xFF01 && c <= 0xFF60) return true;
    if (c >= 0xFFE0 && c <= 0xFFE6) return true;
    return false;
}

class Terminal {
    constructor(canvas, opts = {}) {
        this.cols = opts.cols || 80;
        this.rows = opts.rows || 25;
        this.cw = 8;
        this.ch = 16;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        canvas.width = this.cols * this.cw;
        canvas.height = this.rows * this.ch;

        this.buffer = [];
        this.cursor = { x: 0, y: 0 };
        this.savedCursor = { x: 0, y: 0, attr: null };
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
        this.originMode = false;
        this.autoWrap = true;
        this.insertMode = false;
        this.reverseVideo = false;
        this.applicationCursorKeys = false;
        this.cursorVisible = true;
        this.cursorStyle = 1;
        this.cursorBlink = true;
        this.blinkPhase = true;
        this.bracketedPaste = false;

        this.tabStops = new Set();
        for (let i = 0; i < this.cols; i += 8) this.tabStops.add(i);

        this.state = 'ground';
        this.paramBuffer = '';
        this.params = [];
        this.privateMarker = '';
        this.oscString = '';

        this.mouseMode = 0;
        this.mouseSGR = false;
        this.mousePixels = false;
        this.mouseBtn = 0;
        this.mouseTracking = false;
        this.mouseEvent = null;

        this.scrollback = [];
        this.scrollbackMax = 1000;
        this.scrollbackOffset = 0;

        this.initColors();
        this.attr = { fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false };

        this.dirty = true;
        this._loopRunning = false;
        this._lastBlink = 0;
        this._loop = null;

        this.onData = null;
        this.onResize = null;
        this._isComposing = false;

        this.textarea = document.createElement('textarea');
        this.textarea.setAttribute('aria-hidden', 'true');
        this.textarea.tabIndex = 0;
        this.textarea.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;padding:0;margin:0;border:none;outline:none;resize:none;background:transparent;color:transparent;caret-color:transparent;opacity:0.001;pointer-events:none;z-index:1';
        canvas.parentNode.insertBefore(this.textarea, canvas.nextSibling);

        this.clearBuffer();
        this.bindEvents();

        if (!opts.noAutoRender) this.startRenderLoop();
    }

    initColors() {
        this.colors = [
            '#000000', '#AA0000', '#00AA00', '#AA5500',
            '#0000AA', '#AA00AA', '#00AAAA', '#AAAAAA',
            '#555555', '#FF5555', '#55FF55', '#FFFF55',
            '#5555FF', '#FF55FF', '#55FFFF', '#FFFFFF',
        ];
        this.cubeColors = [];
        for (let r = 0; r < 6; r++) {
            for (let g = 0; g < 6; g++) {
                for (let b = 0; b < 6; b++) {
                    const red   = r === 0 ? 0 : r * 40 + 55;
                    const green = g === 0 ? 0 : g * 40 + 55;
                    const blue  = b === 0 ? 0 : b * 40 + 55;
                    this.cubeColors.push(`rgb(${red},${green},${blue})`);
                }
            }
        }
        this.grayColors = [];
        for (let i = 0; i < 24; i++) {
            const v = i * 10 + 8;
            this.grayColors.push(`rgb(${v},${v},${v})`);
        }
    }

    getColor(n) {
        if (n < 0) n = 0;
        if (n > 255) n = 255;
        if (n < 16) return this.colors[n];
        if (n < 232) return this.cubeColors[n - 16];
        return this.grayColors[n - 232];
    }

    createRow() {
        const row = new Array(this.cols);
        for (let i = 0; i < this.cols; i++) {
            row[i] = { char: ' ', fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, dw: false };
        }
        return row;
    }

    clearBuffer() {
        this.buffer = [];
        for (let y = 0; y < this.rows; y++) this.buffer.push(this.createRow());
        this.cursor.x = 0;
        this.cursor.y = 0;
        this.dirty = true;
    }

    focus() {
        this.textarea.focus();
    }

    startRenderLoop() {
        if (this._loopRunning) return;
        this._loopRunning = true;
        const loop = () => {
            if (!this._loopRunning) return;
            const now = Date.now();
            if (now - this._lastBlink > 500) {
                this.blinkPhase = !this.blinkPhase;
                this._lastBlink = now;
                this.dirty = true;
            }
            if (this.dirty) {
                this.render();
                this.dirty = false;
            }
            this._loop = requestAnimationFrame(loop);
        };
        this._loop = requestAnimationFrame(loop);
    }

    stopRenderLoop() {
        this._loopRunning = false;
        if (this._loop) {
            cancelAnimationFrame(this._loop);
            this._loop = null;
        }
    }

    render() {
        const ctx = this.ctx;
        const cw = this.cw, ch = this.ch;
        const cols = this.cols, rows = this.rows;
        const attr = this.attr;

        let visibleY0 = 0;
        let visibleY1 = rows;
        let buffer = this.buffer;

        if (this.scrollbackOffset > 0) {
            const sbLen = this.scrollback.length;
            if (this.scrollbackOffset <= sbLen) {
                visibleY0 = 0;
                visibleY1 = rows;
                buffer = this.getScrollbackView();
            }
        }

        ctx.imageSmoothingEnabled = false;
        ctx.font = `${ch}px 'UnifontTerm', monospace`;
        ctx.textBaseline = 'top';

        for (let y = 0; y < rows; y++) {
            const row = buffer[y];
            if (!row) continue;
            for (let x = 0; x < cols; x++) {
                const cell = row[x];
                if (!cell) continue;
                if (cell.dw && cell.char === '') continue;

                let cellW = cell.dw ? cw * 2 : cw;
                let fgNum = cell.fg;
                let bgNum = cell.bg;

                if (cell.inverse) {
                    const tmp = fgNum; fgNum = bgNum; bgNum = tmp;
                }
                if (cell.conceal) {
                    fgNum = bgNum;
                }

                let fgColor;
                if (cell.bold && fgNum < 8) {
                    fgColor = this.getColor(fgNum + 8);
                } else if (cell.dim) {
                    const base = this.getColor(fgNum);
                    fgColor = base;
                } else {
                    fgColor = this.getColor(fgNum);
                }
                const bgColor = this.getColor(bgNum);

                ctx.fillStyle = bgColor;
                ctx.fillRect(x * cw, y * ch, cellW, ch);

                if (cell.char !== ' ' && cell.char !== '') {
                    ctx.fillStyle = fgColor;
                    if (cell.bold) {
                        ctx.font = `bold ${ch}px 'UnifontTerm', monospace`;
                    } else {
                        ctx.font = `${ch}px 'UnifontTerm', monospace`;
                    }
                    ctx.fillText(cell.char, x * cw, y * ch);

                    if (cell.underline) {
                        ctx.fillStyle = fgColor;
                        ctx.fillRect(x * cw, y * ch + ch - 2, cellW, 1);
                    }
                    if (cell.crossedOut) {
                        ctx.fillStyle = fgColor;
                        ctx.fillRect(x * cw, y * ch + Math.floor(ch / 2), cellW, 1);
                    }
                    if (cell.blink && this.blinkPhase) {
                        ctx.fillStyle = bgColor;
                        ctx.fillRect(x * cw, y * ch, cellW, ch);
                    }
                }
            }
        }

        if (this.cursorVisible && this.scrollbackOffset === 0 && (this.cursorBlink ? this.blinkPhase : true)) {
            const cx = this.cursor.x;
            const cy = this.cursor.y;
            if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
                const cell = buffer[cy] && buffer[cy][cx];
                if (cell && cell.dw && cell.char === '') {
                    /* skip continuation cells for cursor */
                } else {
                    const cellW = (cell && cell.dw) ? cw * 2 : cw;
                    const cursorColor = this.getColor(7);

                    if (this.cursorStyle === 3 || this.cursorStyle === 4) {
                        ctx.fillStyle = cursorColor;
                        ctx.fillRect(cx * cw, cy * ch + ch - 2, cellW, 2);
                    } else {
                        ctx.fillStyle = cursorColor;
                        ctx.fillRect(cx * cw, cy * ch, cellW, ch);

                        if (cell && cell.char !== ' ' && cell.char !== '') {
                            let fgNum = cell.fg;
                            if (cell.inverse) {
                                fgNum = cell.bg;
                            }
                            const invColor = this.getColor(0);
                            ctx.fillStyle = invColor;
                            ctx.font = cell.bold
                                ? `bold ${ch}px 'UnifontTerm', monospace`
                                : `${ch}px 'UnifontTerm', monospace`;
                            ctx.fillText(cell.char, cx * cw, cy * ch);
                        }
                    }
                }
            }
        }

        ctx.imageSmoothingEnabled = true;
    }

    getScrollbackView() {
        const sb = this.scrollback;
        const offset = Math.min(this.scrollbackOffset, sb.length);
        const view = [];
        const sbStart = sb.length - offset;
        for (let i = sbStart; i < sb.length; i++) {
            view.push(sb[i]);
        }
        for (let i = 0; i < this.rows && i + offset < this.rows + offset; i++) {
            if (sbStart + i < sb.length) continue;
            const bi = i - (sb.length - sbStart);
            if (bi >= 0 && bi < this.buffer.length) {
                view.push(this.buffer[bi]);
            }
        }
        while (view.length < this.rows) {
            view.push(this.createRow());
        }
        return view.slice(0, this.rows);
    }

    scrollbackPush(row) {
        this.scrollback.push(row);
        if (this.scrollback.length > this.scrollbackMax) {
            this.scrollback.shift();
        }
    }

    scrollbackUp(lines) {
        const max = this.scrollback.length;
        this.scrollbackOffset = Math.min(this.scrollbackOffset + lines, max);
        this.dirty = true;
    }

    scrollbackDown(lines) {
        this.scrollbackOffset = Math.max(this.scrollbackOffset - lines, 0);
        this.dirty = true;
    }

    write(data) {
        for (let i = 0; i < data.length; i++) {
            this.processChar(data.charCodeAt(i));
        }
    }

    processChar(code) {
        switch (this.state) {
            case 'ground': return this.processGround(code);
            case 'escape': return this.processEscape(code);
            case 'csi':    return this.processCSI(code);
            case 'osc':    return this.processOSC(code);
            case 'oscStringEnd': return this.processOSCEnd(code);
            case 'charset': return this.processCharset(code);
            case 'dcs':    return this.processDCS(code);
        }
    }

    processGround(code) {
        if (code === 0x1B) { this.state = 'escape'; return; }
        if (code === 0x0A) { this.newLine(); return; }
        if (code === 0x0D) { this.carriageReturn(); return; }
        if (code === 0x08) { this.backspace(); return; }
        if (code === 0x09) { this.tab(); return; }
        if (code === 0x07) { return; }
        if (code === 0x0B || code === 0x0C) { this.newLine(); return; }
        if (code < 0x20) return;
        this.printChar(String.fromCharCode(code));
    }

    processEscape(code) {
        if (code === 0x5B) {
            this.state = 'csi';
            this.paramBuffer = '';
            this.params = [];
            this.privateMarker = '';
            return;
        }
        if (code === 0x5D) {
            this.state = 'osc';
            this.oscString = '';
            return;
        }
        if (code === 0x50) {
            this.state = 'dcs';
            this.paramBuffer = '';
            this.params = [];
            this.privateMarker = '';
            return;
        }
        if (code === 0x37) {
            this.savedCursor = { x: this.cursor.x, y: this.cursor.y, attr: { ...this.attr } };
            this.state = 'ground';
            return;
        }
        if (code === 0x38) {
            if (this.savedCursor && this.savedCursor.attr) {
                this.cursor.x = this.savedCursor.x;
                this.cursor.y = this.savedCursor.y;
                this.attr = { ...this.savedCursor.attr };
            }
            this.state = 'ground';
            return;
        }
        if (code === 0x63) {
            this.resetToInitial();
            this.state = 'ground';
            return;
        }
        if (code === 0x28 || code === 0x29 || code === 0x2A || code === 0x2B) {
            this.state = 'charset';
            this.paramBuffer = String.fromCharCode(code);
            return;
        }
        if (code === 0x4D) { this.reverseIndex(); this.state = 'ground'; return; }
        if (code === 0x44) { this.index(); this.state = 'ground'; return; }
        if (code === 0x45) { this.nextLine(); this.state = 'ground'; return; }
        if (code === 0x48) { this.setTabStop(); this.state = 'ground'; return; }
        if (code === 0x46) { this.cursor.x = 0; this.cursor.y = 0; this.state = 'ground'; return; }
        if (code === 0x4E) { this.state = 'ground'; return; }
        if (code === 0x4F) { this.state = 'ground'; return; }
        if (code === 0x3E) { this.state = 'ground'; return; }
        if (code === 0x3D) { this.state = 'ground'; return; }
        if (code === 0x3F) { this.state = 'ground'; return; }
        this.state = 'ground';
    }

    processCSI(code) {
        if (code >= 0x30 && code <= 0x39) {
            this.paramBuffer += String.fromCharCode(code);
            return;
        }
        if (code === 0x3B) {
            this.params.push(this.paramBuffer ? parseInt(this.paramBuffer) || 0 : 0);
            this.paramBuffer = '';
            return;
        }
        if (code === 0x3A) {
            this.params.push(-1);
            this.paramBuffer = '';
            return;
        }
        if (code === 0x3F) { this.privateMarker = '?'; return; }
        if (code === 0x3E) { this.privateMarker = '>'; return; }
        if (code === 0x21 || code === 0x22 || code === 0x23 || code === 0x24 || code === 0x25 || code === 0x26 || code === 0x27 || code === 0x2A || code === 0x2B) {
            return;
        }
        if (code >= 0x40 && code <= 0x7E) {
            this.params.push(this.paramBuffer ? parseInt(this.paramBuffer) || 0 : 0);
            const finalByte = String.fromCharCode(code);
            this.handleCSI(this.params, finalByte);
            this.state = 'ground';
            return;
        }
        this.state = 'ground';
    }

    processOSC(code) {
        if (code === 0x07) {
            this.handleOSC(this.oscString);
            this.state = 'ground';
            return;
        }
        if (code === 0x1B) {
            this.state = 'oscStringEnd';
            return;
        }
        if (code >= 0x20 && code <= 0x7E || code === 0x3B || code === 0x3A) {
            this.oscString += String.fromCharCode(code);
        }
    }

    processOSCEnd(code) {
        if (code === 0x5C) this.handleOSC(this.oscString);
        this.state = 'ground';
    }

    processCharset(code) {
        this.state = 'ground';
    }

    processDCS(code) {
        if (code >= 0x30 && code <= 0x39) {
            this.paramBuffer += String.fromCharCode(code);
            return;
        }
        if (code === 0x3B) {
            this.params.push(parseInt(this.paramBuffer) || 0);
            this.paramBuffer = '';
            return;
        }
        if (code >= 0x40 && code <= 0x7E) {
            this.params.push(parseInt(this.paramBuffer) || 0);
            this.handleDCS(this.params, String.fromCharCode(code));
            this.state = 'ground';
            return;
        }
        this.state = 'ground';
    }

    handleCSI(params, finalByte) {
        const p = (n, def) => (params && params.length > n && params[n] !== undefined) ? params[n] : def;
        const p0 = p(0, 1);
        const p1 = p(1, 1);

        switch (finalByte) {
            case 'A': this.cursorUp(p0); break;
            case 'B': this.cursorDown(p0); break;
            case 'C': this.cursorForward(p0); break;
            case 'D': this.cursorBack(p0); break;
            case 'E': this.cursorNextLine(p0); break;
            case 'F': this.cursorPrevLine(p0); break;
            case 'G': this.cursorHorizontalAbsolute(p0); break;
            case 'H': this.cursorPosition(p1, p0); break;
            case 'f': this.cursorPosition(p1, p0); break;
            case 'J': this.eraseDisplay(p0); break;
            case 'K': this.eraseLine(p0); break;
            case 'L': this.insertLines(p0); break;
            case 'M': this.deleteLines(p0); break;
            case 'P': this.deleteChars(p0); break;
            case '@': this.insertChars(p0); break;
            case 'X': this.eraseChars(p0); break;
            case 'S': this.scrollUp(p0); break;
            case 'T': this.scrollDown2(p0); break;
            case 'd': this.cursorLineAbsolute(p0); break;
            case 'e': this.cursorLineDown(p0); break;
            case 'm': this.setGraphicsRendition(params); break;
            case 'h': this.privateMarker === '?' ? this.setPrivateMode(params, true) : this.setMode(params, true); break;
            case 'l': this.privateMarker === '?' ? this.setPrivateMode(params, false) : this.setMode(params, false); break;
            case 's': this.savedCursor = { x: this.cursor.x, y: this.cursor.y, attr: { ...this.attr } }; break;
            case 'u': if (this.savedCursor && this.savedCursor.attr) { this.cursor.x = this.savedCursor.x; this.cursor.y = this.savedCursor.y; this.attr = { ...this.savedCursor.attr }; } break;
            case 'n': this.deviceStatusReport(p0); break;
            case 'c': this.deviceAttributes(); break;
            case 't': break;
            case 'q': this.cursorStyle = p0 || 1; break;
            case 'r': this.setScrollRegion(p1, p0); break;
        }
    }

    handleOSC(str) {
        const parts = str.split(';');
        const cmd = parseInt(parts[0]);
        const val = parts.slice(1).join(';');

        switch (cmd) {
            case 0: case 1: case 2:
                break;
            case 4:
                if (parts.length >= 3) {
                    const idx = parseInt(parts[1]);
                    const color = parts[2];
                    if (!isNaN(idx) && idx >= 0 && idx <= 255) {
                        this.setColorDirect(idx, color);
                    }
                }
                break;
            case 10:
                if (parts[1]) this.defaultFg = this.parseColor(parts[1]);
                break;
            case 11:
                if (parts[1]) this.defaultBg = this.parseColor(parts[1]);
                break;
        }
    }

    handleDCS(params, finalByte) {
    }

    setColorDirect(idx, colorStr) {
        if (colorStr.startsWith('#')) {
            if (idx < 16) this.colors[idx] = colorStr;
        } else if (colorStr.startsWith('rgb:')) {
            if (idx < 16) {
                const parts = colorStr.slice(4).split('/');
                if (parts.length === 3) {
                    const r = parseInt(parts[0], 16) * 17;
                    const g = parseInt(parts[1], 16) * 17;
                    const b = parseInt(parts[2], 16) * 17;
                    this.colors[idx] = `rgb(${r},${g},${b})`;
                }
            }
        }
    }

    parseColor(str) {
        if (str.startsWith('#')) return str;
        if (str.startsWith('rgb:')) {
            const parts = str.slice(4).split('/');
            if (parts.length === 3) {
                const r = parseInt(parts[0], 16) * 17;
                const g = parseInt(parts[1], 16) * 17;
                const b = parseInt(parts[2], 16) * 17;
                return `rgb(${r},${g},${b})`;
            }
        }
        return null;
    }

    resetToInitial() {
        this.cursor.x = 0;
        this.cursor.y = 0;
        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;
        this.originMode = false;
        this.autoWrap = true;
        this.insertMode = false;
        this.reverseVideo = false;
        this.applicationCursorKeys = false;
        this.cursorVisible = true;
        this.cursorStyle = 1;
        this.mouseMode = 0;
        this.mouseSGR = false;
        this.mousePixels = false;
        this.attr = { fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false };
        this.clearBuffer();
        this.dirty = true;
    }

    printChar(ch) {
        if (this.cursor.x >= this.cols) {
            if (this.autoWrap) {
                this.carriageReturn();
                this.newLine();
            } else {
                this.cursor.x = this.cols - 1;
            }
        }

        const wide = isWide(ch);
        const y = this.cursor.y;
        const x = this.cursor.x;
        const row = this.buffer[y];

        if (wide && x >= this.cols - 1) {
            this.carriageReturn();
            this.newLine();
        }

        if (this.insertMode) {
            for (let i = this.cols - 1; i > x; i--) {
                if (i > 0) {
                    row[i] = { ...row[i - 1] };
                }
            }
        }

        const cw = wide ? 2 : 1;
        row[x] = { char: ch, ...this.attr, dw: wide };
        if (wide && x + 1 < this.cols) {
            row[x + 1] = { char: '', fg: this.attr.fg, bg: this.attr.bg, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, dw: true };
        }

        this.cursor.x += cw;
        this.dirty = true;
    }

    newLine() {
        if (this.cursor.y >= this.scrollBottom) {
            this.scroll();
        } else {
            this.cursor.y++;
        }
        this.dirty = true;
    }

    carriageReturn() {
        this.cursor.x = 0;
        this.dirty = true;
    }

    backspace() {
        if (this.cursor.x > 0) {
            this.cursor.x--;
        }
        this.dirty = true;
    }

    tab() {
        for (let t = this.cursor.x + 1; t < this.cols; t++) {
            if (this.tabStops.has(t)) {
                this.cursor.x = t;
                this.dirty = true;
                return;
            }
        }
        this.cursor.x = this.cols - 1;
        this.dirty = true;
    }

    index() {
        if (this.cursor.y >= this.scrollBottom) {
            this.scroll();
        } else {
            this.cursor.y++;
        }
        this.dirty = true;
    }

    reverseIndex() {
        if (this.cursor.y <= this.scrollTop) {
            this.scrollDown();
        } else {
            this.cursor.y--;
        }
        this.dirty = true;
    }

    nextLine() {
        this.carriageReturn();
        this.index();
    }

    scroll() {
        const st = this.scrollTop;
        const sb = this.scrollBottom;
        const scrolledRow = this.buffer[st];
        this.scrollbackPush(scrolledRow);
        for (let y = st; y < sb; y++) {
            this.buffer[y] = this.buffer[y + 1];
        }
        this.buffer[sb] = this.createRow();
        this.dirty = true;
    }

    scrollDown() {
        const st = this.scrollTop;
        const sb = this.scrollBottom;
        for (let y = sb; y > st; y--) {
            this.buffer[y] = this.buffer[y - 1];
        }
        this.buffer[st] = this.createRow();
        this.dirty = true;
    }

    cursorUp(n) {
        n = Math.max(1, n || 1);
        this.cursor.y = Math.max(this.scrollTop, this.cursor.y - n);
        this.dirty = true;
    }

    cursorDown(n) {
        n = Math.max(1, n || 1);
        this.cursor.y = Math.min(this.scrollBottom, this.cursor.y + n);
        this.dirty = true;
    }

    cursorForward(n) {
        n = Math.max(1, n || 1);
        this.cursor.x = Math.min(this.cols - 1, this.cursor.x + n);
        this.dirty = true;
    }

    cursorBack(n) {
        n = Math.max(1, n || 1);
        this.cursor.x = Math.max(0, this.cursor.x - n);
        this.dirty = true;
    }

    cursorNextLine(n) {
        n = Math.max(1, n || 1);
        this.cursor.y = Math.min(this.scrollBottom, this.cursor.y + n);
        this.cursor.x = 0;
        this.dirty = true;
    }

    cursorPrevLine(n) {
        n = Math.max(1, n || 1);
        this.cursor.y = Math.max(this.scrollTop, this.cursor.y - n);
        this.cursor.x = 0;
        this.dirty = true;
    }

    cursorHorizontalAbsolute(n) {
        this.cursor.x = Math.max(0, Math.min(this.cols - 1, (n || 1) - 1));
        this.dirty = true;
    }

    cursorPosition(row, col) {
        const r = (row || 1) - 1;
        const c = (col || 1) - 1;
        if (this.originMode) {
            this.cursor.y = Math.max(this.scrollTop, Math.min(this.scrollBottom, this.scrollTop + r));
        } else {
            this.cursor.y = Math.max(0, Math.min(this.rows - 1, r));
        }
        this.cursor.x = Math.max(0, Math.min(this.cols - 1, c));
        this.dirty = true;
    }

    cursorLineAbsolute(n) {
        this.cursor.y = Math.max(0, Math.min(this.rows - 1, (n || 1) - 1));
        this.dirty = true;
    }

    cursorLineDown(n) {
        n = Math.max(1, n || 1);
        this.cursor.y = Math.min(this.rows - 1, this.cursor.y + n);
        this.dirty = true;
    }

    eraseDisplay(n) {
        n = n || 0;
        switch (n) {
            case 0:
                this.eraseFromCursorToEnd();
                break;
            case 1:
                this.eraseFromStartToCursor();
                break;
            case 2: case 3:
                for (let y = 0; y < this.rows; y++) {
                    for (let x = 0; x < this.cols; x++) {
                        this.buffer[y][x] = { char: ' ', fg: this.attr.fg, bg: this.attr.bg, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, dw: false };
                    }
                }
                break;
        }
        this.dirty = true;
    }

    eraseFromCursorToEnd() {
        const x = this.cursor.x, y = this.cursor.y;
        for (let cx = x; cx < this.cols; cx++) {
            this.buffer[y][cx] = { char: ' ', ...this.attr, dw: false };
        }
        for (let cy = y + 1; cy < this.rows; cy++) {
            for (let cx = 0; cx < this.cols; cx++) {
                this.buffer[cy][cx] = { char: ' ', ...this.attr, dw: false };
            }
        }
    }

    eraseFromStartToCursor() {
        const x = this.cursor.x, y = this.cursor.y;
        for (let cx = 0; cx <= x; cx++) {
            this.buffer[y][cx] = { char: ' ', ...this.attr, dw: false };
        }
        for (let cy = 0; cy < y; cy++) {
            for (let cx = 0; cx < this.cols; cx++) {
                this.buffer[cy][cx] = { char: ' ', ...this.attr, dw: false };
            }
        }
    }

    eraseLine(n) {
        n = n || 0;
        const y = this.cursor.y;
        switch (n) {
            case 0:
                for (let x = this.cursor.x; x < this.cols; x++) {
                    this.buffer[y][x] = { char: ' ', ...this.attr, dw: false };
                }
                break;
            case 1:
                for (let x = 0; x <= this.cursor.x; x++) {
                    this.buffer[y][x] = { char: ' ', ...this.attr, dw: false };
                }
                break;
            case 2:
                for (let x = 0; x < this.cols; x++) {
                    this.buffer[y][x] = { char: ' ', ...this.attr, dw: false };
                }
                break;
        }
        this.dirty = true;
    }

    insertChars(n) {
        n = Math.max(1, n || 1);
        const y = this.cursor.y;
        const x = this.cursor.x;
        const row = this.buffer[y];
        for (let i = this.cols - 1; i >= x + n; i--) {
            row[i] = { ...row[i - n] };
        }
        for (let i = x; i < Math.min(x + n, this.cols); i++) {
            row[i] = { char: ' ', fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, dw: false };
        }
        this.dirty = true;
    }

    deleteChars(n) {
        n = Math.max(1, n || 1);
        const y = this.cursor.y;
        const x = this.cursor.x;
        const row = this.buffer[y];
        for (let i = x; i < this.cols - n; i++) {
            row[i] = { ...row[i + n] };
        }
        for (let i = Math.max(x, this.cols - n); i < this.cols; i++) {
            row[i] = { char: ' ', fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, dw: false };
        }
        this.dirty = true;
    }

    insertLines(n) {
        n = Math.max(1, n || 1);
        const st = this.cursor.y;
        const sb = this.scrollBottom;
        if (st < this.scrollTop) return;
        if (st > sb) return;
        for (let i = 0; i < n; i++) {
            for (let y = sb; y > st; y--) {
                this.buffer[y] = this.buffer[y - 1];
            }
            this.buffer[st] = this.createRow();
        }
        this.dirty = true;
    }

    deleteLines(n) {
        n = Math.max(1, n || 1);
        const st = this.cursor.y;
        const sb = this.scrollBottom;
        if (st < this.scrollTop) return;
        if (st > sb) return;
        for (let i = 0; i < n; i++) {
            for (let y = st; y < sb; y++) {
                this.buffer[y] = this.buffer[y + 1];
            }
            this.buffer[sb] = this.createRow();
        }
        this.dirty = true;
    }

    eraseChars(n) {
        n = Math.max(1, n || 1);
        const y = this.cursor.y;
        const x = this.cursor.x;
        const row = this.buffer[y];
        for (let i = x; i < Math.min(x + n, this.cols); i++) {
            row[i] = { char: ' ', ...this.attr, dw: false };
        }
        this.dirty = true;
    }

    scrollUp(n) {
        n = Math.max(1, n || 1);
        for (let i = 0; i < n; i++) this.scroll();
        this.dirty = true;
    }

    scrollDown2(n) {
        n = Math.max(1, n || 1);
        for (let i = 0; i < n; i++) this.scrollDown();
        this.dirty = true;
    }

    setGraphicsRendition(params) {
        if (!params || params.length === 0) {
            params = [0];
        }
        for (let i = 0; i < params.length; i++) {
            const p = params[i];
            switch (p) {
                case 0:
                    this.attr = { fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false };
                    break;
                case 1: this.attr.bold = true; break;
                case 2: this.attr.dim = true; break;
                case 3: this.attr.italic = true; break;
                case 4: this.attr.underline = true; break;
                case 5: case 6: this.attr.blink = true; break;
                case 7: this.attr.inverse = true; break;
                case 8: this.attr.conceal = true; break;
                case 9: this.attr.crossedOut = true; break;
                case 21: case 22: this.attr.bold = false; this.attr.dim = false; break;
                case 23: this.attr.italic = false; break;
                case 24: this.attr.underline = false; break;
                case 25: this.attr.blink = false; break;
                case 27: this.attr.inverse = false; break;
                case 28: this.attr.conceal = false; break;
                case 29: this.attr.crossedOut = false; break;
                case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
                    this.attr.fg = p - 30;
                    break;
                case 38:
                    if (i + 2 < params.length && params[i + 1] === 5) {
                        this.attr.fg = params[i + 2];
                        i += 2;
                    } else if (i + 4 < params.length && params[i + 1] === 2) {
                        i += 4;
                    }
                    break;
                case 39:
                    this.attr.fg = 7;
                    break;
                case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
                    this.attr.bg = p - 40;
                    break;
                case 48:
                    if (i + 2 < params.length && params[i + 1] === 5) {
                        this.attr.bg = params[i + 2];
                        i += 2;
                    } else if (i + 4 < params.length && params[i + 1] === 2) {
                        i += 4;
                    }
                    break;
                case 49:
                    this.attr.bg = 0;
                    break;
                case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
                    this.attr.fg = p - 82;
                    break;
                case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107:
                    this.attr.bg = p - 92;
                    break;
            }
        }
        this.dirty = true;
    }

    setMode(params, state) {
    }

    setPrivateMode(params, state) {
        for (let i = 0; i < params.length; i++) {
            const p = params[i];
            switch (p) {
                case 1: this.applicationCursorKeys = state; break;
                case 3: break;
                case 6: this.originMode = state; if (state) { this.cursor.x = 0; this.cursor.y = this.scrollTop; } else { this.cursor.x = 0; this.cursor.y = 0; } break;
                case 7: this.autoWrap = state; break;
                case 12: this.cursorBlink = state; break;
                case 25: this.cursorVisible = state; break;
                case 47: break;
                case 1000: this.mouseMode = state ? 1000 : 0; this.updateMouseHandler(); break;
                case 1001: if (state) this.mouseMode = 1001; else this.mouseMode = 0; this.updateMouseHandler(); break;
                case 1002: this.mouseMode = state ? 1002 : 0; this.updateMouseHandler(); break;
                case 1003: this.mouseMode = state ? 1003 : 0; this.updateMouseHandler(); break;
                case 1006: this.mouseSGR = state; break;
                case 1016: this.mousePixels = state; break;
                case 2004: this.bracketedPaste = state; break;
                case 1047: case 1048: case 1049: break;
            }
        }
    }

    setScrollRegion(top, bottom) {
        const t = Math.max(0, Math.min(this.rows - 1, (top || 1) - 1));
        const b = Math.max(t + 1, Math.min(this.rows - 1, (bottom || this.rows) - 1));
        this.scrollTop = t;
        this.scrollBottom = b;
        this.cursor.x = 0;
        this.cursor.y = this.originMode ? this.scrollTop : 0;
        this.dirty = true;
    }

    deviceStatusReport(n) {
        if (n === 5 && this.onData) {
            this.onData('\x1B[0n');
        } else if (n === 6 && this.onData) {
            const row = this.cursor.y + 1;
            const col = this.cursor.x + 1;
            this.onData(`\x1B[${row};${col}R`);
        }
    }

    deviceAttributes() {
        if (this.onData) {
            this.onData('\x1B[?1;2c');
        }
    }

    setTabStop() {
        this.tabStops.add(this.cursor.x);
    }

    clearTabStop() {
        this.tabStops.delete(this.cursor.x);
    }

    clearAllTabStops() {
        this.tabStops.clear();
    }

    updateMouseHandler() {
        const enabled = this.mouseMode > 0;
        if (enabled !== this.mouseTracking) {
            this.mouseTracking = enabled;
            this.mouseBtn = 0;
        }
    }

    bindEvents() {
        this._keyHandler = this.handleKeyDown.bind(this);
        this._beforeInputHandler = this.handleBeforeInput.bind(this);
        this._inputHandler = this.handleInput.bind(this);
        this._wheelHandler = this.handleWheel.bind(this);
        this._mouseDownHandler = this.handleMouseDown.bind(this);
        this._mouseUpHandler = this.handleMouseUp.bind(this);
        this._mouseMoveHandler = this.handleMouseMove.bind(this);
        this._contextHandler = (e) => e.preventDefault();
        this._pasteHandler = this.handlePaste.bind(this);
        this._compEndHandler = this.handleCompositionEnd.bind(this);
        this._compStartHandler = () => { this._isComposing = true; };

        this.textarea.addEventListener('keydown', this._keyHandler);
        this.textarea.addEventListener('beforeinput', this._beforeInputHandler);
        this.textarea.addEventListener('input', this._inputHandler);
        this.textarea.addEventListener('compositionend', this._compEndHandler);
        this.textarea.addEventListener('compositionstart', this._compStartHandler);
        this.textarea.addEventListener('paste', this._pasteHandler);
        this.canvas.addEventListener('wheel', this._wheelHandler, { passive: true });
        this.canvas.addEventListener('mousedown', this._mouseDownHandler);
        document.addEventListener('mouseup', this._mouseUpHandler);
        document.addEventListener('mousemove', this._mouseMoveHandler);
        this.canvas.addEventListener('contextmenu', this._contextHandler);
    }

    destroy() {
        this.textarea.removeEventListener('keydown', this._keyHandler);
        this.textarea.removeEventListener('beforeinput', this._beforeInputHandler);
        this.textarea.removeEventListener('input', this._inputHandler);
        this.textarea.removeEventListener('compositionend', this._compEndHandler);
        this.textarea.removeEventListener('compositionstart', this._compStartHandler);
        this.textarea.removeEventListener('paste', this._pasteHandler);
        this.canvas.removeEventListener('wheel', this._wheelHandler);
        this.canvas.removeEventListener('mousedown', this._mouseDownHandler);
        document.removeEventListener('mouseup', this._mouseUpHandler);
        document.removeEventListener('mousemove', this._mouseMoveHandler);
        this.canvas.removeEventListener('contextmenu', this._contextHandler);
        this.textarea.remove();
        this.stopRenderLoop();
    }

    handleKeyDown(e) {
        if (!this.onData) return;
        if (document.activeElement !== this.textarea) return;
        if (this._isComposing || e.isComposing) return;
        if (e.ctrlKey && e.key === ' ') return;

        const key = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const alt = e.altKey;
        const shift = e.shiftKey;

        if (ctrl && key === 'v') return;

        if (ctrl && (key === 'c' || key === 'C')) {
            if (this.mouseMode > 0 && this.mouseSGR) return;
            this.onData('\x03');
            e.preventDefault();
            this.clearTextarea();
            return;
        }

        if (ctrl && key === 'z') { this.onData('\x1A'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'd') { this.onData('\x04'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'a') { this.onData('\x01'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'e') { this.onData('\x05'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'l') { this.onData('\x0C'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'u') { this.onData('\x15'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'k') { this.onData('\x0B'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'w') { this.onData('\x17'); e.preventDefault(); this.clearTextarea(); return; }
        if (ctrl && key === 'r') { this.onData('\x12'); e.preventDefault(); this.clearTextarea(); return; }

        if (key === 'Enter') { this.onData('\r'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'Backspace') { this.onData('\x7F'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'Tab') { this.onData(shift ? '\x1B[Z' : '\t'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'Escape') { this.onData('\x1B'); e.preventDefault(); this.clearTextarea(); return; }

        if (key === 'ArrowUp') { this.onData(this.applicationCursorKeys ? '\x1BOA' : '\x1B[A'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'ArrowDown') { this.onData(this.applicationCursorKeys ? '\x1BOB' : '\x1B[B'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'ArrowRight') { this.onData(this.applicationCursorKeys ? '\x1BOC' : '\x1B[C'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'ArrowLeft') { this.onData(this.applicationCursorKeys ? '\x1BOD' : '\x1B[D'); e.preventDefault(); this.clearTextarea(); return; }

        if (key === 'Home') { this.onData('\x1B[H'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'End') { this.onData('\x1B[F'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'Insert') { this.onData('\x1B[2~'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'Delete') { this.onData('\x1B[3~'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'PageUp') { this.onData('\x1B[5~'); e.preventDefault(); this.clearTextarea(); return; }
        if (key === 'PageDown') { this.onData('\x1B[6~'); e.preventDefault(); this.clearTextarea(); return; }

        if (key.startsWith('F') && key.length <= 3) {
            const fnum = parseInt(key.slice(1));
            const fMap = {
                1: '\x1BOP', 2: '\x1BOQ', 3: '\x1BOR', 4: '\x1BOS',
                5: '\x1B[15~', 6: '\x1B[17~', 7: '\x1B[18~', 8: '\x1B[19~',
                9: '\x1B[20~', 10: '\x1B[21~', 11: '\x1B[23~', 12: '\x1B[24~',
            };
            if (fMap[fnum]) { this.onData(fMap[fnum]); e.preventDefault(); this.clearTextarea(); return; }
        }

        if (ctrl && key.length === 1) {
            const code = key.toUpperCase().charCodeAt(0);
            if (code >= 65 && code <= 90) {
                this.onData(String.fromCharCode(code - 64));
                e.preventDefault();
                this.clearTextarea();
                return;
            }
        }

        if (alt && key.length === 1) {
            this.onData('\x1B' + key);
            e.preventDefault();
            this.clearTextarea();
            return;
        }

        if (key.length === 1) return;
    }

    clearTextarea() {
        this.textarea.value = '';
    }

    handleBeforeInput(e) {
        if (this._isComposing) return;
        if (!this.onData || !e.data) return;
        if (e.inputType === 'insertText') {
            this.onData(e.data);
            e.preventDefault();
            this.clearTextarea();
        }
    }

    handleInput(e) {
        if (this._isComposing) return;
        if (!this.onData) return;
        const val = this.textarea.value;
        if (!val) return;
        this.onData(val);
        this.clearTextarea();
    }

    handleCompositionEnd(e) {
        this._isComposing = false;
        if (!this.onData) return;
        if (e.data) this.onData(e.data);
        this.clearTextarea();
    }

    handlePaste(e) {
        if (!this.onData) return;
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        if (!text) return;
        if (this.bracketedPaste) {
            this.onData('\x1B[200~' + text + '\x1B[201~');
        } else {
            this.onData(text);
        }
        this.clearTextarea();
    }

    handleWheel(e) {
        if (e.deltaY < 0) {
            this.scrollbackUp(3);
        } else {
            this.scrollbackDown(3);
        }
        this.dirty = true;
    }

    handleMouseDown(e) {
        this.textarea.focus();
        if (!this.onData || this.mouseMode === 0) return;
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const col = Math.floor(x / this.cw);
        const row = Math.floor(y / this.ch);
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
            this.sendMouseEvent('M', btn, col + 1, row + 1);
        }
    }

    handleMouseUp(e) {
        if (!this.onData || this.mouseMode === 0) return;
        if (this.mouseMode === 1000 || this.mouseMode === 1002 || this.mouseMode === 1003) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const col = Math.floor(x / this.cw);
            const row = Math.floor(y / this.ch);
            if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
            if (this.mouseMode === 9) return;

            const btn = this.mouseBtn + 32;
            this.sendMouseEvent('m', btn, col + 1, row + 1);
        }
        this.mouseBtn = 0;
    }

    handleMouseMove(e) {
        if (!this.onData || this.mouseMode === 0) return;
        if (this.mouseMode !== 1002 && this.mouseMode !== 1003) return;
        if (this.mouseBtn === 0 && this.mouseMode !== 1003) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const col = Math.floor(x / this.cw);
        const row = Math.floor(y / this.ch);
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
        if (col === this.mouseX && row === this.mouseY) return;

        this.mouseX = col;
        this.mouseY = row;

        const btn = this.mouseBtn + 32;
        this.sendMouseEvent('M', btn, col + 1, row + 1);
    }

    sendMouseEvent(type, btn, col, row) {
        if (!this.onData) return;
        if (this.mouseSGR) {
            this.onData(`\x1B[<${btn};${col};${row}${type}`);
        } else {
            const cb = (btn & 3) | (btn & 4 ? 4 : 0) | (btn & 8 ? 8 : 0) | (btn & 16 ? 16 : 0);
            const cc = Math.min(col + 32, 255);
            const cr = Math.min(row + 32, 255);
            this.onData(`\x1B[M${String.fromCharCode(cb)}${String.fromCharCode(cc)}${String.fromCharCode(cr)}`);
        }
    }

    resize(cols, rows) {
        const newBuffer = [];
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                if (y < this.rows && x < this.cols && this.buffer[y] && this.buffer[y][x]) {
                    row.push({ ...this.buffer[y][x] });
                } else {
                    row.push({ char: ' ', fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, dw: false });
                }
            }
            newBuffer.push(row);
        }

        this.cols = cols;
        this.rows = rows;
        this.buffer = newBuffer;
        this.scrollBottom = rows - 1;
        this.cursor.x = Math.min(this.cursor.x, cols - 1);
        this.cursor.y = Math.min(this.cursor.y, rows - 1);

        this.canvas.width = cols * this.cw;
        this.canvas.height = rows * this.ch;

        this.dirty = true;

        if (this.onResize) this.onResize(cols, rows);
    }
}

class DemoShell {
    constructor(term) {
        this.term = term;
        this.line = '';
        this.history = [];
        this.historyPos = -1;
        this.prompt = '$ ';
        this.promptShown = false;
        this.running = false;

        this.commands = {
            help: () => {
                this.print('\x1B[1;33mAvailable commands:\x1B[0m\n');
                this.print('  help       Show this help\n');
                this.print('  clear      Clear the screen\n');
                this.print('  echo       Echo text\n');
                this.print('  date       Show current date/time\n');
                this.print('  uname      Show system info\n');
                this.print('  neofetch   Show system information (lite)\n');
                this.print('  cowsay     Let a cow speak\n');
                this.print('  ascii      Show ANSI color chart\n');
                this.print('  fortune    Show a fortune\n');
                this.print('  calc       Simple calculator\n');
                this.print('  exit       Exit (just for fun)\n');
                this.print('  whoami     Show user\n');
            },
            clear: () => {
                this.term.write('\x1B[2J\x1B[H');
            },
            echo: (args) => {
                this.print(args.join(' ') + '\n');
            },
            date: () => {
                this.print(new Date().toString() + '\n');
            },
            uname: () => {
                this.print('OpenCode Terminal v1.0.0\n');
            },
            neofetch: () => {
                this.print('\x1B[1;36m  OpenCodeTerm\x1B[0m\n');
                this.print('\x1B[1;34m  -----------\x1B[0m\n');
                this.print('  OS:     HTML5 + CSS3 + ES2024\n');
                this.print('  Host:   Web Browser\n');
                this.print('  Font:   Unifont 8\xC3\x9716\n');
                this.print('  Shell:  DemoShell v1.0\n');
                this.print('  Theme:  Green on Black\n');
                this.print('  \x1B[1;32m\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\xE2\x96\x88\x1B[0m\n');
            },
            cowsay: (args) => {
                const text = args.join(' ') || 'Moo!';
                const len = text.length;
                const border = '_'.repeat(len + 2);
                const top = ' ' + border;
                const mid = '< ' + text + ' >';
                const bot = ' ' + '_'.repeat(len + 2);
                const cow = '        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n';
                this.print(top + '\n' + mid + '\n' + bot + '\n' + cow);
            },
            ascii: () => {
                this.print('\x1B[1mStandard 16 ANSI Colors:\x1B[0m\n');
                for (let bg = 0; bg < 16; bg++) {
                    this.print(`\x1B[48;5;${bg}m  \x1B[0m`);
                    if (bg % 8 === 7) this.print('\n');
                }
                this.print('\n\x1B[1mColor Cube (sample):\x1B[0m\n');
                for (let g = 0; g < 6; g++) {
                    for (let r = 0; r < 6; r++) {
                        const c = 16 + r + g * 36;
                        this.print(`\x1B[48;5;${c}m  \x1B[0m`);
                    }
                    this.print('  ');
                    for (let b = 0; b < 6; b++) {
                        const c = 16 + b * 6 + g;
                        this.print(`\x1B[48;5;${c}m  \x1B[0m`);
                    }
                    this.print('\n');
                }
            },
            fortune: () => {
                const fortunes = [
                    'A terminal emulator is never late, nor is it early.\nIt renders precisely when it means to.',
                    '42 is the answer. But what was the question again?',
                    'The Endless Loop: n.; see Loop, Endless.\nLoop, Endless: n.; see Endless Loop.',
                    'In a world of GUIs, be a terminal.',
                    'There is no place like ~',
                    'Have you tried turning it off and on again?',
                    '> make me a sandwich\n  What? I don\'t know how to make a sandwich.\n  > sudo make me a sandwich\n  Okay.',
                    'A journey of a thousand miles begins with\na single step. Or a single keystroke.',
                ];
                this.print(fortunes[Math.floor(Math.random() * fortunes.length)] + '\n');
            },
            calc: (args) => {
                try {
                    const expr = args.join(' ');
                    const result = Function('"use strict"; return (' + expr + ')')();
                    this.print(String(result) + '\n');
                } catch (e) {
                    this.print('Error: invalid expression\n');
                }
            },
            exit: () => {
                this.print('Goodbye!\n');
            },
            whoami: () => {
                this.print('user\n');
            },
        };

        this.start();
    }

    start() {
        this.running = true;
        this.print('\x1B[2J\x1B[H');
        this.print('\x1B[1;32mOpenCode Terminal v1.0.0\x1B[0m\n');
        this.print('Type \x1B[33mhelp\x1B[0m for available commands.\n\n');
        this.showPrompt();
    }

    showPrompt() {
        this.term.write(this.prompt);
        this.promptShown = true;
        this.line = '';
        this.historyPos = -1;
    }

    handleInput(data) {
        if (!this.running) return;

        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;

            if (code === 0x03) {
                this.term.write('^C\n');
                this.showPrompt();
                continue;
            }

            if (code === 0x04) {
                if (this.line.length === 0) {
                    this.term.write('exit\n');
                    this.showPrompt();
                }
                continue;
            }

            if (code === 0x0C) {
                this.term.write('\x1B[2J\x1B[H');
                this.term.write(this.prompt + this.line);
                continue;
            }

            if (code === 0x0D || code === 0x0A) {
                this.term.write('\r\n');
                this.execute(this.line);
                this.showPrompt();
                continue;
            }

            if (code === 0x7F || code === 0x08) {
                if (this.line.length > 0) {
                    this.line = this.line.slice(0, -1);
                    this.term.write('\b \b');
                }
                continue;
            }

            if (code === 0x09) {
                const completions = Object.keys(this.commands).filter(cmd => cmd.startsWith(this.line));
                if (completions.length === 1) {
                    const rest = completions[0].slice(this.line.length);
                    this.line = completions[0];
                    this.term.write(rest);
                } else if (completions.length > 1) {
                    this.term.write('\r\n');
                    this.term.write(completions.join('  ') + '\n');
                    this.term.write(this.prompt + this.line);
                }
                continue;
            }

            if (code === 0x1B) {
                if (data[i + 1] === '[' || data[i + 1] === 'O') {
                    const seq = data.slice(i, i + 3);
                    if (seq === '\x1B[A') {
                        if (this.history.length > 0) {
                            if (this.historyPos === -1) this.historyPos = this.history.length - 1;
                            else if (this.historyPos > 0) this.historyPos--;
                            const newLine = this.history[this.historyPos];
                            const diff = this.line.length;
                            this.term.write('\b \b'.repeat(diff));
                            this.line = newLine;
                            this.term.write(newLine);
                        }
                        i += 2;
                        continue;
                    }
                    if (seq === '\x1B[B') {
                        if (this.historyPos >= 0) {
                            this.historyPos++;
                            const diff = this.line.length;
                            this.term.write('\b \b'.repeat(diff));
                            if (this.historyPos >= this.history.length) {
                                this.line = '';
                                this.historyPos = -1;
                            } else {
                                this.line = this.history[this.historyPos];
                                this.term.write(this.line);
                            }
                        }
                        i += 2;
                        continue;
                    }
                    if (seq === '\x1B[C' || seq === '\x1B[D') {
                        i += 2;
                        continue;
                    }
                }
                continue;
            }

            if (code >= 0x20) {
                this.line += ch;
                this.term.write(ch);
            }
        }
    }

    execute(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        this.history.push(trimmed);
        if (this.history.length > 100) this.history.shift();

        const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        const cmd = parts[0] ? parts[0].toLowerCase() : '';
        const args = parts.slice(1).map(a => a.replace(/^"(.*)"$/, '$1'));

        const handler = this.commands[cmd];
        if (handler) {
            handler(args);
        } else {
            this.print(`\x1B[91mCommand not found: ${cmd}\x1B[0m\n`);
            this.print(`Try '\x1B[33mhelp\x1B[0m'.\n`);
        }
    }

    print(text) {
        this.term.write(text);
    }
}
