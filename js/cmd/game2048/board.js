import { SIZE } from './constants.js';

function _emptyBoard() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
}

function _copyBoard(b) {
    return b.map(r => [...r]);
}

function _emptyCells(b) {
    const cells = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (b[r][c] === 0) cells.push([r, c]);
    return cells;
}

function _spawnTile(b) {
    const cells = _emptyCells(b);
    if (cells.length === 0) return;
    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    b[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function _slideRow(row) {
    const filtered = [];
    const filteredIdx = [];
    for (let i = 0; i < row.length; i++) {
        if (row[i] !== 0) {
            filtered.push(row[i]);
            filteredIdx.push(i);
        }
    }
    const merged = [];
    const mergePairs = [];
    let score = 0;
    let i = 0;
    while (i < filtered.length) {
        if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
            const v = filtered[i] * 2;
            merged.push(v);
            mergePairs.push({ dest: merged.length - 1, src: i + 1, value: v });
            score += v;
            i += 2;
        } else {
            merged.push(filtered[i]);
            i++;
        }
    }
    while (merged.length < SIZE) merged.push(0);
    const slide = [...filtered];
    while (slide.length < SIZE) slide.push(0);
    return { slide, result: merged, score, mergePairs, filteredIdx };
}

function _slide(b, dir) {
    let totalScore = 0;
    let moved = false;
    const nb = _copyBoard(b);
    const ns = _copyBoard(b);
    const mergeCells = [];
    const moveCells = [];

    if (dir === 0) {
        for (let c = 0; c < SIZE; c++) {
            const col = [];
            for (let r = 0; r < SIZE; r++) col.push(nb[r][c]);
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(col);
            totalScore += score;
            for (let r = 0; r < SIZE; r++) {
                if (nb[r][c] !== result[r]) moved = true;
                nb[r][c] = result[r];
                ns[r][c] = slide[r];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r: m.dest, c, srcR: m.src, srcC: c, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r: i, c, srcR: filteredIdx[i], srcC: c, value: slide[i] });
                }
            }
        }
    } else if (dir === 2) {
        for (let c = 0; c < SIZE; c++) {
            const col = [];
            for (let r = SIZE - 1; r >= 0; r--) col.push(nb[r][c]);
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(col);
            totalScore += score;
            for (let i = 0; i < SIZE; i++) {
                const r = SIZE - 1 - i;
                if (nb[r][c] !== result[i]) moved = true;
                nb[r][c] = result[i];
                ns[r][c] = slide[i];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r: SIZE - 1 - m.dest, c, srcR: SIZE - 1 - m.src, srcC: c, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r: SIZE - 1 - i, c, srcR: SIZE - 1 - filteredIdx[i], srcC: c, value: slide[i] });
                }
            }
        }
    } else if (dir === 1) {
        for (let r = 0; r < SIZE; r++) {
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(nb[r]);
            totalScore += score;
            for (let c = 0; c < SIZE; c++) {
                if (nb[r][c] !== result[c]) moved = true;
                nb[r][c] = result[c];
                ns[r][c] = slide[c];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r, c: m.dest, srcR: r, srcC: m.src, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r, c: i, srcR: r, srcC: filteredIdx[i], value: slide[i] });
                }
            }
        }
    } else {
        for (let r = 0; r < SIZE; r++) {
            const reversed = nb[r].slice().reverse();
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(reversed);
            totalScore += score;
            const orig = nb[r];
            for (let c = 0; c < SIZE; c++) {
                const v = result[SIZE - 1 - c];
                if (orig[c] !== v) moved = true;
                nb[r][c] = v;
                ns[r][c] = slide[SIZE - 1 - c];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r, c: SIZE - 1 - m.dest, srcR: r, srcC: SIZE - 1 - m.src, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r, c: SIZE - 1 - i, srcR: r, srcC: SIZE - 1 - filteredIdx[i], value: slide[i] });
                }
            }
        }
    }

    return { board: nb, slideBoard: ns, mergeCells, moveCells, score: totalScore, moved };
}

function _canMove(b) {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
            if (b[r][c] === 0) return true;
            if (c + 1 < SIZE && b[r][c] === b[r][c + 1]) return true;
            if (r + 1 < SIZE && b[r][c] === b[r + 1][c]) return true;
        }
    return false;
}

function _hasWon(b) {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (b[r][c] >= 2048) return true;
    return false;
}

export { _emptyBoard, _spawnTile, _copyBoard, _slide, _hasWon, _canMove };
