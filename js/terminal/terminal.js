import { Screen } from './Screen.js';
import { Parser } from './Parser.js';
import { Renderer } from './Renderer.js';
import { DEFAULT_COLS, DEFAULT_ROWS } from '../util/constants.js';
import { warn } from '../util/sgr.js';

export class Terminal {
    constructor(container, opts = {}) {
        this.onData = null;
        this.onResize = null;

        this.screen = new Screen(opts.cols || DEFAULT_COLS, opts.rows || DEFAULT_ROWS);
        this.parser = new Parser(this.screen, {
            onSend: (data) => this._send(data),
        });
        this.renderer = new Renderer(container, this.screen, opts);
        this.container = container;

        this.textarea = document.getElementById('hidden-input');
        this._isComposing = false;
        this.onMouse = null;
        this.mouseBtn = 0;
        this.mouseX = 0;
        this.mouseY = 0;

        this._bindEvents();
        this._initResizeListener();
        this.renderer.fitToViewport();

        if (!opts.noAutoRender) this.renderer.startRenderLoop();
    }

    get cols() { return this.screen.cols; }
    get rows() { return this.screen.rows; }
    get curX() { return this.screen.curX; }
    set curX(v) { this.screen.curX = v; }
    get curY() { return this.screen.curY; }
    set curY(v) { this.screen.curY = v; }
    get viewOffset() { return this.screen.viewOffset; }
    set viewOffset(v) { this.screen.viewOffset = v; }
    get overlays() { return this.screen.overlays; }
    addOverlay(ov) { this.screen.addOverlay(ov); }
    removeOverlay(ov) { this.screen.removeOverlay(ov); }
    get charWidth() { return this.renderer.charWidth; }
    get charHeight() { return this.renderer.charHeight; }
    get cursorHidden() { return this.screen.cursorHidden; }
    set cursorHidden(v) { this.screen.cursorHidden = v; }
    get modes() { return this.screen.modes; }
    get mouseMode() { return this.screen.mouseMode; }
    set mouseMode(v) { this.screen.mouseMode = v; }
    markRowDirty(r) { this.screen.markRowDirty(r); }
    isWide(ch) { return this.screen.isWide(ch); }

    write(data) { this.parser.write(data); }

    focus() {
        this._focusInput();
    }

    scrollbackUp(n) { this.screen.scrollbackUp(n); }
    scrollbackDown(n) { this.screen.scrollbackDown(n); }

    resize(cols, rows) {
        this.screen.resize(cols, rows);
        this.renderer.resizeDOM(cols, rows);
        if (this.onResize) this.onResize(cols, rows);
    }

    dispose() {
        document.removeEventListener('keydown', this._keydownHandler);
        this.textarea.removeEventListener('beforeinput', this._beforeInputHandler);
        document.removeEventListener('keyup', this._keyupHandler);
        this.textarea.removeEventListener('compositionstart', this._compStartHandler);
        this.textarea.removeEventListener('compositionend', this._compEndHandler);
        this.textarea.removeEventListener('paste', this._pasteHandler);
        this.container.removeEventListener('wheel', this._wheelHandler);
        this.container.removeEventListener('mousedown', this._mouseDownHandler);
        document.removeEventListener('mouseup', this._mouseUpHandler);
        document.removeEventListener('mousemove', this._mouseMoveHandler);
        this.container.removeEventListener('contextmenu', this._contextHandler);
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        this.renderer.stopRenderLoop();
    }

    _send(data) {
        if (this.viewOffset > 0) {
            this.viewOffset = 0;
            this.screen.markAllDirty();
        }
        if (this.onData) this.onData(data);
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

        if (this._handleCopyPaste(e, key, ctrl, shift)) return;
        if (this._handleCtrlLetter(e, key, ctrl, shift)) return;

        if (ctrl && key === 'Backspace') { this._send('\x08'); e.preventDefault(); return; }
        if (alt && key === 'Backspace') { this._send('\x1B\x7F'); e.preventDefault(); return; }
        if (alt && key === 'Enter') { this._send('\x1B\r'); e.preventDefault(); return; }

        if (key === 'Backspace') { this._send('\x7F'); e.preventDefault(); return; }
        if (key === 'Enter') { this._send('\r'); e.preventDefault(); return; }
        if (key === 'Tab') { this._send(shift ? '\x1B[Z' : '\t'); e.preventDefault(); return; }
        if (key === 'Escape') { this._send('\x1B'); e.preventDefault(); return; }

        if (this._handleFunctionKeys(e, key, ctrl, shift, alt)) return;

        if (key && key.length === 1 && !ctrl && !alt && !e.metaKey) {
            if (document.activeElement !== this.textarea) {
                this._send(key);
                e.preventDefault();
            }
            return;
        }

        if (alt && !ctrl && key && key.length === 1) {
            this._send('\x1B' + key);
            e.preventDefault();
            return;
        }

        if (ctrl && shift && (key === '+' || key === '=')) {
            this.viewOffset = Math.max(0, this.viewOffset - 1);
            this.screen.markAllDirty();
            e.preventDefault(); return;
        }
        if (ctrl && key === '-') {
            this.viewOffset = Math.min(this.screen.maxViewOffset(), this.viewOffset + 1);
            this.screen.markAllDirty();
            e.preventDefault(); return;
        }
    }

