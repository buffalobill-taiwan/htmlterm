#!/usr/bin/env node
/**
 * compress-anime.js — Compress anime frames into RLE0 + diffs representation.
 *
 * Usage:
 *   node tools/compress-anime.js [options] [input] [output]
 *
 * Options:
 *   --input, -i <path>   Input file path (raw uncompressed anime module or JSON)
 *   --output, -o <path>  Output file path (.json or .js)
 *   --help, -h           Show this help message
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';
import { computeRLE, computeDiff } from '../js/util/pixel-codec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
    console.log(`compress-anime.js — Compress anime frames into RLE0 + diffs

Usage:
  node tools/compress-anime.js [input] [output]
  node tools/compress-anime.js --input <in> --output <out>

Options:
  -i, --input <file>   Input file (.js, .mjs, or .json)
  -o, --output <file>  Output file (.json or .js)
  -h, --help           Show help`);
}

async function loadData(filePath) {
    if (filePath.endsWith('.json')) {
        const text = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(text);
    }
    const fileUrl = pathToFileURL(path.resolve(filePath)).href;
    const mod = await import(fileUrl);
    return mod.default || mod;
}

async function main() {
    const args = process.argv.slice(2);
    let inputPath = null;
    let outputPath = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printHelp();
            return;
        } else if ((arg === '--input' || arg === '-i') && i + 1 < args.length) {
            inputPath = args[++i];
        } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
            outputPath = args[++i];
        } else if (!arg.startsWith('-')) {
            if (!inputPath) inputPath = arg;
            else if (!outputPath) outputPath = arg;
        }
    }

    if (!inputPath) {
        // Default to js/data/anime.json for inspection/reporting if no args
        inputPath = path.resolve(__dirname, '..', 'js/data/anime.json');
    }

    if (!fs.existsSync(inputPath)) {
        console.error(`Error: input file not found: ${inputPath}`);
        process.exit(1);
    }

    const data = await loadData(inputPath);
    const { cols, rows } = data;
    const totalPixels = cols * rows;

    if (data.rle0 && Array.isArray(data.diffs)) {
        // Already compressed data
        console.log('File is already compressed:', inputPath);
        console.log('Dimensions:', `${cols}x${rows} (${totalPixels} pixels/frame)`);
        console.log('Frames:', data.frames);
        console.log('RLE0 length:', data.rle0.length);
        const totalDiffEntries = data.diffs.reduce((sum, d) => sum + d.length, 0);
        console.log('Total diff entries:', totalDiffEntries);
        const content = fs.readFileSync(inputPath);
        const gzipped = zlib.gzipSync(content);
        console.log('File size:', content.length, 'bytes');
        console.log('Gzip size:', gzipped.length, 'bytes');
        return;
    }

    if (!Array.isArray(data.frames)) {
        console.error('Error: input data must contain a frames array');
        process.exit(1);
    }

    const pixelFrames = data.frames.map(f => new Uint8Array(f));
    const rle0 = computeRLE(pixelFrames[0]);

    const diffs = [];
    for (let i = 1; i < pixelFrames.length; i++) {
        diffs.push(computeDiff(pixelFrames[i - 1], pixelFrames[i]));
    }

    const compressedPayload = {
        cols,
        rows,
        frames: pixelFrames.length,
        rle0,
        diffs,
    };

    if (!outputPath) {
        outputPath = inputPath.endsWith('.json') ? inputPath : inputPath.replace(/\.(js|mjs)$/, '.json');
        if (outputPath === inputPath && !inputPath.endsWith('.json')) {
            outputPath = path.resolve(__dirname, '..', 'js/data/anime.json');
        }
    }

    let outContent = '';
    if (outputPath.endsWith('.json')) {
        outContent = JSON.stringify(compressedPayload) + '\n';
    } else {
        outContent = `export default ${JSON.stringify(compressedPayload)};\n`;
    }

    fs.writeFileSync(outputPath, outContent);

    const rawSize = pixelFrames.reduce((s, f) => s + f.length, 0);
    const writtenSize = Buffer.byteLength(outContent);
    const gzipped = zlib.gzipSync(Buffer.from(outContent));

    console.log('Compressed successfully!');
    console.log('Written to:', outputPath);
    console.log('Dimensions:', `${cols}x${rows} (${totalPixels} pixels/frame)`);
    console.log('Frames:', pixelFrames.length);
    console.log('Raw pixel size:', rawSize, 'bytes');
    console.log('Output size:', writtenSize, 'bytes', `(${((writtenSize / rawSize) * 100).toFixed(1)}% of raw)`);
    console.log('RLE0 length:', rle0.length, '→', ((rle0.length / (totalPixels * 2)) * 100).toFixed(1), '% of frame 0');
    const totalDiffEntries = diffs.reduce((sum, d) => sum + d.length, 0);
    console.log('Total diff entries:', totalDiffEntries, '→', ((totalDiffEntries / (rawSize - totalPixels)) * 100).toFixed(1), '% of remaining raw');
    console.log('Gzip size:', gzipped.length, 'bytes');
}

main().catch(e => { console.error(e); process.exit(1); });
