#!/usr/bin/env node
// Import every browser module in Node to catch syntax errors, broken import
// paths, and module-evaluation side effects.
//
// This is not a runtime smoke test: DOM globals do not exist here, so a
// module that touches window/document/self is reported as skipped rather than
// as a failure. Commands that fetch relative URLs at module-evaluation time
// are also expected to fail; keep such work lazy.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const browserGlobals = /\b(self|window|document) is not defined/;

const modules = [];
(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) modules.push(full);
    }
})(path.join(root, 'js'));

let ok = 0;
const failed = [];
const skipped = [];
for (const file of modules) {
    try {
        await import(pathToFileURL(file).href);
        ok++;
    } catch (err) {
        const message = String(err.message).split('\n')[0];
        const item = `${path.relative(root, file)} → ${message}`;
        if (err instanceof ReferenceError && browserGlobals.test(message)) skipped.push(item);
        else failed.push(item);
    }
}

console.log(`imported ${ok} of ${modules.length}`);
if (skipped.length) console.log(`  browser-only (skipped): ${skipped.join(', ')}`);
for (const item of failed) console.log(`  FAIL ${item}`);
if (failed.length) process.exit(1);
