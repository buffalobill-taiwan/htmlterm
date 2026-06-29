import { CmdBase } from './CmdBase.js';
import { ClockWidget } from './widgets/ClockWidget.js';

export class ClockCmd extends CmdBase {
    execute(args) {
        this.toggleWidget('clock', ClockWidget);
    }
    static get commandName() { return 'clock'; }
    static get help() { return 'Toggle TSR clock widget'; }
    static get menu() { return 'TSR clock (top-right)'; }
}
