class Ascii extends CmdBase {
    execute(args) {
        this.print('\x1B[1mStandard 16 ANSI Colors:\x1B[0m\n');
        for (let bg = 0; bg < 16; bg++) {
            this.print('\x1B[48;5;' + bg + 'm  \x1B[0m');
            if (bg % 8 === 7) this.print('\n');
        }
        this.print('\n\x1B[1mColor Cube (sample):\x1B[0m\n');
        for (let g = 0; g < 6; g++) {
            for (let r = 0; r < 6; r++) {
                const c = 16 + r + g * 36;
                this.print('\x1B[48;5;' + c + 'm  \x1B[0m');
            }
            this.print('  ');
            for (let b = 0; b < 6; b++) {
                const c = 16 + b * 6 + g;
                this.print('\x1B[48;5;' + c + 'm  \x1B[0m');
            }
            this.print('\n');
        }
    }
    static get commandName() { return 'ascii'; }
    static get help() { return 'Show ANSI color chart'; }
    static get menu() { return 'ANSI Color Chart'; }
}
