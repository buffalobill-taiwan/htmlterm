class MenuCmd extends CmdBase {
    execute(args) {
        this.shell._menuCmd();
    }
    static get commandName() { return 'menu'; }
    static get help() { return 'Open command menu'; }
    static get menu() { return null; }
}
