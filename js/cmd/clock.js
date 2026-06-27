import { CmdBase } from './CmdBase.js';
import { ClockWidget } from './widgets/ClockWidget.js';

export class ClockCmd extends CmdBase {
    execute(args) {
        if (this._clock) {
            this.system.widgetManager.remove(this._clock);
            this._clock = null;
            return;
        }
        this._clock = new ClockWidget(this.shell);
        this.system.widgetManager.add(this._clock);
    }
    static get commandName() { return 'clock'; }
    static get help() { return 'Toggle TSR clock widget'; }
    static get menu() { return 'TSR clock (top-right)'; }
}
