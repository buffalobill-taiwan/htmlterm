/**
 * Abstract base for all shell commands.
 *
 * Subclasses must implement execute(args) and define static getters:
 * - commandName → registration key
 * - help → description shown in `help` output
 * - menu → menu description (or null to hide from menu)
 * - usage → "commandName [--flag VALUE]" for auto --help output
 *
 * Built-in helpers:
 *   error(text)        — print red "Error: text" + newline
 *   parseArgs(args)    — returns { hasHelp, flag(long,short), rest[] }
 *   showHelp()         — prints commandName + help + usage
 */

import { red, bold, yellow } from '../sgr.js';

export class CmdBase {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
    }
    execute(args) {}
    print(text) { this.shell.print(text); }
    readLine(callback) { this.shell.readLine(callback); }
    static get commandName() { return ''; }
    static get help() { return ''; }
    static get menu() { return null; }
    static get usage() { return null; }

    error(text) {
        this.print(red('Error: ' + text) + '\n');
    }

    parseArgs(args) {
        const result = { hasHelp: false, rest: [] };
        const flags = {};
        result.flag = (long, short) =>
            flags[long] !== undefined ? flags[long] :
            (flags[short] !== undefined ? flags[short] : null);

        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === '--help' || a === '-h') {
                result.hasHelp = true;
            } else if (a.startsWith('--')) {
                const eqIdx = a.indexOf('=');
                if (eqIdx > 0) {
                    flags[a.substring(0, eqIdx)] = a.substring(eqIdx + 1);
                } else {
                    flags[a] = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[++i] : true;
                }
            } else if (a.startsWith('-') && a.length === 2) {
                flags[a] = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[++i] : true;
            } else {
                result.rest.push(a);
            }
        }
        return result;
    }

    showHelp() {
        const name = this.constructor.commandName;
        const help = this.constructor.help;
        const usage = this.constructor.usage;
        if (name) this.print(bold(yellow(name)) + '\n');
        if (help) this.print('  ' + help + '\n');
        if (usage) this.print('  Usage: ' + usage + '\n');
    }
}
