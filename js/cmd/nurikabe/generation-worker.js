import { generatePuzzle } from '../../util/nurikabe-engine.js';

// Keep expensive individual attempts off the UI thread, including rigidity checks.
self.onmessage = ({ data: { size, seed } }) => {
    try {
        const maxAttempts = size <= 8 ? 300 : size <= 12 ? 600 : 1200;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const puzzle = generatePuzzle(size, size, {
                seed: seed + attempt,
                maxAttempts: 1,
            });
            if (puzzle) {
                self.postMessage({ result: { puzzle, seed: seed + attempt } });
                return;
            }
        }
        self.postMessage({ result: null });
    } catch (err) {
        self.postMessage({ error: err.message || String(err) });
    }
};
