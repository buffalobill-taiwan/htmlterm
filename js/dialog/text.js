import { isWide } from '../util/display-width.js';

// Keep SGR state across wrapped lines; width counts terminal cells, not UTF-16.
export function wrapDialogText(text, width) {
    const lines = [];
    let line = '', used = 0, style = '';
    for (const token of String(text).match(/\x1B\[[0-9;]*m|[^]/gu) || []) {
        if (token.startsWith('\x1B[')) { style += token; line += token; continue; }
        const size = isWide(token) ? 2 : 1;
        if (token === '\n' || used + size > width) {
            lines.push(line); line = style; used = 0;
            if (token === '\n') continue;
        }
        line += token; used += size;
    }
    lines.push(line);
    return lines;
}
