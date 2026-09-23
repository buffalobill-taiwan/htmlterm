import { CURSOR_HIDE, CURSOR_SHOW, skipEscapeSeq } from '../util/sgr.js';

export class Typewriter {
    constructor(term) {
        this.term = term;
        this._queue = [];
        this._head = 0;
        this._rafId = null;
        this._drainCallbacks = [];
        this._active = false;
        this._disposed = false;
        this._speed = { wide: 2, half: 1 };
        this._lastFrameTime = 0;
        this._accumulator = 0;
    }

    isActive() { return this._active; }

    enqueue(text) {
        if (this._disposed || !text) return;
        const tokens = this._tokenize(text);

        const expanded = [];
        let big = false;
        for (const t of tokens) {
            if (t.type === 'seq') {
                const d = this._sgrBig(t.text);
                if (d === true || d === false) big = d;
                expanded.push(t);
            } else if (t.type === 'nl') {
                expanded.push({ type: 'char', ch: '\n', wide: false, big: false });
            } else {
                for (const ch of t.text) {
                    const wide = this.term.isWide(ch);
                    expanded.push({ type: 'char', ch, wide, big });
                }
            }
        }

        this._queue.push(...expanded);
        this._start();
    }

    abort() {
        if (this._disposed) return;
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        let out = '';
        for (let i = this._head; i < this._queue.length; i++) {
            const item = this._queue[i];
            if (item.type === 'seq') out += item.text;
            else out += item.ch;
        }
        this._queue = [];
        this._head = 0;
        this._active = false;
        if (out) this.term.write(out);
        this._flushDrain();
    }

    onDrain(callback) {
        if (this._disposed) return;
        this._drainCallbacks.push(callback);
    }

    removeOnDrain(callback) {
        const i = this._drainCallbacks.indexOf(callback);
        if (i >= 0) this._drainCallbacks.splice(i, 1);
    }

    dispose() {
        if (this._rafId !== null) cancelAnimationFrame(this._rafId);
        this._rafId = null;
        this._queue = [];
        this._head = 0;
        this._active = false;
        this._drainCallbacks = [];
        this._disposed = true;
    }

    _tokenize(text) {
        const tokens = [];
        let i = 0;
        let visible = '';
        const flushVisible = () => {
            if (!visible) return;
            tokens.push({ type: 'text', text: visible });
            visible = '';
        };

        while (i < text.length) {
            const code = text.charCodeAt(i);

            if (code === 0x1B) {
                flushVisible();
                const start = i;
                i = skipEscapeSeq(text, i);
                tokens.push({ type: 'seq', text: text.slice(start, i) });

            } else if (code === 0x0A) {
                flushVisible();
                tokens.push({ type: 'nl' });
                i++;
            } else {
                visible += text[i];
                i++;
            }
        }

        flushVisible();
        return tokens;
    }

    _sgrBig(text) {
        const m = /^\x1B\[([0-9;]*)m$/.exec(text);
        if (!m) return null;
        const params = m[1] === '' ? ['0'] : m[1].split(';');
        let out;
        for (const p of params) {
            if (p === '0') out = false;
            else if (p === '500') out = true;
            else if (p === '501') out = false;
        }
        return out === undefined ? undefined : out;
    }

    _start() {
        if (this._active || this._queue.length === 0) return;
        this._active = true;
        this._lastFrameTime = performance.now();
        this._accumulator = 0;
        this.term.write(CURSOR_HIDE);
        this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    _tick(timestamp) {
        if (this._disposed) {
            this._rafId = null;
            return;
        }
        const elapsed = timestamp - this._lastFrameTime;
        this._lastFrameTime = timestamp;
        this._accumulator += elapsed;

        let out = '';
        while (this._head < this._queue.length) {
            const item = this._queue[this._head];
            const delay = item.type === 'seq' ? 0
                : (item.wide ? this._speed.wide : this._speed.half)
                    * (item.big ? 4 : 1);

            if (delay > this._accumulator) break;

            this._accumulator -= delay;
            this._head++;
            if (item.type === 'seq') out += item.text;
            else out += item.ch;
        }

        if (out) this.term.write(out);

        if (this._head < this._queue.length) {
            this._rafId = requestAnimationFrame(t => this._tick(t));
        } else {
            this._queue = [];
            this._head = 0;
            this._active = false;
            this._rafId = null;
            this._flushDrain();
        }
    }

    _flushDrain() {
        this.term.write(CURSOR_SHOW);
        for (const cb of this._drainCallbacks.slice()) cb();
    }
}
