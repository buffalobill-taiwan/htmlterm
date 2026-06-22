import { CmdBase } from './CmdBase.js';

export class SmallBlink extends CmdBase {
    execute(args) {
        const count = args.length > 0 ? parseInt(args[0], 10) : 1;
        if (isNaN(count) || count < 1) {
            this.error('invalid count');
            return;
        }

        const screen = this.term.container;
        if (!screen) return;

        const cw = this.term.charWidth;
        const ch = this.term.charHeight;

        let el = screen.querySelector('.smallflash-overlay');
        if (!el) {
            el = document.createElement('div');
            el.className = 'smallflash-overlay';
            screen.appendChild(el);
        }
        el.style.borderTopWidth = ch + 'px';
        el.style.borderBottomWidth = ch + 'px';
        el.style.borderLeftWidth = cw + 'px';
        el.style.borderRightWidth = cw + 'px';

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
                this.shell._checkTypewriterDrain();
            }
        }, 60);
    }

    static get commandName() { return 'smallblink'; }
    static get help() { return 'Flash terminal border N times (default 1)'; }
    static get menu() { return 'Flash terminal border'; }
    static get usage() { return 'smallblink [count]'; }
}
