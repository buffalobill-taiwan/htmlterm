import { CmdBase } from './CmdBase.js';
import { DVDWidget } from './widgets/DVDWidget.js';

export class DvdCmd extends CmdBase {
    execute(args) {
        if (this._dvd) {
            this.shell.widgetManager.remove(this._dvd);
            this._dvd = null;
            this.shell.print('DVD stopped\n');
            return;
        }
        this._dvd = new DVDWidget(this.shell);
        this.shell.widgetManager.add(this._dvd);
        this.shell.print('DVD started\n');
    }

    static get commandName() { return 'dvd'; }
    static get help() { return 'Toggle DVD bouncing logo'; }
    static get menu() { return 'DVD bouncing logo (screen saver)'; }
}
