import { searchRootAsync } from './engine/search.js';
import { generateLegalMoves } from './engine/rules.js';
import { applyBoardCopy } from './engine/board.js';
import { opp } from './engine/helpers.js';
import { positionKey } from './endgames.js';
import { DEPTHS, THINK_MS } from './constants.js';

export async function chooseMove(board, color, difficulty, history) {
    const legal = generateLegalMoves(board, color);
    const seen = new Set(history);
    const fresh = legal.filter(move => !seen.has(positionKey(applyBoardCopy(board, move), opp(color))));
    const candidates = fresh.length ? fresh : legal;
    if (!candidates.length) return null;
    const result = await searchRootAsync(board, DEPTHS[difficulty], THINK_MS, { color, rootMoves: candidates });
    return result.move ?? candidates[0];
}
