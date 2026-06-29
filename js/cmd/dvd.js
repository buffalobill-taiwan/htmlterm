import { CmdBase } from './CmdBase.js';
import { DVDWidget } from './widgets/DVDWidget.js';

export class DvdCmd extends CmdBase {
    execute(args) {
        const on = this.toggleWidget('dvd', DVDWidget);
        this.print(on ? 'DVD started\n' : 'DVD stopped\n');
    }
    static get commandName() { return 'dvd'; }
    static get help() { return 'Toggle DVD bouncing logo'; }
    static get menu() { return 'DVD bouncing logo (screen saver)'; }
}
