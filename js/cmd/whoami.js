class Whoami extends CmdBase {
    execute(args) {
        this.print('user\n');
    }
    static get commandName() { return 'whoami'; }
    static get help() { return 'Show user'; }
    static get menu() { return 'Show User'; }
}
