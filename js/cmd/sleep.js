import { CmdBase } from './CmdBase.js';
import { scheduleWithAbort } from '../system/BusyAsyncHelper.js';

export class Sleep extends CmdBase {
    execute(args) {
        const seconds = args.length > 0 ? parseFloat(args[0]) : 1;
        if (isNaN(seconds) || seconds < 0) {
            this.error('invalid number');
            return;
        }

        this.holdBusy();
        const timer = scheduleWithAbort(() => this.abortEpoch, () => this.releaseBusy(), seconds * 1000);
        this.addCleanup(() => clearTimeout(timer));
    }

    static get commandName() { return 'sleep'; }
    static get help() { return 'Wait for N seconds (default 1)'; }
    static get menu() { return null; }
    static get usage() { return 'sleep [seconds]'; }
}
