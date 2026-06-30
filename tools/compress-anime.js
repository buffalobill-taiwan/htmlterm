import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { computeRLE, computeDiff } from '../js/util/pixel-codec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const dataPath = path.resolve(__dirname, '..', 'js/cmd/art/anime.js');
    const mod = await import(pathToFileURL(dataPath).href);
    const { cols, rows, frames } = mod.default;
    const totalPixels = cols * rows;

    const pixelFrames = frames.map(f => new Uint8Array(f));
    const rle0 = computeRLE(pixelFrames[0]);

    const diffs = [];
    for (let i = 1; i < pixelFrames.length; i++) {
        diffs.push(computeDiff(pixelFrames[i - 1], pixelFrames[i]));
    }

    const out = `export default ${JSON.stringify({
        cols,
        rows,
        frames: pixelFrames.length,
        rle0,
        diffs,
    })};\n`;

    fs.writeFileSync(dataPath, out);

    const rawSize = pixelFrames.reduce((s, f) => s + f.length, 0);
    console.log('Written:', dataPath);
    console.log('Size:', fs.statSync(dataPath).size, 'bytes', `(${((fs.statSync(dataPath).size / 534935) * 100).toFixed(1)}% of original)`);
    console.log('Frames:', pixelFrames.length);
    console.log('RLE0 length:', rle0.length, '→', ((rle0.length / (totalPixels * 2)) * 100).toFixed(1), '% of raw');
    const totalDiffEntries = diffs.reduce((sum, d) => sum + d.length, 0);
    console.log('Total diff entries:', totalDiffEntries, '→', ((totalDiffEntries / (rawSize - totalPixels)) * 100).toFixed(1), '% of raw');
    console.log('Gzip:', (await $`gzip -c ${dataPath} | wc -c`).toString().trim(), 'bytes');
}

main().catch(e => { console.error(e); process.exit(1); });
