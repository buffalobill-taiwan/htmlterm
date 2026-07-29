import { CmdBase } from './CmdBase.js';
import { system } from '../system/sys.js';
import { DVDWidget } from './widgets/DVDWidget.js';

export class DvdCmd extends CmdBase {
    execute(args) {
        const text = args.length > 0 ? args.join(' ') : 'DVD';
        const wm = system.widgetManager;
        const existing = wm._widgets.find(w => w.constructor === DVDWidget);
        if (existing) {
            wm.remove(existing);
            this.print('DVD stopped\n');
        } else {
            wm._savedState.delete('DVDWidget');
            wm.add(new DVDWidget(text));
            this.print(text === 'DVD' ? 'DVD started\n' : 'DVD: ' + text + '\n');
        }
    }
    static get commandName() { return 'dvd'; }
    static get help() { return 'Toggle DVD bouncing logo'; }
    static get menu() { return 'DVD bouncing logo'; }
}
