class Clear extends CmdBase {
    execute(args) {
        this.term.write('\x1B[2J\x1B[H');
    }
    static get commandName() { return 'clear'; }
    static get help() { return 'Clear the screen'; }
    static get menu() { return 'Clear Screen'; }
}
