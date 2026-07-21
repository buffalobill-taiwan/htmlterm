import { isWide } from './unicode-width.js';
import { isFinalByte } from './sgr.js';
import { CSI_INTRODUCER } from './constants.js';

export { isWide };

export function displayWidth(s) {
    let w = 0;
    for (const ch of s) {
        w += isWide(ch) ? 2 : 1;
    }
    return w;
}

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
