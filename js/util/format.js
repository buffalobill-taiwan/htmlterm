/**
 * Format an elapsed time in whole seconds as MM:SS.
 * Minutes are not capped, so long games stay readable.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
