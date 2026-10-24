import { isWide } from './unicode-width.js';
import { isFinalByte } from './sgr.js';
import { CSI_INTRODUCER } from './constants.js';

export { isWide };

/**
 * Calculate display width of plain text (no escape sequences).
 * CJK/full-width glyphs count as 2 columns, others as 1.
 * @param {string} s
 * @returns {number}
 */
export function displayWidth(s) {
    if (!s) return 0;
    let w = 0;
    for (const ch of s) {
        w += isWide(ch) ? 2 : 1;
    }
    return w;
}

/**
 * Calculate visible width of text containing SGR escape sequences.
 * Escape sequences are skipped; only printable characters are counted.
 * @param {string} str
 * @returns {number}
 */
export function bufWidth(str) {
    if (!str) return 0;
    let w = 0, inEsc = false;
    for (const ch of str) {
        const code = ch.charCodeAt(0);
        if (code === 0x1B) { inEsc = true; continue; }
        if (inEsc) {
            if (code === CSI_INTRODUCER) continue;
            if (isFinalByte(code)) inEsc = false;
            continue;
        }
        w += isWide(ch) ? 2 : 1;
    }
    return w;
}
