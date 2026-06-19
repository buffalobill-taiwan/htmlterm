class Exit extends CmdBase {
    execute(args) {
        this.print('Goodbye!\n');
    }
    static get commandName() { return 'exit'; }
    static get help() { return 'Exit (just for fun)'; }
    static get menu() { return null; }
}
