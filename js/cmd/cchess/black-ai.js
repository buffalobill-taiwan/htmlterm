import { searchRootAsync } from './engine/search.js';
import { generateLegalMoves } from './engine/rules.js';

// Fixed depth and no effective deadline: depth 2 always completes, so the
// chosen move is deterministic in Node and in the browser.
export const BLACK_AI_DEPTH = 2;
export const BLACK_AI_TIME_MS = Infinity;

// Black's reply for an endgame position (the board after a red move). Returns
// null when black has no legal move (red win).
export async function chooseBlackReply(board) {
    const legal = generateLegalMoves(board, 'black');
    if (!legal.length) return null;
    const result = await searchRootAsync(board, BLACK_AI_DEPTH, BLACK_AI_TIME_MS, {
        color: 'black', rootMoves: legal,
    });
    return result.move ?? legal[0];
}
