// Input is a connected, acyclic maze with its final exit passage already carved.
export function scoreMaze(walls, width, height) {
    const parent = new Int32Array(walls.length).fill(-1);
    const order = [0];
    parent[0] = 0;
    for (let i = 0; i < order.length; i++) {
        const pos = order[i], x = pos % width, y = Math.floor(pos / width);
        for (const next of [x > 0 ? pos - 1 : -1, x + 1 < width ? pos + 1 : -1,
            y > 0 ? pos - width : -1, y + 1 < height ? pos + width : -1]) {
            if (next < 0 || walls[next] || parent[next] !== -1) continue;
            parent[next] = pos;
            order.push(next);
        }
    }

    // Each subtree count includes nested branches and corridor tiles.
    const subtree = new Int32Array(walls.length);
    for (let i = order.length - 1; i >= 0; i--) {
        const pos = order[i];
        subtree[pos]++;
        if (pos !== 0) subtree[parent[pos]] += subtree[pos];
    }
    const path = [];
    for (let pos = walls.length - 1; ; pos = parent[pos]) {
        path.push(pos);
        if (pos === 0) break;
    }
    path.reverse();

    let coverage = 0, segments = 0, lateCells = 0, branchCells = 0, junctions = 0;
    const steps = path.length - 1;
    for (let i = 0; i < path.length; i++) {
        // Remove the current tile and the subtree continuing toward the exit.
        const size = subtree[path[i]] - 1 - (i < steps ? subtree[path[i + 1]] : 0);
        if (!size) continue;
        branchCells += size;
        // Integer arithmetic keeps exact 20%/80% boundaries consistent.
        if (i * 5 >= steps * 4) {
            lateCells += size;
        } else {
            segments |= 1 << Math.floor(i * 5 / steps);
            junctions++;
        }
    }
    for (let bit = 0; bit < 4; bit++) if (segments & (1 << bit)) coverage++;
    return { coverage, lateFraction: branchCells ? lateCells / branchCells : 0, junctions };
}

// Lexicographic ranking; an exact tie keeps the earlier candidate.
export function isBetterMazeScore(candidate, best) {
    if (candidate.coverage !== best.coverage) return candidate.coverage > best.coverage;
    if (candidate.lateFraction !== best.lateFraction) return candidate.lateFraction < best.lateFraction;
    return candidate.junctions > best.junctions;
}
