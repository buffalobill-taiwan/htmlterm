#!/usr/bin/env node
/**
 * png2art — Convert a PNG image to an art.js pixel array.
 *
 * Usage:
 *   node tools/png2art.js /path/to/image.png [--name VAR_NAME]
 *
 * Output: JS array literal + ARTWORKS entry template, printed to stdout.
 * Requires ImageMagick `convert` on PATH.
 */

const { execSync } = require('child_process');
const { basename } = require('path');

const filePath = process.argv[2];
if (!filePath) {
    process.stderr.write('Usage: node tools/png2art.js <image.png> [--name VAR_NAME]\n');
    process.exit(1);
}

let varName;
for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--name' && i + 1 < process.argv.length) {
        varName = process.argv[++i];
    }
}
if (!varName) {
    varName = basename(filePath, '.png')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^(\d)/, '_$1')
        .toUpperCase() + '_PIXELS';
}

let txt;
try {
    txt = execSync(`convert "${filePath}" -depth 8 txt:-`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
} catch (e) {
    process.stderr.write('Error running convert: ' + e.message + '\n');
    process.exit(1);
}

const lines = txt.trim().split('\n').slice(1);
const pixels = [];
let maxX = -1, maxY = -1;

for (const line of lines) {
    const m = line.match(/^(\d+),(\d+):.*#([0-9A-Fa-f]{6})/);
    if (!m) continue;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    const hex = m[3].toUpperCase();
    pixels.push({ x, y, hex });
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
}

const W = maxX + 1;
const H = maxY + 1;

pixels.sort((a, b) => a.y - b.y || a.x - b.x);

const rows = [];
for (let r = 0; r < H; r++) {
    const rowPixels = pixels.slice(r * W, (r + 1) * W).map(p => `'${p.hex}'`);
    rows.push("    " + rowPixels.join(',') + ",");
}

const out = `\
// ${filePath} — ${W}×${H} (${pixels.length} pixels)
// Add to ARTWORKS:
// { name: '${basename(filePath, '.png')}', cols: ${W}, pixels: ${varName} },
//
const ${varName} = [
${rows.join('\n')}
];
`;

process.stdout.write(out);
