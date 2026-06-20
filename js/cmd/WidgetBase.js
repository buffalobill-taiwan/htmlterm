import { saveArea } from '../dialog.js';

export class WidgetBase {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this._row = 0;
        this._saved = null;
    }

    start() { this._saveBacking(); }

    stop() {
        this._restoreBacking();
        this._saved = null;
    }

    draw() {}

    _saveBacking() {
        this._saved = saveArea(this.term, this._row, 1);
    }

    _restoreBacking() {
        if (!this._saved) return;
        for (let r = 0; r < this._saved.length && this._row + r < this.term.rows; r++) {
            if (this._saved[r]) {
                const fresh = this._saved[r].map(c => ({ ...c }));
                this.term.setRow(this._row + r, fresh);
            }
        }
        this.term.markAllDirty();
    }
}
