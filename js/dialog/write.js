import { defaultAttr, applySGR, makeCell } from '../util/sgr.js';
import { isWide } from '../util/display-width.js';

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
