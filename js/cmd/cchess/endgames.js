import { parseFen, boardToFen } from './engine/notation.js';
import { generateLegalMoves } from './engine/rules.js';
import { applyBoardCopy, findKings } from './engine/board.js';

export const boardKey = board => boardToFen(board).split(' ')[0];
export const positionKey = (board, color) => `${color}:${boardKey(board)}`;
export function hasLost(board, color) {
    return !findKings(board)[color] || generateLegalMoves(board, color).length === 0;
}

export function responseMove(board, target) {
    return generateLegalMoves(board, 'black').find(move => boardKey(applyBoardCopy(board, move)) === target) ?? null;
}

// The importer audits every reachable red alternative, including cycles.
export function validateEndgame(puzzle) {
    if (!puzzle?.meta || typeof puzzle.meta.name !== 'string' || !puzzle.meta.name.trim() ||
        !Number.isInteger(puzzle.meta.step) || puzzle.meta.step < 1 ||
        typeof puzzle.meta.init !== 'string' || !puzzle.table || typeof puzzle.table !== 'object' || Array.isArray(puzzle.table)) {
        throw new Error('殘局格式錯誤');
    }
    const initial = parseFen(puzzle.meta.init, { allowMissingKings: false });
    if (initial.sideToMove !== 'w' || hasLost(initial.board, 'red') || hasLost(initial.board, 'black')) {
        throw new Error('殘局必須從未結束的紅方局面開始');
    }
    const queue = [initial.board], visited = new Set();
    let wins = 0;
    for (let i = 0; i < queue.length; i++) {
        const board = queue[i], key = boardKey(board);
        if (visited.has(key)) continue;
        visited.add(key);
        for (const move of generateLegalMoves(board, 'red')) {
            const next = applyBoardCopy(board, move), afterRed = boardKey(next);
            if (!Object.hasOwn(puzzle.table, afterRed)) throw new Error(`缺少應手：${afterRed}`);
            const target = puzzle.table[afterRed];
            if (target === null) {
                if (!hasLost(next, 'black')) throw new Error('非紅勝局面標記為 null');
                wins++;
                continue;
            }
            if (typeof target !== 'string') throw new Error('黑方應手必須是棋盤 FEN 或 null');
            const reply = responseMove(next, target);
            if (!reply) throw new Error(`非法黑方應手：${target}`);
            const afterBlack = applyBoardCopy(next, reply);
            if (!hasLost(afterBlack, 'red')) queue.push(afterBlack);
        }
    }
    if (!wins) throw new Error('殘局沒有可達紅勝局面');
    return puzzle;
}
