class CmdBase {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
    }
    execute(args) {}
    print(text) { this.term.write(text); }
    static get commandName() { return ''; }
    static get help() { return ''; }
    static get menu() { return null; }
}
