class Fortune extends CmdBase {
    execute(args) {
        const fortunes = [
            'A terminal emulator is never late, nor is it early.\nIt renders precisely when it means to.',
            '42 is the answer. But what was the question again?',
            'The Endless Loop: n.; see Loop, Endless.\nLoop, Endless: n.; see Endless Loop.',
            'In a world of GUIs, be a terminal.',
            'There is no place like ~',
            'Have you tried turning it off and on again?',
            '> make me a sandwich\n  What? I don\'t know how to make a sandwich.\n  > sudo make me a sandwich\n  Okay.',
            'A journey of a thousand miles begins with\na single step. Or a single keystroke.',
        ];
        this.print(fortunes[Math.floor(Math.random() * fortunes.length)] + '\n');
    }
    static get commandName() { return 'fortune'; }
    static get help() { return 'Show a random fortune'; }
    static get menu() { return 'Random Fortune'; }
}
