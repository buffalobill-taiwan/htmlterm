import { system } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';

export class MenuCmd extends CmdBase {
    execute(args) {
        system.menuCmd();
    }
    static get commandName() { return 'menu'; }
    static get help() { return 'Open command menu'; }
    static get menu() { return null; }
    static get usage() { return 'menu'; }
}
