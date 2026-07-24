import { DEFAULT_FG, DEFAULT_BG, CSI_INTRODUCER } from './constants.js';

export function defaultAttr() {
    return { fg: DEFAULT_FG, bg: DEFAULT_BG, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, big: false };
}

/** Reset an existing attr object to defaults in-place — zero allocation. */
export function resetAttr(attr) {
    attr.fg = DEFAULT_FG;
    attr.bg = DEFAULT_BG;
    attr.bold = false;
    attr.dim = false;
    attr.italic = false;
    attr.underline = false;
    attr.blink = false;
    attr.inverse = false;
    attr.conceal = false;
    attr.crossedOut = false;
    attr.big = false;
}

export function applySGR(attr, params) {
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p === 0) resetAttr(attr);
        else if (p === 1) attr.bold = true;
        else if (p === 2) attr.dim = true;
        else if (p === 3) attr.italic = true;
        else if (p === 4) attr.underline = true;
        else if (p === 5 || p === 6) attr.blink = true;
        else if (p === 7) attr.inverse = true;
        else if (p === 8) attr.conceal = true;
        else if (p === 9) attr.crossedOut = true;
        else if (p === 21 || p === 22) { attr.bold = false; attr.dim = false; }
        else if (p === 23) attr.italic = false;
        else if (p === 24) attr.underline = false;
        else if (p === 25) attr.blink = false;
        else if (p === 27) attr.inverse = false;
        else if (p === 28) attr.conceal = false;
        else if (p === 29) attr.crossedOut = false;
        else if (p === 500) attr.big = true;
        else if (p === 501) attr.big = false;
        else if (p >= 30 && p <= 37) attr.fg = p - 30;
        else if (p === 39) attr.fg = DEFAULT_FG;
        else if (p >= 40 && p <= 47) attr.bg = p - 40;
        else if (p === 49) attr.bg = DEFAULT_BG;
        else if (p >= 90 && p <= 97) attr.fg = p - 90 + 8;
        else if (p >= 100 && p <= 107) attr.bg = p - 100 + 8;
    }
}

function _sgrWrap(params, text) {
    return '\x1B[' + params.join(';') + 'm' + text + '\x1B[0m';
}

function _sgrStyle(params) {
    function fn(arg, ...values) {
        if (Array.isArray(arg)) {
            let r = '';
            for (let i = 0; i < arg.length; i++) {
                r += arg[i];
                if (i < values.length) r += values[i];
            }
            return _sgrWrap(params, r);
        }
        return _sgrWrap(params, arg);
    }
    return fn;
}

export const bold = _sgrStyle([1]);
export const red = _sgrStyle([31]);
export const green = _sgrStyle([32]);
export const yellow = _sgrStyle([33]);
export const blue = _sgrStyle([34]);
export const magenta = _sgrStyle([35]);
export const cyan = _sgrStyle([36]);
export const white = _sgrStyle([37]);
export const gray = _sgrStyle([90]);
export const brightRed = _sgrStyle([91]);
export const brightGreen = _sgrStyle([92]);
export const brightYellow = _sgrStyle([93]);
export const brightBlue = _sgrStyle([94]);
export const brightMagenta = _sgrStyle([95]);
export const brightCyan = _sgrStyle([96]);
export const gold = _sgrStyle([38, 5, 220]);
export const orange = _sgrStyle([38, 5, 214]);
export const coral = _sgrStyle([38, 5, 209]);
export const turquoise = _sgrStyle([38, 5, 80]);
export const orchid = _sgrStyle([38, 5, 170]);

export function sgr(...params) { return _sgrStyle(params); }

export const CURSOR_HIDE = '\x1B[?25l';
export const CURSOR_SHOW = '\x1B[?25h';

export const OverlayZ = {
    WIDGET: 10,
    DIALOG: 100,
    FLASH: 200,
};

export function formatTime(date) {
    return String(date.getHours()).padStart(2, '0') + ':' +
           String(date.getMinutes()).padStart(2, '0') + ':' +
           String(date.getSeconds()).padStart(2, '0');
}

export function makeCell(ch, attr, width) {
    return {
        ch: ch || ' ',
        fg: attr.fg,
        bg: attr.bg,
        bold: attr.bold,
        dim: attr.dim,
        italic: attr.italic,
        underline: attr.underline,
        blink: attr.blink,
        inverse: attr.inverse,
        conceal: attr.conceal,
        crossedOut: attr.crossedOut,
        width: width || 1,
    };
}

/** Blinking block cursor for overlay buffers (dialogs, widgets).
 *  Sets fg/bg directly — does NOT use inverse, because
 *  Renderer._swapInverse would swap them back to default colors. */
export function makeCursorCell(ch = ' ') {
    return makeCell(ch, {
        fg: 0, bg: 7,
        bold: false, dim: false, italic: false, underline: false,
        blink: true, inverse: false, conceal: false, crossedOut: false,
    });
}

export function isFinalByte(code) {
    return code >= 0x40 && code <= 0x7E;
}

export function warn(msg) {
    if (typeof console !== 'undefined') console.warn(msg);
}

export function createEmptyBuffer(w, h) {
    const buf = [];
    for (let r = 0; r < h; r++) {
        const row = new Array(w);
        for (let c = 0; c < w; c++) row[c] = null;
        buf.push(row);
    }
    return buf;
}

export function makeOverlayGetCell(buffer, w, h) {
    return (relRow, relCol) => {
        const buf = typeof buffer === 'function' ? buffer() : buffer;
        if (buf && relRow < h && relCol < w) return buf[relRow][relCol];
        return null;
    };
}

export function skipEscapeSeq(text, i) {
    if (text.charCodeAt(i) !== 0x1B) return i;
    i++;
    if (i >= text.length) return i;
    const next = text.charCodeAt(i);
    i++;
    if (next === CSI_INTRODUCER) {
        while (i < text.length) {
            if (isFinalByte(text.charCodeAt(i))) { i++; break; }
            i++;
        }
    } else if (next === 0x5D || next === 0x50) {
        while (i < text.length) {
            const c = text.charCodeAt(i);
            if (c === 0x07) { i++; break; }
            if (c === 0x1B && i + 1 < text.length && text.charCodeAt(i + 1) === 0x5C) { i += 2; break; }
            i++;
        }
    } else {
        while (i < text.length) {
            if (text.charCodeAt(i) === 0x1B && i + 1 < text.length && text.charCodeAt(i + 1) === 0x5C) { i += 2; break; }
            i++;
        }
    }
    return i;
}
