import { CmdBase } from './CmdBase.js';
import { bold, yellow, red } from '../util/sgr.js';

const NAME_WIDTH = 10;

export class Help extends CmdBase {
    execute(args) {
        const name = args[0];
        if (name) {
            this._showCommandHelp(name.toLowerCase());
            return;
        }
        const perRow = Math.max(1, Math.floor(80 / NAME_WIDTH));
        let row = '';
        for (let i = 0; i < this.cmdList.length; i++) {
            row += this.cmdList[i].name.padEnd(NAME_WIDTH);
            if ((i + 1) % perRow === 0 || i === this.cmdList.length - 1) {
                this.print(row + '\n');
                row = '';
            }
        }
    }

    _showCommandHelp(name) {
        const entry = this.cmdList.find(c => c.name === name);
        if (!entry) {
            this.print(red('No such command: ' + name) + '\n');
            return;
        }
        this.print(bold(yellow(entry.name)) + '\n');
        if (entry.help) this.print('  ' + entry.help + '\n');
        if (entry.usage) this.print('  Usage: ' + entry.usage + '\n');
    }

    static get commandName() { return 'help'; }
    static get help() { return 'Show command list; help <cmd> for details'; }
    static get menu() { return 'Available Commands'; }
    static get usage() { return 'help [cmd]'; }
}
