import { saveArea, restoreArea } from '../dialog.js';

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
        if (this._saved) restoreArea(this.term, this._saved, this._row);
    }
}
