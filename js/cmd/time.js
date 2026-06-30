import { CmdBase } from './CmdBase.js';

export class TimeCmd extends CmdBase {
    execute(args) {
        if (args.length === 0) {
            this.print('\x1B[33mUsage: time <command> [args...]\x1B[0m\n');
            return;
        }

        const target = args.join(' ');
        const startTime = performance.now();
        const stackDepth = this.system._cmdStack.length;

        this.system._execCmd(target);

        return new Promise(resolve => {
            const remove = this.system.addFramePopHook(() => {
                if (this.system._cmdStack.length === stackDepth) {
                    remove();
                    const elapsed = performance.now() - startTime;
                    this.print(`\n\x1B[2mTime: ${elapsed.toFixed(2)}ms\x1B[0m\n`);
                    resolve();
                }
            });
        });
    }

    static get commandName() { return 'time'; }
    static get help() { return 'Measure execution time of a command'; }
    static get menu() { return 'Time a Command'; }
}
