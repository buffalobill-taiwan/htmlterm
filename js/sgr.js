/**
 * Shared SGR parsing and cell construction.
 *
 * Provides a single source of truth for:
 * - default attribute values
 * - SGR parameter application (all params except extended 38/48 colors)
 * - cell object construction
 *
 * Extended 38/48 colors are NOT handled here because they consume
 * variable-length parameter sequences and require caller context.
 */

export function defaultAttr() {
    return { fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false };
}

export function applySGR(attr, params) {
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p === 0) Object.assign(attr, defaultAttr());
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
        else if (p >= 30 && p <= 37) attr.fg = p - 30;
        else if (p === 39) attr.fg = 7;
        else if (p >= 40 && p <= 47) attr.bg = p - 40;
        else if (p === 49) attr.bg = 0;
        else if (p >= 90 && p <= 97) attr.fg = p - 90 + 8;
        else if (p >= 100 && p <= 107) attr.bg = p - 100 + 8;
    }
}

// ── SGR helper — convenient text styling ──
// Usage:
//   green`success\n`          tagged template
//   green('success')          function call
//   bold(red('error'))        chaining (double \x1B[0m, harmless)

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
export const magenta = _sgrStyle([35]);
export const cyan = _sgrStyle([36]);
export const white = _sgrStyle([37]);
export const gray = _sgrStyle([90]);

export function sgr(...params) { return _sgrStyle(params); }

export function isWide(ch) {
    const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;
    if (code >= 0x1100) {
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
    }
    if (code < 0x100) return false;
    if (code === 0x23F0 || code === 0x23F3) return true;
    if (code >= 0x2190 && code <= 0x21FF) return false;
    if (code >= 0x2300 && code <= 0x23FF) return false;
    if (code >= 0x2500 && code <= 0x25FF) return false;
    return false;
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
