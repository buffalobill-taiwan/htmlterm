export const DIFFICULTY = {
    easy: [20, 10], medium: [40, 15], hard: [60, 20],
};
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Carve a spanning tree through alternate tiles; intervening tiles are walls.
export function generateMaze(width, height) {
    const walls = new Uint8Array(width * height).fill(1);
    const stack = [0];
    walls[0] = 0;
    while (stack.length) {
        const pos = stack[stack.length - 1];
        const x = pos % width, y = Math.floor(pos / width);
        const choices = DIRECTIONS.filter(([dx, dy]) => {
            const nx = x + dx * 2, ny = y + dy * 2;
            return nx >= 0 && nx < width && ny >= 0 && ny < height && walls[ny * width + nx];
        });
        if (!choices.length) { stack.pop(); continue; }
        const [dx, dy] = choices[Math.floor(Math.random() * choices.length)];
        const next = (y + dy * 2) * width + x + dx * 2;
        walls[(y + dy) * width + x + dx] = 0;
        walls[next] = 0;
        stack.push(next);
    }
    // Even dimensions leave a final wall strip. Extend its nearest passage
    // to the exact bottom-right tile without opening the rest of the strip.
    const lastX = (width - 1) & ~1, lastY = (height - 1) & ~1;
    for (let x = lastX; x < width; x++) walls[lastY * width + x] = 0;
    for (let y = lastY; y < height; y++) walls[y * width + width - 1] = 0;
    return walls;
}

// Reveal wall faces beside visible passages, even when the wall's center is
// occluded (for example, the side wall two steps along a straight corridor).
// Three tiles means horizontal plus vertical distance, including wall tiles.
export function isVisible(walls, width, px, py, tx, ty) {
    if (Math.abs(tx - px) + Math.abs(ty - py) > 3) return false;
    if (hasSightline(walls, width, px, py, tx, ty)) return true;
    if (!walls[ty * width + tx]) return false;
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
