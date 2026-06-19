class Neofetch extends CmdBase {
    execute(args) {
        this.print('\x1B[1;36m  OpenCodeTerm\x1B[0m\n');
        this.print('\x1B[1;34m  -----------\x1B[0m\n');
        this.print('  OS:     HTML5 + CSS3 + ES2024\n');
        this.print('  Host:   Web Browser\n');
        this.print('  Font:   Unifont 8x16\n');
        this.print('  Shell:  DemoShell v1.0\n');
        this.print('  Theme:  Green on Black\n');
    }
    static get commandName() { return 'neofetch'; }
    static get help() { return 'Show system information'; }
    static get menu() { return 'System Information'; }
}
