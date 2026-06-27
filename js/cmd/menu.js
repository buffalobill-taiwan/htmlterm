import { CmdBase } from './CmdBase.js';

export class MenuCmd extends CmdBase {
    execute(args) {
        this.system.menuCmd();
    }
    static get commandName() { return 'menu'; }
    static get help() { return 'Open command menu'; }
    static get menu() { return null; }
}
