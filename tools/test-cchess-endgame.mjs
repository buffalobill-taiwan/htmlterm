#!/usr/bin/env node
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFen, boardToFen } from '../js/cmd/cchess/engine/notation.js';
import { applyBoardCopy } from '../js/cmd/cchess/engine/board.js';
import { chooseBlackReply } from '../js/cmd/cchess/black-ai.js';
import { responseMove } from '../js/cmd/cchess/endgames.js';

const dir = path.dirname(fileURLToPath(new URL('../js/data/cchess/index.json', import.meta.url)));
const index = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8'));
const key = b => boardToFen(b).split(' ')[0];

test('endgame index and shipped files agree', async () => {
    assert.ok(Array.isArray(index) && index.length > 0);
    for (const entry of index) {
        const puzzle = JSON.parse(await fs.readFile(path.join(dir, entry.file), 'utf8'));
        assert.equal(puzzle.meta.name, entry.name, entry.file);
        assert.equal(puzzle.meta.step, entry.step, entry.file);
        assert.ok(puzzle.table && typeof puzzle.table === 'object', entry.file);
    }
});

test('shipped tables keep only defenses the black AI does not reproduce', async () => {
    for (const entry of index) {
        const puzzle = JSON.parse(await fs.readFile(path.join(dir, entry.file), 'utf8'));
        const keys = Object.keys(puzzle.table);
        if (!keys.length) continue;
        const stride = Math.max(1, Math.ceil(keys.length / 8));
        for (let i = 0; i < keys.length; i += stride) {
            const k = keys[i], target = puzzle.table[k];
            const board = parseFen(k, { allowMissingKings: false }).board;
            const reply = await chooseBlackReply(board);
            const after = reply ? key(applyBoardCopy(board, reply)) : null;
            assert.notEqual(after, target, `${entry.file}: ${k} is still reproducible`);
            assert.ok(responseMove(board, target), `${entry.file}: ${k} target is not a legal reply`);
        }
    }
});

test('black AI is deterministic', async () => {
    for (const entry of index) {
        const puzzle = JSON.parse(await fs.readFile(path.join(dir, entry.file), 'utf8'));
        const keys = Object.keys(puzzle.table);
        if (keys.length < 2) continue;
        for (const k of keys.slice(0, 3)) {
            const board = parseFen(k, { allowMissingKings: false }).board;
            assert.deepEqual(await chooseBlackReply(board), await chooseBlackReply(board), k);
        }
        return;
    }
    assert.fail('no endgame with entries');
});
