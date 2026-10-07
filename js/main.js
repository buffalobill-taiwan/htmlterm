/**
 * Entry point. Creates Terminal and SystemManager, wires callbacks.
 * Globals window.term / window.system exposed for debugging.
 */

import { Terminal } from './terminal/terminal.js';
import { SystemManager } from './system/system.js';
import * as cmdModule from './cmd/index.js';
import { warn } from './util/sgr.js';

// Without these a throw inside an event handler or a rejected fetch fails
// silently: the page keeps rendering while the shell stops responding.
window.addEventListener('error', (e) => {
    warn('uncaught: ' + (e.message || 'error') +
        (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''));
});
window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    warn('unhandled rejection: ' + (r && r.stack ? r.stack : r));
});

const term = new Terminal(document.getElementById('screen'), {
    cols: 80,
    rows: 25,
    charWidth: 8,
    charHeight: 16,
});

new SystemManager(term, cmdModule);
term.onData = (data) => SystemManager.instance.handleInput(data);
term.onMouse = (type, info) => SystemManager.instance.handleMouse(type, info);
term.onKeyUp = (key) => SystemManager.instance.handleKeyUp(key);
term.focus();

window.term = term;
window.system = SystemManager.instance;
