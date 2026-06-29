import { CmdBase } from './CmdBase.js';
import { bold, yellow } from '../util/sgr.js';

export class Help extends CmdBase {
    execute(args) {
        this.print(bold(yellow('Available commands:')) + '\n');
        for (const { name, help } of this.cmdList) {
            this.print('  ' + name.padEnd(11) + help + '\n');
        }
    }
    static get commandName() { return 'help'; }
    static get help() { return 'Show this help'; }
    static get menu() { return 'Available Commands'; }
}
