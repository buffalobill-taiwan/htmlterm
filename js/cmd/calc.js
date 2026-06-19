class Calc extends CmdBase {
    execute(args) {
        try {
            const expr = args.join(' ');
            const result = Function('"use strict"; return (' + expr + ')')();
            this.print(String(result) + '\n');
        } catch (e) {
            this.print('Error: invalid expression\n');
        }
    }
    static get commandName() { return 'calc'; }
    static get help() { return 'Simple calculator'; }
    static get menu() { return 'Simple Calculator'; }
}
