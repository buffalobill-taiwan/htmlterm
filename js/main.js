/**
 * Entry point. Creates Terminal and SystemManager, wires callbacks.
 * Globals window.term / window.system exposed for debugging.
 */

import { Terminal } from './terminal/terminal.js';
import { SystemManager } from './shell/system.js';
import * as cmdModule from './cmd/index.js';

const term = new Terminal(document.getElementById('screen'), {
    cols: 80,
    rows: 25,
    charWidth: 8,
    charHeight: 16,
});

new SystemManager(term, cmdModule);
term.onData = (data) => SystemManager.instance.handleInput(data);
term.onMouse = (type, info) => SystemManager.instance.handleMouse(type, info);
term.focus();

window.term = term;
window.system = SystemManager.instance;
