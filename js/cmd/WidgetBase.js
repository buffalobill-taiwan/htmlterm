class WidgetBase {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this._row = 0;
    }

    start() {}
    stop() {}
    draw() {}
}
