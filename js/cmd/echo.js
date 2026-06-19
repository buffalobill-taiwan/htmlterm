class Echo extends CmdBase {
    execute(args) {
        this.print(args.join(' ') + '\n');
    }
    static get commandName() { return 'echo'; }
    static get help() { return 'Echo text'; }
    static get menu() { return null; }
}
