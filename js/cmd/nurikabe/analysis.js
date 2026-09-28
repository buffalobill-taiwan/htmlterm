import { WHITE, BLACK } from '../../util/nurikabe-engine.js';
import { CLUE_CONNECTED, CLUE_OK, CLUE_OVER, CLUE_BAD } from './constants.js';

function _create2D(cols, rows, val) {
    return Array.from({ length: rows }, () => Array(cols).fill(val));
}

function _analyzeClueColors(size, player, clues) {
    const status = Array.from({ length: size }, () => Array(size).fill(null));
    const seen = Array.from({ length: size }, () => Array(size).fill(false));

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (seen[r][c] || player[r][c] !== WHITE) continue;

            const clueCells = [];
            const stack = [[r, c]];
            seen[r][c] = true;
            let regionSize = 0;

            while (stack.length) {
                const [cr, cc] = stack.pop();
                regionSize++;
                if (clues[cr][cc] > 0) clueCells.push([cr, cc]);
                if (cr > 0 && !seen[cr - 1][cc] && player[cr - 1][cc] === WHITE) {
                    seen[cr - 1][cc] = true;
                    stack.push([cr - 1, cc]);
                }
                if (cr + 1 < size && !seen[cr + 1][cc] && player[cr + 1][cc] === WHITE) {
                    seen[cr + 1][cc] = true;
                    stack.push([cr + 1, cc]);
                }
                if (cc > 0 && !seen[cr][cc - 1] && player[cr][cc - 1] === WHITE) {
                    seen[cr][cc - 1] = true;
                    stack.push([cr, cc - 1]);
                }
                if (cc + 1 < size && !seen[cr][cc + 1] && player[cr][cc + 1] === WHITE) {
                    seen[cr][cc + 1] = true;
                    stack.push([cr, cc + 1]);
                }
            }

            const connected = clueCells.length > 1;
            for (const [cr, cc] of clueCells) {
                const n = clues[cr][cc];
                if (connected) status[cr][cc] = CLUE_CONNECTED;
                else if (regionSize === n) status[cr][cc] = CLUE_OK;
                else if (regionSize > n) status[cr][cc] = CLUE_OVER;
                else status[cr][cc] = CLUE_BAD;
            }
        }
    }
    return status;
}

function _analyzePools(size, player) {
    const pool = Array.from({ length: size }, () => Array(size).fill(false));
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            if (player[r][c] === BLACK && player[r][c + 1] === BLACK &&
                player[r + 1][c] === BLACK && player[r + 1][c + 1] === BLACK) {
                pool[r][c] = true;
                pool[r][c + 1] = true;
                pool[r + 1][c] = true;
                pool[r + 1][c + 1] = true;
            }
        }
    }
    return pool;
}

function _analyzeSeaConnectivity(size, player, r, c) {
    const mask = Array.from({ length: size }, () => Array(size).fill(false));
    if (player[r][c] !== BLACK) return mask;
    const seen = Array.from({ length: size }, () => Array(size).fill(false));
    const stack = [[r, c]];
    seen[r][c] = true;
    while (stack.length) {
        const [cr, cc] = stack.pop();
        mask[cr][cc] = true;
        if (cr > 0 && !seen[cr - 1][cc] && player[cr - 1][cc] === BLACK) {
            seen[cr - 1][cc] = true;
            stack.push([cr - 1, cc]);
        }
        if (cr + 1 < size && !seen[cr + 1][cc] && player[cr + 1][cc] === BLACK) {
            seen[cr + 1][cc] = true;
            stack.push([cr + 1, cc]);
        }
        if (cc > 0 && !seen[cr][cc - 1] && player[cr][cc - 1] === BLACK) {
            seen[cr][cc - 1] = true;
            stack.push([cr, cc - 1]);
        }
        if (cc + 1 < size && !seen[cr][cc + 1] && player[cr][cc + 1] === BLACK) {
            seen[cr][cc + 1] = true;
            stack.push([cr, cc + 1]);
        }
    }
    return mask;
}

export { _create2D, _analyzeClueColors, _analyzePools, _analyzeSeaConnectivity };
