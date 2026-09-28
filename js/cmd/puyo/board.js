import { ROWS, COLS, DIRS } from './constants.js';

function _createBoard() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS));
}

// Find all same-color groups of size >= 4.
function _findGroups(board) {
    const groups = [];
    const visited = new Set();
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const color = board[r][c];
            if (color === 0 || visited.has(r * COLS + c)) continue;
            const cells = [];
            const stack = [[r, c]];
            visited.add(r * COLS + c);
            while (stack.length) {
                const [cr, cc] = stack.pop();
                cells.push([cr, cc]);
                for (let d = 0; d < 4; d++) {
                    const nr = cr + DIRS[d][0], nc = cc + DIRS[d][1];
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
                    const k = nr * COLS + nc;
                    if (board[nr][nc] === color && !visited.has(k)) {
                        visited.add(k);
                        stack.push([nr, nc]);
                    }
                }
            }
            if (cells.length >= 4) groups.push({ color, cells });
        }
    }
    return groups;
}

// One gravity step: every puyo with empty space directly below it falls one
// row down its column. Matches real Puyo Puyo — each puyo drops independently
// to the floor or on top of another puyo; no gaps can remain. The game calls
// this repeatedly (one row per tick) to animate the fall.
function _fallOneStep(board) {
    let moved = false;
    for (let c = 0; c < COLS; c++) {
        for (let r = ROWS - 2; r >= 0; r--) {
            if (board[r][c] !== 0 && board[r + 1][c] === 0) {
                board[r + 1][c] = board[r][c];
                board[r][c] = 0;
                moved = true;
            }
        }
    }
    return moved;
}

// Classic chain power table (chain 1=×1, 2=×8, 3=×16, ...).
function _chainMult(n) {
    const t = [0, 1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256];
    if (n < t.length) return t[n];
    return 256 + (n - t.length + 1) * 32;
}

function _calcChainScore(chain, popped, groups, colors) {
    const base = 10 * popped;
    const colorBonus = colors === 3 ? 3 : colors === 4 ? 6 : colors === 5 ? 10 : 0;
    const groupBonus = groups === 2 ? 3 : groups === 3 ? 6 : groups >= 4 ? 10 : 0;
    return (base + colorBonus * 10 + groupBonus * 10) * _chainMult(chain);
}

export { _createBoard, _findGroups, _calcChainScore, _fallOneStep };
