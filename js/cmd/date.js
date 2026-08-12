import { CmdBase } from './CmdBase.js';

export class DateCmd extends CmdBase {
    execute(args) {
        this.print(new Date().toString() + '\n');
    }
    static get commandName() { return 'date'; }
    static get help() { return 'Show current date/time'; }
    static get menu() { return 'Current Date/Time'; }
    static get usage() { return 'date'; }
}
