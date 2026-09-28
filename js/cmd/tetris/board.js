import { ROWS, COLS } from './constants.js';
import { SHAPES } from './pieces.js';

function _createBoard() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS));
}

function _bag() {
    const b = ['I','O','T','S','Z','J','L'];
    for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
}

function _ghostY(board, type, rot, px, py) {
    let gy = py;
    while (_fits(board, type, rot, px, gy + 1)) gy++;
    return gy;
}

function _fits(board, type, rot, px, py) {
    const shape = SHAPES[type][rot];
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++)
            if (shape[r][c]) {
                const ny = py + r, nx = px + c;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
                if (ny < 0) continue;
                if (board[ny][nx]) return false;
            }
    return true;
}

function _hasCorner(board, type, px, py, dx, dy) {
    if (type === 'O') return true;
    const cx = px + 1, cy = py + 1;
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return true;
    return board[ny][nx] !== 0;
}

function _isTSpin(board, type, rot, px, py) {
    if (type !== 'T') return false;
    return _hasCorner(board, type, px, py, -1, -1) &&
           _hasCorner(board, type, px, py, 1, -1) &&
           _hasCorner(board, type, px, py, -1, 1) &&
           _hasCorner(board, type, px, py, 1, 1);
}

function _isTSpinMini(board, type, rot, px, py) {
    if (type !== 'T') return false;
    const frontDx = rot === 0 ? 0 : rot === 1 ? 1 : rot === 2 ? 0 : -1;
    const frontDy = rot === 0 ? -1 : rot === 1 ? 0 : rot === 2 ? 1 : 0;
    return _hasCorner(board, type, px, py, -1, -1) &&
           _hasCorner(board, type, px, py, 1, -1) &&
           _hasCorner(board, type, px, py, -1, 1) &&
           _hasCorner(board, type, px, py, 1, 1) &&
           !_hasCorner(board, type, px, py, frontDx, frontDy);
}

function _clearLines(board) {
    const full = [];
    for (let r = 0; r < ROWS; r++)
        if (board[r].every(c => c !== 0)) full.push(r);
    for (const r of full) {
        board.splice(r, 1);
        board.unshift(new Uint8Array(COLS));
    }
    return full.length;
}

export { _ghostY, _createBoard, _bag, _fits, _isTSpin, _isTSpinMini };
