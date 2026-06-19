class ClockWidget extends WidgetBase {
    constructor(shell) {
        super(shell);
        this._intervalId = null;
    }

    start() {
        this.draw();
        this._intervalId = setInterval(() => {
            if (!this.shell.stateStack.isCovered(this._row)) {
                this.draw();
            }
        }, 1000);
    }

    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
        const x = this.term.cols - 8;
        this.term.write(`\x1B[s\x1B[${this._row + 1};${x + 1}H` + ' '.repeat(8) + `\x1B[u`);
    }

    draw() {
        const now = new Date();
        const time = String(now.getHours()).padStart(2, '0') + ':' +
                     String(now.getMinutes()).padStart(2, '0') + ':' +
                     String(now.getSeconds()).padStart(2, '0');
        const x = this.term.cols - 8;
        this.term.write(`\x1B[s\x1B[${this._row + 1};${x + 1}H\x1B[44;37m${time}\x1B[0m\x1B[u`);
    }
}
