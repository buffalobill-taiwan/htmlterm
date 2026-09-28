import { N, BLACK, WHITE, EMPTY, DIRS } from './constants.js';

const idx = (r, c) => r * N + c;

const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;

const other = (p) => p === BLACK ? WHITE : BLACK;

// ── Board rules ────────────────────────────────────────────────────────────
function discFlips(board, r, c, p) {
    if (board[idx(r, c)] !== EMPTY) return null;
    const opp = other(p);
    const out = [];
    for (const [dr, dc] of DIRS) {
        let rr = r + dr;
        let cc = c + dc;
        if (!inb(rr, cc)) continue;
        if (board[idx(rr, cc)] !== opp) continue;
        const seen = [];
        while (inb(rr, cc) && board[idx(rr, cc)] === opp) {
            seen.push(idx(rr, cc));
            rr += dr;
            cc += dc;
        }
        if (inb(rr, cc) && board[idx(rr, cc)] === p) {
            for (const id of seen) out.push(id);
        }
    }
    return out.length ? out : null;
}

function isValid(board, r, c, p) {
    if (board[idx(r, c)] !== EMPTY) return false;
    const opp = other(p);
    for (const [dr, dc] of DIRS) {
        let rr = r + dr;
        let cc = c + dc;
        if (!inb(rr, cc)) continue;
        if (board[idx(rr, cc)] !== opp) continue;
        rr += dr;
        cc += dc;
        while (inb(rr, cc) && board[idx(rr, cc)] === opp) {
            rr += dr;
            cc += dc;
        }
        if (inb(rr, cc) && board[idx(rr, cc)] === p) return true;
    }
    return false;
}

function getValidMoves(board, p) {
    const moves = [];
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (isValid(board, r, c, p)) moves.push([r, c]);
    return moves;
}

function applyMove(board, r, c, p) {
    const flips = discFlips(board, r, c, p);
    if (!flips) return null;
    board[idx(r, c)] = p;
    for (const id of flips) board[id] = p;
    return flips;
}

function undoMove(board, r, c, p, flips) {
    board[idx(r, c)] = EMPTY;
    const opp = other(p);
    for (const id of flips) board[id] = opp;
}

function discDiff(board, p) {
    let d = 0;
    for (const v of board) {
        if (v === p) d++;
        else if (v !== EMPTY) d--;
    }
    return d;
}

function countPieces(board, p) {
    let n = 0;
    for (const v of board) if (v === p) n++;
    return n;
}

export { getValidMoves, other, idx, applyMove, undoMove, discDiff, discFlips, isValid, countPieces };