    _handleCopyPaste(e, key, ctrl, shift) {
        if ((ctrl && key === 'Insert') || (ctrl && shift && key.toLowerCase() === 'c')) {
            e.preventDefault();
            const sel = document.getSelection().toString();
            if (!sel) return true;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(sel).catch(() => {
                    warn('clipboard write failed');
                });
            } else {
                const ta = document.createElement('textarea');
                ta.value = sel;
                ta.className = 'clip-helper';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            return true;
        }
        if ((shift && key === 'Insert') || (ctrl && shift && key.toLowerCase() === 'v')) {
            if (navigator.clipboard) {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    if (text) this._send(text);
                }).catch(() => {
                    warn('clipboard read failed');
                });
            }
            return true;
        }
        return false;
    }

    _handleCtrlLetter(e, key, ctrl, shift) {
        if (!ctrl || shift) return false;
        const map = {
            c: '\x03', z: '\x1A', d: '\x04', a: '\x01', e: '\x05',
            l: '\x0C', u: '\x15', k: '\x0B', w: '\x17', r: '\x12',
            h: '\x08', t: '\x14', y: '\x19', n: '\x0E', f: '\x06',
            b: '\x02', o: '\x0F', x: '\x18',
        };
        const code = map[key];
        if (code) {
            this._send(code);
            e.preventDefault();
            return true;
        }
        return false;
    }

    _handleFunctionKeys(e, key, ctrl, shift, alt) {
        let mod = 1;
        if (ctrl && shift && alt) mod = 8;
        else if (ctrl && alt) mod = 7;
        else if (ctrl && shift) mod = 6;
        else if (ctrl) mod = 5;
        else if (alt && shift) mod = 4;
        else if (alt) mod = 3;
        else if (shift) mod = 2;

        const navMap = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' };
        const tildeMap = { Insert: '2', Delete: '3', PageUp: '5', PageDown: '6' };

        const dir = navMap[key];
        if (dir) {
            if (mod === 1) {
                const isAppCursor = key.startsWith('Arrow') && this.modes.applicationCursorKeys;
                this._send(isAppCursor ? '\x1BO' + dir : '\x1B[' + dir);
            } else {
                this._send(`\x1B[1;${mod}${dir}`);
            }
            e.preventDefault(); return true;
        }

        const tilde = tildeMap[key];
        if (tilde) {
            this._send(mod === 1 ? `\x1B[${tilde}~` : `\x1B[${tilde};${mod}~`);
            e.preventDefault(); return true;
        }

        return false;
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

    _focusInput() {
        this.textarea.focus();
        this.textarea.value = '';
    }

    _initResizeListener() {
        this._resizeRafId = null;
        this._resizeHandler = () => {
            cancelAnimationFrame(this._resizeRafId);
            this._resizeRafId = requestAnimationFrame(() => this.renderer.fitToViewport());
        };
        window.addEventListener('resize', this._resizeHandler);
    }

    _onWheel(e) {
        if (e.deltaY < 0) this.scrollbackUp(3);
        else this.scrollbackDown(3);
    }

    _onMouseDown(e) {
        this._focusInput();

        const info = this._mouseInfo(e);
        if (info.col < 0 || info.col >= this.cols || info.row < 0 || info.row >= this.rows) return;

        if (this.onMouse && this.onMouse('mousedown', info)) {
            e.preventDefault();
            this.mouseBtn = info.btn;
            this.mouseX = info.col;
            this.mouseY = info.row;
            return;
        }

        if (!this.onData || this.mouseMode === 0) return;
        e.preventDefault();

        this.mouseBtn = info.btn;
        this.mouseX = info.col;
        this.mouseY = info.row;

        if (this.mouseMode === 9 || this.mouseMode === 1000 || this.mouseMode === 1002 || this.mouseMode === 1003) {
            this._sendMouseEvent('M', info.btn, info.col + 1, info.row + 1);
        }
    }

    _onMouseUp(e) {
        const info = this._mouseInfo(e);

        if (this.onMouse && this.onMouse('mouseup', info)) {
            e.preventDefault();
            return;
        }

        if (!this.onData || this.mouseMode === 0) return;
        if (this.mouseMode === 1000 || this.mouseMode === 1002 || this.mouseMode === 1003) {
            if (info.col < 0 || info.col >= this.cols || info.row < 0 || info.row >= this.rows) return;
            if (this.mouseMode === 9) return;
            this._sendMouseEvent('m', this.mouseBtn, info.col + 1, info.row + 1);
        }
        this.mouseBtn = 0;
    }

    _onMouseMove(e) {
        const info = this._mouseInfo(e);

        if (this.onMouse && this.onMouse('mousemove', info)) {
            return;
        }

        if (!this.onData || this.mouseMode !== 1003) return;
        if (info.col < 0 || info.col >= this.cols || info.row < 0 || info.row >= this.rows) return;
        this._sendMouseEvent('M', this.mouseBtn, info.col + 1, info.row + 1);
    }

    _mouseInfo(e) {
        const rect = this.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        let btn = 0;
        if (e.button === 0) btn = 0;
        else if (e.button === 1) btn = 1;
        else if (e.button === 2) btn = 2;
        if (e.shiftKey) btn += 4;
        if (e.altKey) btn += 8;
        if (e.ctrlKey) btn += 16;
        return {
            btn,
            col: Math.floor(x / this.renderer.charWidth),
            row: Math.floor(y / this.renderer.charHeight),
        };
    }

    _sendMouseEvent(prefix, btn, col, row) {
        if (this.mouseMode === 1006) {
            this._send(`\x1B[<${btn};${col};${row}${prefix}`);
        } else {
            const ev = (prefix === 'm') ? btn + 64 : btn + 32;
            this._send('\x1B[' + prefix + String.fromCharCode(ev) + String.fromCharCode(col + 32) + String.fromCharCode(row + 32));
        }
    }
}
