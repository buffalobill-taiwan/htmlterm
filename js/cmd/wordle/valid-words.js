// Auto-generated valid words list — 15926 entries.
// Fetched on demand and cached as a Set: only the wordle command needs it,
// and a top-level await here used to stall the whole import graph (blank page
// on a failed or file:// fetch).
let cached = null;
let pending = null;

export function loadValidWords() {
    if (cached) return Promise.resolve(cached);
    if (!pending) {
        pending = fetch('./js/data/wordle-valid-words.json')
            .then((response) => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then((words) => {
                cached = new Set(words);
                return cached;
            })
            .catch((err) => {
                pending = null;
                throw err;
            });
    }
    return pending;
}
