/**
 * Abstract base for all shell commands.
 *
 * Subclasses must implement execute(args) and define static getters:
 * - commandName → registration key
 * - help → description shown in `help` output
 * - menu → menu description (or null to hide from menu)
 */

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
}
