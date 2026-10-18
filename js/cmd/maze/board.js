import { scoreMaze, isBetterMazeScore } from './generation-score.js';
import { mulberry32, parseSeed, SEED_MAX } from '../../util/random.js';

export const DIFFICULTY = {
    easy: [20, 10], medium: [40, 15], hard: [60, 20],
};
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const CANDIDATE_COUNT = 24;

// Prefer choices throughout the route, rather than large branches near the exit.
export function generateMaze(width, height, seed = Math.floor(Math.random() * (SEED_MAX + 1))) {
    seed = parseSeed(seed);
    if (seed === null) throw new RangeError('Seed must be an integer from 0 to 2147483647.');
    const random = mulberry32(seed);
    let best = null, bestScore = null;
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
        const walls = growMaze(width, height, random);
        const score = scoreMaze(walls, width, height);
        if (bestScore === null || isBetterMazeScore(score, bestScore)) {
            best = walls;
            bestScore = score;
        }
    }
    return best;
}

// Growing Tree: alternate depth-first growth with random active locations.
// Only connect unvisited nodes, preserving a spanning tree of the passages.
function growMaze(width, height, random) {
    const walls = new Uint8Array(width * height).fill(1);
    const active = [0];
    walls[0] = 0;
    while (active.length) {
        const index = random() < 0.5 ? active.length - 1
            : Math.floor(random() * active.length);
        const pos = active[index];
        const x = pos % width, y = Math.floor(pos / width);
        const choices = DIRECTIONS.filter(([dx, dy]) => {
            const nx = x + dx * 2, ny = y + dy * 2;
            return nx >= 0 && nx < width && ny >= 0 && ny < height && walls[ny * width + nx];
        });
        // Preserve insertion order so the last entry remains the newest node.
        if (!choices.length) { active.splice(index, 1); continue; }
        const [dx, dy] = choices[Math.floor(random() * choices.length)];
        const next = (y + dy * 2) * width + x + dx * 2;
        walls[(y + dy) * width + x + dx] = 0;
        walls[next] = 0;
        active.push(next);
    }
    // Even dimensions leave a final wall strip. Extend its nearest passage
    // to the exact bottom-right tile without opening the rest of the strip.
    const lastX = (width - 1) & ~1, lastY = (height - 1) & ~1;
    for (let x = lastX; x < width; x++) walls[lastY * width + x] = 0;
    for (let y = lastY; y < height; y++) walls[y * width + width - 1] = 0;
    return walls;
}

// Reveal cells that hang off sight-visible passages: a wall face beside a
// visible passage (even when the wall's center is occluded, for example the
// side wall two steps along a straight corridor), and the doorway passage at
// a visible corridor's end. Manhattan distance ≤ 3, counting wall tiles.
export function isVisible(walls, width, px, py, tx, ty) {
    if (Math.abs(tx - px) + Math.abs(ty - py) > 3) return false;
    if (hasSightline(walls, width, px, py, tx, ty)) return true;
    // One-hop face/doorway reveal: some passage neighbor owes its own center
    // sightline. Center sightlines still do not propagate around bends, so
    // cells past this neighbor stay hidden (no cascading reveals).
    const height = walls.length / width;
    for (const [dx, dy] of DIRECTIONS) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || x >= width || y < 0 || y >= height || walls[y * width + x]) continue;
        if (hasSightline(walls, width, px, py, x, y)) return true;
    }
    return false;
}

// Center-to-center sightlines do not propagate around bends. A corner is
// blocked only when both sides are walls.
function hasSightline(walls, width, px, py, tx, ty) {
    const dx = tx - px, dy = ty - py;
    if (Math.abs(dx) + Math.abs(dy) > 3) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const ax = Math.abs(dx), ay = Math.abs(dy);
    let x = px, y = py, ix = 0, iy = 0;
    while (x !== tx || y !== ty) {
        const crossX = (2 * ix + 1) * ay;
        const crossY = (2 * iy + 1) * ax;
        if (crossX === crossY) {
            if (walls[y * width + x + sx] && walls[(y + sy) * width + x]) return false;
            x += sx; y += sy; ix++; iy++;
        } else if (crossX < crossY) {
            x += sx; ix++;
        } else {
            y += sy; iy++;
        }
        if (x === tx && y === ty) return true;
        if (walls[y * width + x]) return false;
    }
    return true;
}
