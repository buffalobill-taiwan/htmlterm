import { chooseMove } from './ai.js';
self.onmessage = async ({ data }) => {
    try {
        const move = await chooseMove(data.board, data.color, data.difficulty, data.history);
        self.postMessage({ move });
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};
