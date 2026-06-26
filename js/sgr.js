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

    if (code === 0x00AD) return true;
    if (code === 0x2057) return true;
    if (code === 0x20B9) return true;
    if (code >= 0x20C1 && code <= 0x20CF) return true;
    if (code >= 0x210A && code <= 0x210B) return true;
    if (code >= 0x210E && code <= 0x2110) return true;
    if (code === 0x2112) return true;
    if (code === 0x211B) return true;
    if (code >= 0x219C && code <= 0x219D) return true;
    if (code === 0x21F4) return true;
    if (code >= 0x21F9 && code <= 0x21FC) return true;
    if (code === 0x21FF) return true;
    if (code === 0x25EF) return true;
    if (code === 0x034F) return true;
    if (code >= 0x0378 && code <= 0x0379) return true;
    if (code >= 0x0380 && code <= 0x0383) return true;
    if (code === 0x038B) return true;
    if (code === 0x038D) return true;
    if (code === 0x03A2) return true;
    if (code >= 0x2072 && code <= 0x2073) return true;
    if (code === 0x208F) return true;
    if (code >= 0x209D && code <= 0x209F) return true;
    if (code === 0x212C) return true;
    if (code >= 0x212E && code <= 0x2131) return true;
    if (code >= 0x2133 && code <= 0x2134) return true;
    if (code >= 0x213A && code <= 0x213D) return true;
    if (code >= 0x213F && code <= 0x2140) return true;
    if (code >= 0x2145 && code <= 0x2149) return true;
    if (code === 0x214C) return true;
    if (code === 0x214F) return true;
    if (code === 0x2182) return true;
    if (code === 0x2188) return true;
    if (code >= 0x218C && code <= 0x218F) return true;
    if (code >= 0x22B6 && code <= 0x22B8) return true;
    if (code >= 0x22D8 && code <= 0x22D9) return true;
    if (code >= 0x22F2 && code <= 0x22F3) return true;
    if (code >= 0x22F5 && code <= 0x22F6) return true;
    if (code >= 0x22F9 && code <= 0x22FB) return true;
    if (code === 0x22FD) return true;
    if (code >= 0x22FF && code <= 0x2300) return true;
    if (code === 0x2316) return true;
    if (code >= 0x2329 && code <= 0x232A) return true;
    if (code >= 0x232C && code <= 0x2335) return true;
    if (code >= 0x237B && code <= 0x237E) return true;
    if (code >= 0x2381 && code <= 0x2394) return true;
    if (code >= 0x2397 && code <= 0x239A) return true;
    if (code >= 0x23B2 && code <= 0x23B6) return true;
    if (code >= 0x23C0 && code <= 0x23CA) return true;
    if (code >= 0x23CD && code <= 0x23CE) return true;
    if (code >= 0x23D4 && code <= 0x23D9) return true;
    if (code >= 0x23DB && code <= 0x23E7) return true;
    if (code >= 0x23E9 && code <= 0x2421) return true;
    if (code >= 0x2427 && code <= 0x243F) return true;
    if (code >= 0x244B && code <= 0x24FF) return true;
    if (code === 0x2603) return true;
    if (code >= 0x2605 && code <= 0x2606) return true;
    if (code >= 0x2610 && code <= 0x2612) return true;
    if (code >= 0x2615 && code <= 0x2619) return true;
    if (code >= 0x2622 && code <= 0x2624) return true;
    if (code >= 0x262B && code <= 0x262C) return true;
    if (code >= 0x262F && code <= 0x2637) return true;
    if (code >= 0x2672 && code <= 0x268F) return true;
    if (code >= 0x2692 && code <= 0x26A0) return true;
    if (code >= 0x26A2 && code <= 0x26A7) return true;
    if (code === 0x26A9) return true;
    if (code >= 0x26AD && code <= 0x26B1) return true;
    if (code === 0x26B6) return true;
    if (code >= 0x26BD && code <= 0x26E1) return true;
    if (code >= 0x26E3 && code <= 0x2767) return true;
    if (code >= 0x2776 && code <= 0x27AF) return true;
    if (code >= 0x27B1 && code <= 0x27BF) return true;
    if (code === 0x27C1) return true;
    if (code >= 0x27C3 && code <= 0x27C4) return true;
    if (code >= 0x27C8 && code <= 0x27C9) return true;
    if (code >= 0x27CB && code <= 0x27D0) return true;
    if (code === 0x27D2) return true;
    if (code >= 0x27D5 && code <= 0x27DE) return true;
    if (code >= 0x27E1 && code <= 0x27E5) return true;
    if (code >= 0x27F0 && code <= 0x27FF) return true;
    if (code >= 0x2900 && code <= 0x2907) return true;
    if (code >= 0x290A && code <= 0x2911) return true;
    if (code >= 0x2914 && code <= 0x2937) return true;
    if (code >= 0x293A && code <= 0x2948) return true;
    if (code >= 0x294A && code <= 0x294B) return true;
    if (code === 0x294E) return true;
    if (code === 0x2950) return true;
    if (code >= 0x2952 && code <= 0x2953) return true;
    if (code >= 0x2956 && code <= 0x2957) return true;
    if (code >= 0x295A && code <= 0x295B) return true;
    if (code >= 0x295E && code <= 0x295F) return true;
    if (code >= 0x2962 && code <= 0x297B) return true;
    if (code >= 0x297E && code <= 0x297F) return true;
    if (code >= 0x2993 && code <= 0x2996) return true;
    if (code === 0x299E) return true;
    if (code >= 0x29A8 && code <= 0x29D0) return true;
    if (code >= 0x29DA && code <= 0x29DB) return true;
    if (code >= 0x29DF && code <= 0x29E0) return true;
    if (code >= 0x29E2 && code <= 0x29EA) return true;
    if (code >= 0x29EC && code <= 0x29ED) return true;
    if (code === 0x29F4) return true;
    if (code >= 0x29FE && code <= 0x2A0A) return true;
    if (code === 0x2A0C) return true;
    if (code === 0x2A1D) return true;
    if (code === 0x2A20) return true;
    if (code >= 0x2A2D && code <= 0x2A2E) return true;
    if (code >= 0x2A33 && code <= 0x2A3B) return true;
    if (code >= 0x2A4E && code <= 0x2A65) return true;
    if (code >= 0x2A68 && code <= 0x2A69) return true;
    if (code >= 0x2A74 && code <= 0x2A76) return true;
    if (code >= 0x2A78 && code <= 0x2A8A) return true;
    if (code >= 0x2A8D && code <= 0x2A8E) return true;
    if (code >= 0x2A95 && code <= 0x2ABE) return true;
    if (code >= 0x2ACD && code <= 0x2AD2) return true;
    if (code >= 0x2AD7 && code <= 0x2ADD) return true;
    if (code >= 0x2ADF && code <= 0x2AED) return true;
    if (code >= 0x2AF3 && code <= 0x2AF5) return true;
    if (code >= 0x2AF7 && code <= 0x2AFD) return true;
    if (code >= 0x2B00 && code <= 0x2B05) return true;
    if (code >= 0x2B08 && code <= 0x2B0C) return true;
    if (code >= 0x2B0E && code <= 0x2B1C) return true;
    if (code >= 0x2B1F && code <= 0x2B24) return true;
    if (code >= 0x2B2C && code <= 0x2B2D) return true;
    if (code === 0x2B30) return true;
    if (code >= 0x2B32 && code <= 0x2B4D) return true;
    if (code >= 0x2B50 && code <= 0x2BC8) return true;
    if (code >= 0x2BCA && code <= 0x2BFE) return true;
    if (code >= 0x2E0E && code <= 0x2E11) return true;
    if (code >= 0x2E13 && code <= 0x2E15) return true;
    if (code >= 0x2E3A && code <= 0x2E3B) return true;
    if (code === 0x2E43) return true;
    if (code >= 0x2E50 && code <= 0x2E51) return true;
    if (code >= 0x2E5E && code <= 0x2E7F) return true;
    if (code >= 0xA728 && code <= 0xA729) return true;
    if (code >= 0xA732 && code <= 0xA73D) return true;
    if (code >= 0xA74E && code <= 0xA74F) return true;
    if (code >= 0xA758 && code <= 0xA759) return true;
    if (code >= 0xA771 && code <= 0xA777) return true;
    if (code >= 0xA7C2 && code <= 0xA7C3) return true;
    if (code >= 0xA7CB && code <= 0xA7CF) return true;
    if (code === 0xA7D2) return true;
    if (code === 0xA7D4) return true;
    if (code >= 0xA7DA && code <= 0xA7F1) return true;
    if (code === 0xA7FF) return true;
    if (code >= 0xAB6C && code <= 0xAB6F) return true;
    if (code >= 0xFB07 && code <= 0xFB12) return true;
    if (code >= 0xFB18 && code <= 0xFB1C) return true;
    if (code >= 0xFB21 && code <= 0xFB28) return true;
    if (code === 0xFB37) return true;
    if (code === 0xFB3D) return true;
    if (code === 0xFB3F) return true;
    if (code === 0xFB42) return true;
    if (code === 0xFB45) return true;
    if (code >= 0xFE00 && code <= 0xFE0F) return true;
    if (code >= 0xFE50 && code <= 0xFE6F) return true;

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
