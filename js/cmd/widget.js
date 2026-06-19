class WidgetCmd extends CmdBase {
    execute(args) {
        if (this._clock) {
            this.shell.widgetManager.remove(this._clock);
            this._clock = null;
            return;
        }
        this._clock = new ClockWidget(this.shell);
        this.shell.widgetManager.add(this._clock);
    }

    static get commandName() { return 'widget'; }
    static get help() { return 'Toggle TSR clock widget'; }
    static get menu() { return 'TSR clock (\u23F0 top-right)'; }
}
