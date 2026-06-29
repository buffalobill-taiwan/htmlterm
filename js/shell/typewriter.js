import { CURSOR_HIDE, CURSOR_SHOW, skipEscapeSeq } from '../util/sgr.js';

export class Typewriter {
    constructor(term) {
        this.term = term;
        this._queue = [];
        this._rafId = null;
        this._drainCallbacks = [];
        this._active = false;
        this._speed = { wide: 2, half: 1 };
        this._lastFrameTime = 0;
        this._accumulator = 0;
    }

    isActive() { return this._active; }

    enqueue(text) {
        if (!text) return;
        const tokens = this._tokenize(text);

        const merged = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.type === 'seq' && i + 1 < tokens.length && tokens[i + 1].type === 'text') {
                const next = tokens[i + 1];
                let totalDelay = 0;
                for (const ch of next.text) {
                    totalDelay += this.term.isWide(ch) ? this._speed.wide : this._speed.half;
                }
                merged.push({ type: 'seqtext', seq: t.text, text: next.text, delay: totalDelay });
                i++;
            } else if (t.type === 'nl') {
                merged.push({ type: 'char', ch: '\n', wide: false });
            } else if (t.type === 'text') {
                for (const ch of t.text) {
                    const wide = this.term.isWide(ch);
                    merged.push({ type: 'char', ch, wide });
                }
            } else {
                merged.push(t);
            }
        }

        this._queue.push(...merged);
        this._start();
    }

    abort() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        let out = '';
        for (const item of this._queue) {
            if (item.type === 'seq') out += item.text;
            else if (item.type === 'seqtext') out += item.seq + item.text;
            else out += item.ch;
        }
        this._queue = [];
        this._active = false;
        if (out) this.term.write(out);
        this._flushDrain();
    }

    onDrain(callback) {
        this._drainCallbacks.push(callback);
    }

    removeOnDrain(callback) {
        const i = this._drainCallbacks.indexOf(callback);
        if (i >= 0) this._drainCallbacks.splice(i, 1);
    }

    dispose() {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._queue = [];
        this._active = false;
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

    _start() {
        if (this._active || this._queue.length === 0) return;
        this._active = true;
        this._lastFrameTime = performance.now();
        this._accumulator = 0;
        this.term.write(CURSOR_HIDE);
        this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    _tick(timestamp) {
        const elapsed = timestamp - this._lastFrameTime;
        this._lastFrameTime = timestamp;
        this._accumulator += elapsed;

        let out = '';
        while (this._accumulator >= 0 && this._queue.length) {
            const item = this._queue[0];
            const delay = item.type === 'seq' ? 0
                : item.type === 'seqtext' ? item.delay
                : (item.wide ? this._speed.wide : this._speed.half);

            if (delay > this._accumulator) break;

            this._accumulator -= delay;
            this._queue.shift();
            if (item.type === 'seqtext') out += item.seq + item.text;
            else if (item.type === 'seq') out += item.text;
            else out += item.ch;
        }

        if (out) this.term.write(out);

        if (this._queue.length) {
            this._rafId = requestAnimationFrame(t => this._tick(t));
        } else {
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
