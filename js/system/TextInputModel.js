/**
 * Parse a single CSI / SS3 escape sequence from the start of `data`.
 * Returns { final, params, consumed } or null if not an escape sequence.
 *
 *   final    — the final byte character (e.g. 'A', 'B', '~')
 *   params   — parameter string before final (e.g. '1;5', '3')
 *   consumed — number of characters consumed from data
 */
export function parseCSI(data) {
    if (!data || data.charCodeAt(0) !== 0x1B || data.length < 2) return null;

    if (data[1] === 'O' && data.length >= 3) {
        return { final: data[2], params: '', consumed: 3 };
    }

    if (data[1] === '[') {
        let j = 2;
        while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) <= 0x3F) j++;
        if (j >= data.length) return null; // incomplete
        return { final: data[j], params: data.slice(2, j), consumed: j + 1 };
    }

    return null;
}

/**
 * TextInputModel — pure data model for a single-line text input.
 *
 * No DOM, no terminal, no output.  Consumers drive rendering.
 *
 * _chars  : Array<string>  — one logical Unicode character per element
 * _cursor : number         — index into _chars (0 = before first char)
 */
import { isWide } from '../util/display-width.js';

export class TextInputModel {
    constructor() {
        this._chars  = [];
        this._cursor = 0;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    get value()  { return this._chars.join(''); }
    get cursor() { return this._cursor; }
    get length() { return this._chars.length; }

    /** Display-column width of chars[from..to). */
    widthRange(from, to) {
        let w = 0;
        for (let i = from; i < to; i++) w += isWide(this._chars[i]) ? 2 : 1;
        return w;
    }

    /** Display-column width of the character at index i. */
    charWidth(i) { return isWide(this._chars[i]) ? 2 : 1; }

    reset() { this._chars = []; this._cursor = 0; }

    set(text) {
        this._chars  = [...text];
        this._cursor = this._chars.length;
    }

    // ── Mutations — each returns a description of what changed ────────────────
    // Return value: one of
    //   'none'    — nothing changed
    //   'cursor'  — only cursor moved (chars unchanged)
    //   'content' — chars (and possibly cursor) changed

    /** Insert a string at the current cursor position. */
    insert(text) {
        if (!text) return 'none';
        const chars = [...text];   // handles surrogate pairs
        this._chars.splice(this._cursor, 0, ...chars);
        this._cursor += chars.length;
        return 'content';
    }

    /** Delete the character before the cursor (Backspace). */
    backspace() {
        if (this._cursor === 0) return 'none';
        this._cursor--;
        this._chars.splice(this._cursor, 1);
        return 'content';
    }

    /** Delete the character at the cursor (Delete key). */
    deleteForward() {
        if (this._cursor >= this._chars.length) return 'none';
        this._chars.splice(this._cursor, 1);
        return 'content';
    }

    /** Delete from start to cursor (Ctrl+U). */
    deleteToStart() {
        if (this._cursor === 0) return 'none';
        this._chars.splice(0, this._cursor);
        this._cursor = 0;
        return 'content';
    }

    /** Delete from cursor to end (Ctrl+K). */
    deleteToEnd() {
        if (this._cursor >= this._chars.length) return 'none';
        this._chars.splice(this._cursor);
        return 'content';
    }

    /** Delete the word before the cursor (Ctrl+W). */
    deleteWordBefore() {
        if (this._cursor === 0) return 'none';
        let j = this._cursor - 1;
        while (j >= 0 && this._chars[j] === ' ') j--;
        while (j >= 0 && this._chars[j] !== ' ') j--;
        const newCursor = j + 1;
        this._chars.splice(newCursor, this._cursor - newCursor);
        this._cursor = newCursor;
        return 'content';
    }

    // ── Cursor movement ───────────────────────────────────────────────────────

    moveLeft() {
        if (this._cursor === 0) return 'none';
        this._cursor--;
        return 'cursor';
    }

    moveRight() {
        if (this._cursor >= this._chars.length) return 'none';
        this._cursor++;
        return 'cursor';
    }

    moveHome() {
        if (this._cursor === 0) return 'none';
        this._cursor = 0;
        return 'cursor';
    }

    moveEnd() {
        if (this._cursor >= this._chars.length) return 'none';
        this._cursor = this._chars.length;
        return 'cursor';
    }
}
