class Cowsay extends CmdBase {
    execute(args) {
        const text = args.join(' ') || 'Moo!';
        const len = text.length;
        const border = '\x1B[33m' + '='.repeat(len + 2) + '\x1B[0m';
        const top = '  ' + border;
        const mid = '\x1B[33m< \x1B[1;37m' + text + '\x1B[0m \x1B[33m>\x1B[0m';
        const bot = '  ' + border;
        const cow = '\x1B[32m        \\   \x1B[1;37m^__^\x1B[0m\x1B[32m\n' +
                   '         \\  (\x1B[1;37moo\x1B[0m\x1B[32m)\\_______\n' +
                   '            (__)\\       )\\/\\\n' +
                   '                ||----\x1B[33mw\x1B[0m\x1B[32m |\n' +
                   '                ||     ||\x1B[0m\n';
        this.print(top + '\n' + mid + '\n' + bot + '\n' + cow);
    }
    static get commandName() { return 'cowsay'; }
    static get help() { return 'Let a cow speak'; }
    static get menu() { return 'Talking Cow'; }
}
