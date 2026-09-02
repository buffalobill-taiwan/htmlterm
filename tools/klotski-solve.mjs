#!/usr/bin/env node
/**
 * klotski-solve — Bake the known-optimal solutions for the game's 11 fixed
 * Klotski levels into js/util/klotski-solutions.js.
 *
 * The games are the classic layouts, whose optimal solutions were precomputed
 * and are stored (with their original API JSON) in tools/klotski-raw/*.json.
 * This tool decodes each recorded solution into the engine's single-grid slide
 * format, replay-verifies it, and only falls back to a local 0-1 BFS for any
 * level whose recorded solution fails to verify (network/layout drift).
 *
 * Usage:
 *   node tools/klotski-solve.mjs
 *
 * Output: js/util/klotski-solutions.js  (static data; curated at build time)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEVELS } from '../js/util/klotski-levels.js';

const COLS = 4;
const ROWS = 5;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'klotski-raw');
const OUT_FILE = path.join(__dirname, '..', 'js', 'util', 'klotski-solutions.js');

// Mirror of js/cmd/klotski.js `_buildBlocks`.
function buildBlocks(boardStr) {
    const posByLetter = {};
    for (let i = 0; i < boardStr.length; i++) {
        const ch = boardStr[i];
        if (ch === '@') continue;
        if (!posByLetter[ch]) posByLetter[ch] = [];
        posByLetter[ch].push([Math.floor(i / COLS), i % COLS]);
    }
    const infos = [];
    for (const letter of Object.keys(posByLetter)) {
        const list = posByLetter[letter];
        let minR = 9, maxR = -1, minC = 9, maxC = -1;
        for (const [r, c] of list) {
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (c < minC) minC = c;
            if (c > maxC) maxC = c;
        }
        infos.push({ letter, r: minR, c: minC, w: maxC - minC + 1, h: maxR - minR + 1 });
    }
    infos.sort((a, b) => a.r - b.r || a.c - b.c);

    const rects = infos.filter(x => (x.w === 2 && x.h === 1) || (x.w === 1 && x.h === 2));
    const vNames = ['張飛', '趙雲', '馬超', '黃忠'];
    const hNames = ['關羽', '關平', '關興', '關索', '關統'];
    const names = new Map();
    let vi = 0, hi = 0;
    for (const x of rects) {
        if (x.w === 2 && x.h === 1) names.set(x.letter, hNames[hi++]);
        else names.set(x.letter, vNames[vi++]);
    }

    const blocks = [];
    for (const info of infos) {
        let name;
        if (info.w === 2 && info.h === 2) name = '曹';
        else if (info.w === 2 && info.h === 1) name = names.get(info.letter);
        else if (info.w === 1 && info.h === 2) name = names.get(info.letter);
        else name = '兵';
        blocks.push({ name, w: info.w, h: info.h, r: info.r, c: info.c });
    }
    blocks.sort((a, b) => (a.name === '曹' ? -1 : 1) - (b.name === '曹' ? -1 : 1));
    return blocks;
}

// Move codes 0-16 (hex 0-f) per klotski.online:
// 0-3 single, 4-7 double, 8-15 the 8 diagonal orderings.
const DIRS = { l: [0, -1], u: [-1, 0], r: [0, 1], d: [1, 0] };
const MOVE_TABLE = [
    ['l'], ['u'], ['r'], ['d'],
    ['l', 'l'], ['u', 'u'], ['r', 'r'], ['d', 'd'],
    ['l', 'u'], ['l', 'd'],
    ['u', 'l'], ['u', 'r'],
    ['r', 'u'], ['r', 'd'],
    ['d', 'l'], ['d', 'r'],
];

function makeGrid(blocks) {
    const grid = new Array(ROWS * COLS).fill(-1);
    for (let id = 0; id < blocks.length; id++) {
        const b = blocks[id];
        for (let dy = 0; dy < b.h; dy++)
            for (let dx = 0; dx < b.w; dx++)
                grid[(b.r + dy) * COLS + (b.c + dx)] = id;
    }
    return grid;
}

function canSlide(blocks, grid, id, dr, dc) {
    const b = blocks[id];
    for (let dy = 0; dy < b.h; dy++)
        for (let dx = 0; dx < b.w; dx++) {
            const nr = b.r + dy + dr, nc = b.c + dx + dc;
            if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return false;
            if (grid[nr * COLS + nc] !== -1 && grid[nr * COLS + nc] !== id) return false;
        }
    return true;
}

function applySlide(blocks, grid, id, dr, dc) {
    const b = blocks[id];
    for (let dy = 0; dy < b.h; dy++)
        for (let dx = 0; dx < b.w; dx++)
            grid[(b.r + dy) * COLS + (b.c + dx)] = -1;
    b.r += dr;
    b.c += dc;
    for (let dy = 0; dy < b.h; dy++)
        for (let dx = 0; dx < b.w; dx++)
            grid[(b.r + dy) * COLS + (b.c + dx)] = id;
}

// Replay one recorded solution on `board`; returns flat frame list
// [{id, dr, dc}] or null if any step is illegal / it fails to reach the goal.
// `mirror` interprets coords/moves in the horizontally mirrored geometry
// (klotski.online stores some layouts mirrored).
function decodeSolution(rawSolution, board, mirror) {
    const blocks = buildBlocks(board);
    const grid = makeGrid(blocks);
    const frames = [];
    if (typeof rawSolution !== 'string' || rawSolution.length % 2 !== 0) return null;
    for (let i = 0; i < rawSolution.length; i += 2) {
        const coord = rawSolution.charCodeAt(i) - 103; // g..z -> 0..19
        const code = parseInt(rawSolution[i + 1], 16);
        if (coord < 0 || coord >= ROWS * COLS || !Number.isFinite(code)) return null;
        const r = Math.floor(coord / COLS), c = coord % COLS;
        const idx = mirror ? r * COLS + (COLS - 1 - c) : coord;
        const id = grid[idx];
        if (id === -1 || !MOVE_TABLE[code]) return null;
        for (const axis of MOVE_TABLE[code]) {
            let [dr, dc] = DIRS[axis];
            if (mirror) dc = -dc;
            if (!canSlide(blocks, grid, id, dr, dc)) return null;
            applySlide(blocks, grid, id, dr, dc);
            frames.push({ id, dr, dc });
        }
    }
    const chn = blocks[0];
    if (chn.name !== '曹' || chn.r !== 3 || chn.c !== 1) return null;
    return frames;
}

// Count displayed steps as the game does: consecutive slides of the same block
// merge into one step.
function mergedSteps(frames) {
    let count = 0, last = -1;
    for (const f of frames) {
        if (f.id !== last) count++;
        last = f.id;
    }
    return count;
}

// 0-1 BFS fallback (same algorithm the game used before solutions were baked).
function solveLocal(blocks) {
    const n = blocks.length;
    const D = [[-1, 0], [0, -1], [1, 0], [0, 1]];
    const posKey = (bs) => {
        const parts = [];
        for (const b of bs) parts.push(b.r, b.c);
        return parts.join(',');
    };
    const stateKey = (bs, lastId) => posKey(bs) + '|' + lastId;
    const board = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
    const buildBoard = (bs) => {
        for (let rr = 0; rr < ROWS; rr++)
            for (let cc = 0; cc < COLS; cc++) board[rr][cc] = -1;
        for (let id = 0; id < bs.length; id++) {
            const b = bs[id];
            for (let dy = 0; dy < b.h; dy++)
                for (let dx = 0; dx < b.w; dx++)
                    board[b.r + dy][b.c + dx] = id;
        }
    };
    const maxSlide = (bs, id, dr, dc) => {
        const b = bs[id];
        let mx = 0;
        outer: for (let s = 1; ; s++) {
            for (let dy = 0; dy < b.h; dy++)
                for (let dx = 0; dx < b.w; dx++) {
                    const nr = b.r + dy + dr * s, nc = b.c + dx + dc * s;
                    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break outer;
                    const v = board[nr][nc];
                    if (v !== -1 && v !== id) break outer;
                }
            mx = s;
        }
        return mx;
    };

    const dist = new Map();
    const prev = new Map();
    const st0 = blocks.map(b => ({ ...b }));
    const sk0 = stateKey(st0, -1);
    dist.set(sk0, 0);
    const deque = [{ key: sk0, blocks: st0, lastId: -1, cost: 0 }];
    while (deque.length) {
        const cur = deque.shift();
        if (dist.get(cur.key) < cur.cost) continue;
        if (cur.blocks[0].name === '曹' && cur.blocks[0].r === 3 && cur.blocks[0].c === 1) {
            const moves = [];
            let ck = cur.key;
            while (prev.has(ck)) {
                const p = prev.get(ck);
                moves.unshift({ id: p.id, dr: p.dr, dc: p.dc, s: p.s });
                ck = p.key;
            }
            const frames = [];
            for (const mv of moves)
                for (let k = 0; k < mv.s; k++)
                    frames.push({ id: mv.id, dr: mv.dr, dc: mv.dc });
            return frames;
        }
        buildBoard(cur.blocks);
        for (let id = 0; id < n; id++) {
            for (const [dr, dc] of D) {
                const mx = maxSlide(cur.blocks, id, dr, dc);
                for (let s = 1; s <= mx; s++) {
                    const next = cur.blocks.map(b => ({ ...b }));
                    next[id].r += dr * s; next[id].c += dc * s;
                    const nk = stateKey(next, id);
                    const nc = cur.cost + (id === cur.lastId ? 0 : 1);
                    if (dist.has(nk) && dist.get(nk) <= nc) continue;
                    dist.set(nk, nc);
                    prev.set(nk, { key: cur.key, id, dr, dc, s });
                    if (id === cur.lastId)
                        deque.unshift({ key: nk, blocks: next, lastId: id, cost: nc });
                    else
                        deque.push({ key: nk, blocks: next, lastId: id, cost: nc });
                }
            }
        }
    }
    return null;
}

function main() {
    const output = {};
    let failed = false;
    for (const lv of LEVELS) {
        const rawPath = path.join(RAW_DIR, lv.name + '.json');
        let verbose, frames = null;
        if (fs.existsSync(rawPath)) {
            const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
            if (typeof raw.solution === 'string' && raw.solution !== 'no solution') {
                for (const mirror of raw.mirror === '1' ? [false, true] : [false]) {
                    const trial = decodeSolution(raw.solution, lv.board, mirror);
                    if (trial && mergedSteps(trial) === lv.mini) {
                        frames = trial;
                        verbose = mirror ? 'API(鏡像)' : 'API';
                        break;
                    }
                }
            }
        }
        if (!frames) {
            const t0 = Date.now();
            frames = solveLocal(buildBlocks(lv.board));
            const ms = Date.now() - t0;
            if (!frames) {
                console.error(`✗ ${lv.name}: 無法求解`);
                process.exitCode = 1;
                continue;
            }
            verbose = `BFS(回退, ${ms}ms)`;
        }
        const steps = mergedSteps(frames);
        const flag = steps === lv.mini ? '✓' : '✗';
        if (steps !== lv.mini) failed = true;
        console.log(`${flag} ${lv.name}: ${steps} / mini ${lv.mini}  [${verbose}] (${frames.length} 格)`);
        output[lv.board] = frames;
    }

    const lines = ['export default {'];
    for (const [board, frames] of Object.entries(output)) {
        lines.push(`    '${board}': [`);
        for (const f of frames)
            lines.push(`        { id: ${f.id}, dr: ${f.dr}, dc: ${f.dc} },`);
        lines.push('    ],');
    }
    lines.push('};');
    fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');
    console.log(`\n寫入 ${OUT_FILE}（${Object.keys(output).length} 關）`);
    if (failed) process.exitCode = 1;
}

main();