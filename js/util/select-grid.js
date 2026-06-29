import { bold, green } from './sgr.js';
import { isWide } from './unicode-width.js';

export function defaultGridMove(data, row, col, options) {
    if (data === '\x1B[A') {
        if (row === 0) return { row, col };
        const prev = options[row - 1];
        return { row: row - 1, col: Math.min(col, prev.length - 1) };
    }
    if (data === '\x1B[B') {
        if (row === options.length - 1) return { row, col };
        const next = options[row + 1];
        return { row: row + 1, col: Math.min(col, next.length - 1) };
    }
    if (data === '\x1B[D') {
        if (col === 0) return { row, col };
        return { row, col: col - 1 };
    }
    if (data === '\x1B[C') {
        const cur = options[row];
        if (col === cur.length - 1) return { row, col };
        return { row, col: col + 1 };
    }
    return { row, col };
}

export function displayWidth(s) {
    let w = 0;
    for (const ch of s) {
        w += isWide(ch) ? 2 : 1;
    }
    return w;
}

export function defaultGridRender(renderedRef) {
    return (r, c, options, term) => {
        const rows = options.length;
        let s = '';
        if (renderedRef.value && rows > 1) {
            s += '\x1B[' + (rows - 1) + 'A';
        }
        const numCols = Math.max(...options.map(row => row.length));
        const colWidths = [];
        for (let ci = 0; ci < numCols; ci++) {
            let maxW = 0;
            for (const row of options) {
                if (ci < row.length) {
                    maxW = Math.max(maxW, displayWidth(row[ci]));
                }
            }
            colWidths.push(maxW);
        }
        for (let ri = 0; ri < rows; ri++) {
            if (ri > 0) s += '\r\n';
            s += '\r\x1B[K';
            for (let ci = 0; ci < options[ri].length; ci++) {
                const name = options[ri][ci];
                const isSel = ri === r && ci === c;
                const prefix = isSel ? bold(green('▶ ')) : '  ';
                const padded = name + ' '.repeat(colWidths[ci] - displayWidth(name) + 2);
                s += prefix + padded;
            }
        }
        term.write(s);
    };
}
