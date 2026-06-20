import { CmdBase } from './CmdBase.js';

export class Clear extends CmdBase {
    execute(args) {
        this.print('\x1B[2J\x1B[H');
    }
    static get commandName() { return 'clear'; }
    static get help() { return 'Clear the screen'; }
    static get menu() { return 'Clear Screen'; }
}
