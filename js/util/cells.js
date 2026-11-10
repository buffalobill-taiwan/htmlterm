/** Compare two terminal cells by every enumerable attribute. */
export function cellsEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    for (const key in a) if (a[key] !== b[key]) return false;
    for (const key in b) if (a[key] !== b[key]) return false;
    return true;
}

/** True when any cell in the compared prefix differs. */
export function rowChanged(aRow, bRow, width = Math.min(aRow.length, bRow.length)) {
    for (let c = 0; c < width; c++) if (!cellsEqual(aRow[c], bRow[c])) return true;
    return false;
}
