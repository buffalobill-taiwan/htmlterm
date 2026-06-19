class Help extends CmdBase {
    execute(args) {
        this.print('\x1B[1;33mAvailable commands:\x1B[0m\n');
        for (const { name, help } of this.shell._cmdList) {
            this.print('  ' + name.padEnd(11) + help + '\n');
        }
    }
    static get commandName() { return 'help'; }
    static get help() { return 'Show this help'; }
    static get menu() { return 'Available Commands'; }
}
