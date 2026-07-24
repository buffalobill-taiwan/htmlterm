import { defaultAttr, resetAttr, applySGR, makeCell } from '../util/sgr.js';
import { isWide } from '../util/display-width.js';

// Reusable objects for _writeStr — avoids allocation on every call
const _sgrParams = [];
const _attr = defaultAttr(); // created once; reset via resetAttr() per _writeStr call

export function _writeStr(buf, y, x, str, maxX) {
    resetAttr(_attr);
    let cx = x;
    let i = 0;
    while (i < str.length) {
        const code = str.charCodeAt(i);
        if (code === 0x1B) {
            i++;
            if (i >= str.length) break;
            if (str[i] === '[') {
                i++;
                // Parse semicolon-separated integers without split/map/filter
                _sgrParams.length = 0;
                let num = -1; // -1 = no digit seen yet
                while (i < str.length) {
                    const c = str.charCodeAt(i);
                    if (c >= 0x30 && c <= 0x39) {
                        num = (num < 0 ? 0 : num * 10) + (c - 0x30);
                        i++;
                    } else if (c === 0x3B) { // ';'
                        if (num >= 0) _sgrParams.push(num);
                        num = -1;
                        i++;
                    } else {
                        break;
                    }
                }
                if (num >= 0) _sgrParams.push(num);
                if (i < str.length && str.charCodeAt(i) === 0x6D) {
                    applySGR(_attr, _sgrParams);
                }
                i++;
            }
            continue;
        }
        if (!buf[y] || cx >= (maxX || buf[y].length)) break;
        const w = isWide(str[i]) ? 2 : 1;
        if (cx + w > (maxX || buf[y].length)) break;
        buf[y][cx] = makeCell(str[i], _attr, w);
        if (w === 2 && cx + 1 < (maxX || buf[y].length)) {
            buf[y][cx + 1] = { width: 0 };
        }
        cx += w;
        i++;
    }
}
