import { ROWS, COLS } from './constants.js';

function _createBoard() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS));
}

// Horizontal + vertical runs of >= 3 same-color gems.
function _findMatches(board) {
    const popped = new Set();
    const groups = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const color = board[r][c];
            if (color === 0) continue;
            let len = 1;
            while (c + len < COLS && board[r][c + len] === color) len++;
            if (len >= 3) {
                const cells = [];
                for (let i = 0; i < len; i++) {
                    cells.push([r, c + i]);
                    popped.add(r * COLS + c + i);
                }
                groups.push({ color, cells });
            }
            c += len - 1;
        }
    }
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            const color = board[r][c];
            if (color === 0) continue;
            let len = 1;
            while (r + len < ROWS && board[r + len][c] === color) len++;
            if (len >= 3) {
                const cells = [];
                for (let i = 0; i < len; i++) {
                    cells.push([r + i, c]);
                    popped.add((r + i) * COLS + c);
                }
                groups.push({ color, cells });
            }
            r += len - 1;
        }
    }
    return { popped, groups };
}

// One gravity step: every gem with empty space directly below it drops one row
// down its column. Returns true if anything moved.
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

// Does the run of `color` starting at (r,c) in direction (dr,dc) reach length 3
// when a gem of that color sits at the adjacent swap target?
function _lineLenThrough(board, r, c, dr, dc) {
    const color = board[r][c];
    let len = 1;
    for (let i = 1; ; i++) {
        const nr = r + dr * i, nc = c + dc * i;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== color) break;
        len++;
    }
    for (let i = 1; ; i++) {
        const nr = r - dr * i, nc = c - dc * i;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== color) break;
        len++;
    }
    return len;
}

// Would swapping two adjacent cells create a match-3?
function _swapCreatesMatch(board, r1, c1, r2, c2) {
    const a = board[r1][c1], b = board[r2][c2];
    board[r1][c1] = b;
    board[r2][c2] = a;
    const horiz = _lineLenThrough(board, r1, c1, 0, 1) >= 3 ||
                  _lineLenThrough(board, r2, c2, 0, 1) >= 3;
    const vert = _lineLenThrough(board, r1, c1, 1, 0) >= 3 ||
                 _lineLenThrough(board, r2, c2, 1, 0) >= 3;
    board[r1][c1] = a;
    board[r2][c2] = b;
    return horiz || vert;
}

function _hasAnyMove(board) {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (c + 1 < COLS && _swapCreatesMatch(board, r, c, r, c + 1)) return true;
            if (r + 1 < ROWS && _swapCreatesMatch(board, r, c, r + 1, c)) return true;
        }
    }
    return false;
}

// Classic chain power table (chain 1=×1, 2=×8, 3=×16, ...).
function _chainMult(n) {
    const t = [0, 1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256];
    if (n < t.length) return t[n];
    return 256 + (n - t.length + 1) * 32;
}

function _calcChainScore(chain, popped, groups, colors) {
    const base = 10 * popped;
    const colorBonus = colors === 5 ? 3 : colors === 6 ? 6 : colors === 7 ? 10 : 0;
    const groupBonus = groups === 2 ? 3 : groups === 3 ? 6 : groups >= 4 ? 10 : 0;
    return (base + colorBonus * 10 + groupBonus * 10) * _chainMult(chain);
}

export { _createBoard, _findMatches, _hasAnyMove, _swapCreatesMatch, _calcChainScore, _fallOneStep };
