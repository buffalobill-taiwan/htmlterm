/**
 * Entry point. Creates Terminal and DemoShell, wires callbacks.
 * Globals window.term / window.shell exposed for debugging.
 */

import { Terminal } from './terminal.js';
import { DemoShell } from './shell.js';

const term = new Terminal(document.getElementById('screen'), {
    cols: 80,
    rows: 25,
    charWidth: 8,
    charHeight: 16,
});

const shell = new DemoShell(term);
term.onData = (data) => shell.handleInput(data);
term.onMouse = (type, info) => shell.system.handleMouse(type, info);
term.focus();

window.term = term;
window.shell = shell;
