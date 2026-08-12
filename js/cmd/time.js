import { CmdBase } from './CmdBase.js';
import { system } from '../system/sys.js';
import { InputDialog } from '../dialog/index.js';

export class TimeCmd extends CmdBase {
    execute(args) {
        if (args.length === 0) {
            this.print('\x1B[33mUsage: time <command> [args...]\x1B[0m\n');
            return;
        }

        const target = args.join(' ');
        const startTime = performance.now();
        const stackDepth = system.cmdStack.length;

        system.execCmd(target);

        return new Promise(resolve => {
            const remove = system.addFramePopHook(() => {
                if (system.cmdStack.length === stackDepth) {
                    remove();
                    const elapsed = performance.now() - startTime;
                    this.print(`\n\x1B[2mTime: ${elapsed.toFixed(2)}ms\x1B[0m\n`);
                    resolve();
                }
            });
        });
    }

    static openMenuDialog() {
        system.createDialog(InputDialog, 'time-input', {
            title: 'Time a Command',
            prompt: 'Enter command:',
            footer: 'Enter Confirm  ESC Back',
            onConfirm: (expr) => {
                if (!expr.trim()) return;
                if (system.menuDialog) {
                    system.menuDialog.close();
                    system.menuDialog = null;
                }
                system.execCmd('time ' + expr.trim());
            },
            onCancel: () => {},
        });
    }

    static get commandName() { return 'time'; }
    static get help() { return 'Measure execution time of a command'; }
    static get menu() { return 'Time a Command'; }
    static get usage() { return 'time <command> [args...]'; }
}
