function _create2D(cols, rows, val) {
    return Array.from({ length: rows }, () => Array(cols).fill(val));
}

function _isSubset(small, large) {
    let j = 0;
    for (let i = 0; i < small.length; i++) {
        while (j < large.length && large[j] < small[i]) j++;
        if (j >= large.length || large[j] !== small[i]) return false;
        j++;
    }
    return true;
}

function _arrayDiff(base, sub) {
    const result = [];
    let j = 0;
    for (let i = 0; i < base.length; i++) {
        if (j < sub.length && sub[j] === base[i]) { j++; continue; }
        result.push(base[i]);
    }
    return result;
}

function _isSolvable(board, rows, cols, safeR, safeC) {
    const totalCells = rows * cols;
    const revealed = _create2D(cols, rows, false);
    const flagged = new Set();

    const cellId = (r, c) => r * cols + c;
    const cellRC = (id) => [Math.floor(id / cols), id % cols];

    const allNeighbors = new Array(totalCells);
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const id = cellId(r, c);
            const nb = [];
            for (let dr = -1; dr <= 1; dr++)
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
                        nb.push(cellId(nr, nc));
                }
            allNeighbors[id] = nb;
        }

    const q = [[safeR, safeC]];
    revealed[safeR][safeC] = true;
    while (q.length) {
        const [r, c] = q.pop();
        if (board[r][c] !== 0) continue;
        for (const id of allNeighbors[cellId(r, c)]) {
            const [nr, nc] = cellRC(id);
            if (!revealed[nr][nc]) {
                revealed[nr][nc] = true;
                q.push([nr, nc]);
            }
        }
    }

    let totalSafe = 0, revealedSafe = 0;
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            if (board[r][c] !== -1) {
                totalSafe++;
                if (revealed[r][c]) revealedSafe++;
            }
    if (revealedSafe === totalSafe) return true;

    function buildConstraints() {
        const constraints = [];
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) {
                if (!revealed[r][c] || board[r][c] <= 0) continue;
                const nbs = allNeighbors[cellId(r, c)];
                const unknown = [];
                let flaggedCount = 0;
                for (const nid of nbs) {
                    if (flagged.has(nid)) flaggedCount++;
                    else if (!revealed[Math.floor(nid / cols)][nid % cols])
                        unknown.push(nid);
                }
                const remaining = board[r][c] - flaggedCount;
                if (unknown.length === 0 || remaining < 0) continue;
                constraints.push({ cells: unknown, count: remaining });
            }
        return constraints;
    }

    let changed = true;
    while (changed) {
        changed = false;
        const constraints = buildConstraints();

        for (const con of constraints) {
            if (con.count === 0) {
                for (const id of con.cells) {
                    const [r, c] = cellRC(id);
                    if (!revealed[r][c]) {
                        revealed[r][c] = true;
                        changed = true;
                    }
                }
            } else if (con.count === con.cells.length) {
                for (const id of con.cells) {
                    if (!flagged.has(id)) {
                        flagged.add(id);
                        changed = true;
                    }
                }
            }
        }

        if (changed) continue;

        const safes = new Set();
        const mines = new Set();

        for (let i = 0; i < constraints.length; i++) {
            for (let j = i + 1; j < constraints.length; j++) {
                const a = constraints[i], b = constraints[j];
                let derived = null;

                if (a.cells.length < b.cells.length && _isSubset(a.cells, b.cells)) {
                    derived = { cells: _arrayDiff(b.cells, a.cells), count: b.count - a.count };
                } else if (b.cells.length < a.cells.length && _isSubset(b.cells, a.cells)) {
                    derived = { cells: _arrayDiff(a.cells, b.cells), count: a.count - b.count };
                }

                if (derived && derived.count >= 0 && derived.count <= derived.cells.length) {
                    if (derived.count === 0) {
                        for (const id of derived.cells) safes.add(id);
                    } else if (derived.count === derived.cells.length) {
                        for (const id of derived.cells) mines.add(id);
                    }
                }
            }
        }

        if (safes.size > 0 || mines.size > 0) {
            for (const id of safes) {
                const [r, c] = cellRC(id);
                if (!revealed[r][c]) {
                    revealed[r][c] = true;
                    changed = true;
                }
            }
            for (const id of mines) {
                if (!flagged.has(id)) {
                    flagged.add(id);
                    changed = true;
                }
            }
        }
    }

    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            if (board[r][c] !== -1 && !revealed[r][c]) return false;
    return true;
}

export { _create2D, _isSolvable };
