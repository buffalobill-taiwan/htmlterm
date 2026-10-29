import { generate } from './engine.js';
self.onmessage = ({ data: seed }) => {
    try {
        const result = generate(seed);
        self.postMessage({ seed, board: result.board });
    } catch (error) { self.postMessage({ error: error.message }); }
};
