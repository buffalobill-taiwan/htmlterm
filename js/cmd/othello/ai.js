import { getValidMoves, other, idx, applyMove, undoMove, discDiff } from './board.js';
import { N } from './constants.js';

// Positional weights for the medium evaluation.
const POS = [
    [120, -20,  10,   5,   5,  10, -20, 120],
    [ -20, -40,  -2,  -2,  -2,  -2, -40, -20],
    [  10,  -2,   1,   1,   1,   1,  -2,  10],
    [   5,  -2,   1,   0,   0,   1,  -2,   5],
    [   5,  -2,   1,   0,   0,   1,  -2,   5],
    [  10,  -2,   1,   1,   1,   1,  -2,  10],
    [ -20, -40,  -2,  -2,  -2,  -2, -40, -20],
    [ 120, -20,  10,   5,   5,  10, -20, 120],
];

// ── Easy: random legal move ────────────────────────────────────────────────
function aiMoveEasy(board, p) {
    const moves = getValidMoves(board, p);
    if (!moves.length) return null;
    return moves[(Math.random() * moves.length) | 0];
}

// ── Shared evaluation: positional weights + mobility ─────────────────
function evalPos(board, ai) {
    const opp = other(ai);
    let score = 0;
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
            const v = board[idx(r, c)];
            if (v === ai) score += POS[r][c];
            else if (v === opp) score -= POS[r][c];
        }
    const my = getValidMoves(board, ai).length;
    const op = getValidMoves(board, opp).length;
    return score + (my - op) * 8;
}

// ── Medium: depth-1 — pick the move that maximizes the static eval ──────────
function aiMoveMedium(board, ai) {
    const moves = getValidMoves(board, ai);
    if (!moves.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const [r, c] of moves) {
        const flips = applyMove(board, r, c, ai);
        const s = evalPos(board, ai);
        undoMove(board, r, c, ai, flips);
        if (s > bestScore) {
            bestScore = s;
            best = [r, c];
        }
    }
    return best;
}

// ── Hard: minimax + alpha-beta, depth 3 (root + 2 replies) on evalPos ───────
function minimax(board, depth, alpha, beta, isMaximizing, ai) {
    if (depth <= 0) return evalPos(board, ai);
    const me = isMaximizing ? ai : other(ai);
    const moves = getValidMoves(board, me);
    if (moves.length === 0) {
        if (getValidMoves(board, other(me)).length === 0) {
            return discDiff(board, ai) * 10000;
        }
        return -minimax(board, depth - 1, -alpha, -beta, !isMaximizing, ai);
    }
    if (isMaximizing) {
        let best = -Infinity;
        for (const [r, c] of moves) {
            const flips = applyMove(board, r, c, me);
            const s = minimax(board, depth - 1, alpha, beta, false, ai);
            undoMove(board, r, c, me, flips);
            if (s > best) best = s;
            if (s > alpha) alpha = s;
            if (beta <= alpha) break;
        }
        return best;
    }
    let best = Infinity;
    for (const [r, c] of moves) {
        const flips = applyMove(board, r, c, me);
        const s = minimax(board, depth - 1, alpha, beta, true, ai);
        undoMove(board, r, c, me, flips);
        if (s < best) best = s;
        if (s < beta) beta = s;
        if (beta <= alpha) break;
    }
    return best;
}

function aiMoveHard(board, ai) {
    const moves = getValidMoves(board, ai);
    if (!moves.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const [r, c] of moves) {
        const flips = applyMove(board, r, c, ai);
        const s = minimax(board, 2, -Infinity, Infinity, false, ai);
        undoMove(board, r, c, ai, flips);
        if (s > bestScore) {
            bestScore = s;
            best = [r, c];
        }
    }
    return best;
}

export { aiMoveEasy, aiMoveMedium, aiMoveHard };
