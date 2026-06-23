import { CmdBase } from './CmdBase.js';

export class Blink extends CmdBase {
    execute(args) {
        const count = args.length > 0 ? parseInt(args[0], 10) : 1;
        if (isNaN(count) || count < 1) {
            this.error('invalid count');
            return;
        }

        const wrapper = document.getElementById('terminal-wrapper');
        if (!wrapper) return;

        let el = wrapper.querySelector('.flash-overlay');
        if (!el) {
            el = document.createElement('div');
            el.className = 'flash-overlay';
            wrapper.appendChild(el);
        }

        this.shell._busy = true;
        this._flash(el, count);
    }

    _flash(el, remaining) {
        el.classList.add('active');
        setTimeout(() => {
            el.classList.remove('active');
            if (remaining > 1) {
                setTimeout(() => this._flash(el, remaining - 1), 100);
            } else {
                this.shell._busy = false;
                this.shell._schedulePrompt();
            }
        }, 60);
    }

    static get commandName() { return 'blink'; }
    static get help() { return 'Flash the screen N times (default 1)'; }
    static get menu() { return 'Flash the screen'; }
    static get usage() { return 'blink [count]'; }
}
