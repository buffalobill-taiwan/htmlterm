export class StateStack {
    constructor(term) {
        this.term = term;
        this._stack = [];
        this._restoreHooks = [];
    }

    addRestoreHook(fn) {
        this._restoreHooks.push(fn);
    }

    removeRestoreHook(fn) {
        const i = this._restoreHooks.indexOf(fn);
        if (i >= 0) this._restoreHooks.splice(i, 1);
    }

    push(y, h) {
        this._stack.push({
            y, h,
            cursor: { x: this.term.curX, y: this.term.curY },
            cursorHidden: this.term.cursorHidden,
        });
        this.term.cursorHidden = true;
        this.term.write('\x1B[?25l');
    }

    pop() {
        const state = this._stack.pop();
        if (!state) return;
        this.term.cursorHidden = state.cursorHidden;
        this.term.write(state.cursorHidden ? '\x1B[?25l' : '\x1B[?25h');
        this.term.curX = state.cursor.x;
        this.term.curY = state.cursor.y;
        for (const fn of this._restoreHooks) fn();
    }
}
