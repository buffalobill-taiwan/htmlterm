// Async busy-wait helper with abort epoch detection

/**
 * Creates an abort guard function for use in async loops.
 * Detects when Ctrl+C (abort epoch change) occurs.
 * @param {Function} getAbortEpoch - Function that returns current epoch value
 * @returns {Function} Guard function: returns true if NOT aborted, false if aborted
 */
export function createAbortGuard(getAbortEpoch) {
    const gen = getAbortEpoch();
    return () => gen === getAbortEpoch();
}

/**
 * Schedule a callback with setTimeout, abort-safe.
 * @param {Function} getAbortEpoch - Function that returns current epoch value
 * @param {Function} callback - Function to call after delay
 * @param {number} ms - Delay in milliseconds
 * @returns {number} Timeout ID (can be cancelled via clearTimeout)
 */
export function scheduleWithAbort(getAbortEpoch, callback, ms) {
    const guard = createAbortGuard(getAbortEpoch);
    const timeoutId = setTimeout(() => {
        if (guard()) callback();
    }, ms);
    return timeoutId;
}
