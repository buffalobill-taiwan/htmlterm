class Uname extends CmdBase {
    execute(args) {
        this.print('OpenCode Terminal v1.0.0\n');
    }
    static get commandName() { return 'uname'; }
    static get help() { return 'Show system info'; }
    static get menu() { return 'System Name'; }
}
