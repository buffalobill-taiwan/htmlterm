/**
 * Decode RLE-compressed flat pixel array.
 * rleData: flat array [count, value, count, value, ...]
 * Returns a Uint8Array of length `size`.
 */
export function decodeRLE(rleData, size) {
    const pixels = new Uint8Array(size);
    let pos = 0;
    for (let i = 0; i < rleData.length; i += 2) {
        pixels.fill(rleData[i + 1], pos, pos + rleData[i]);
        pos += rleData[i];
    }
    return pixels;
}

/**
 * Apply frame diff to pixel array in-place.
 * diff: flat array [offset, newValue, offset, newValue, ...]
 */
export function applyDiff(pixels, diff) {
    for (let i = 0; i < diff.length; i += 2) {
        pixels[diff[i]] = diff[i + 1];
    }
}

/**
 * Compute RLE from a pixel array.
 * Returns flat array [count, value, count, value, ...]
 */
export function computeRLE(pixels) {
    const rle = [];
    let count = 1;
    let prev = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
        const v = pixels[i];
        if (v === prev) {
            count++;
        } else {
            rle.push(count, prev);
            count = 1;
            prev = v;
        }
    }
    rle.push(count, prev);
    return rle;
}

/**
 * Compute frame diff between prev and next pixel arrays.
 * Returns flat array [offset, newValue, ...] for changed pixels.
 */
export function computeDiff(prev, next) {
    const diff = [];
    for (let i = 0; i < prev.length; i++) {
        if (prev[i] !== next[i]) {
            diff.push(i, next[i]);
        }
    }
    return diff;
}
