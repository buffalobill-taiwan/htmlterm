export class Typewriter {
    constructor(term) {
        this.term = term;
        this._queue = [];
        this._timerId = null;
        this._drainCallbacks = [];
        this._active = false;
        this._speed = { wide: 8, half: 4 };
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
        if (this._timerId) {
            clearTimeout(this._timerId);
            this._timerId = null;
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

    dispose() {
        if (this._timerId) clearTimeout(this._timerId);
        this._queue = [];
        this._active = false;
    }

    _tokenize(text) {
        const tokens = [];
        let i = 0;
        let visible = '';

        while (i < text.length) {
            const code = text.charCodeAt(i);

            if (code === 0x1B) {
                if (visible) { tokens.push({ type: 'text', text: visible }); visible = ''; }
                const start = i;
                i++;
                if (i >= text.length) break;
                const next = text.charCodeAt(i);

                if (next === 0x5B) {
                    i++;
                    while (i < text.length) {
                        const c = text.charCodeAt(i);
                        i++;
                        if (c >= 0x40 && c <= 0x7E) break;
                    }
                } else if (next === 0x5D) {
                    i++;
                    while (i < text.length) {
                        if (text.charCodeAt(i) === 0x07) { i++; break; }
                        if (text.charCodeAt(i) === 0x1B && i + 1 < text.length && text.charCodeAt(i + 1) === 0x5C) { i += 2; break; }
                        i++;
                    }
                } else if (next === 0x50) {
                    i++;
                    while (i < text.length) {
                        if (text.charCodeAt(i) === 0x07) { i++; break; }
                        if (text.charCodeAt(i) === 0x1B && i + 1 < text.length && text.charCodeAt(i + 1) === 0x5C) { i += 2; break; }
                        i++;
                    }
                } else if (next === 0x58 || next === 0x5E || next === 0x5F) {
                    i++;
                    while (i < text.length) {
                        if (text.charCodeAt(i) === 0x1B && i + 1 < text.length && text.charCodeAt(i + 1) === 0x5C) { i += 2; break; }
                        i++;
                    }
                } else {
                    i++;
                }

                tokens.push({ type: 'seq', text: text.slice(start, i) });

            } else if (code === 0x0A) {
                if (visible) { tokens.push({ type: 'text', text: visible }); visible = ''; }
                tokens.push({ type: 'nl' });
                i++;
            } else {
                visible += text[i];
                i++;
            }
        }

        if (visible) tokens.push({ type: 'text', text: visible });
        return tokens;
    }

    _start() {
        if (this._active || this._queue.length === 0) return;
        this._active = true;
        this.term.write('\x1B[?25l');
        this._tick();
    }

    _tick() {
        if (this._queue.length === 0) {
            this._active = false;
            this._timerId = null;
            this._flushDrain();
            return;
        }

        const item = this._queue.shift();
        if (item.type === 'seqtext') {
            this.term.write(item.seq + item.text);
        } else if (item.type === 'seq') {
            this.term.write(item.text);
        } else {
            this.term.write(item.ch);
        }

        const delay = item.type === 'seq' ? 0
            : item.type === 'seqtext' ? item.delay
            : (item.wide ? this._speed.wide : this._speed.half);
        this._timerId = setTimeout(() => this._tick(), delay);
    }

    _flushDrain() {
        this.term.write('\x1B[?25h');
        for (const cb of this._drainCallbacks) cb();
    }
}
