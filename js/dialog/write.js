import { defaultAttr, applySGR, makeCell, isFinalByte } from '../util/sgr.js';
import { isWide } from '../util/unicode-width.js';
import { CSI_INTRODUCER } from '../util/constants.js';

/**
 * Measure the display width of a string containing inline SGR sequences.
 * SGR bytes are skipped; wide chars count as 2, others as 1.
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

export function _writeStr(buf, y, x, str, maxX) {
    let attr = defaultAttr();
    let cx = x;
    let i = 0;
    while (i < str.length) {
        const code = str.charCodeAt(i);
        if (code === 0x1B) {
            i++;
            if (i >= str.length) break;
            if (str[i] === '[') {
                i++;
                let pStr = '';
                while (i < str.length) {
                    const c = str.charCodeAt(i);
                    if (c >= 0x30 && c <= 0x3F) { pStr += str[i]; i++; }
                    else break;
                }
                if (i < str.length && str.charCodeAt(i) === 0x6D) {
                    const params = pStr ? pStr.split(';').map(s => parseInt(s, 10)).filter(n => !isNaN(n)) : [];
                    applySGR(attr, params);
                }
                i++;
            }
            continue;
        }
        if (!buf[y] || cx >= (maxX || buf[y].length)) break;
        const w = isWide(str[i]) ? 2 : 1;
        if (cx + w > (maxX || buf[y].length)) break;
        buf[y][cx] = makeCell(str[i], attr, w);
        if (w === 2 && cx + 1 < (maxX || buf[y].length)) {
            buf[y][cx + 1] = { width: 0 };
        }
        cx += w;
        i++;
    }
}
