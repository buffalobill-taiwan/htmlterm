export class WidgetManager {
    constructor(system) {
        this.system = system;
        this._widgets = [];
        this._savedState = new Map();
        this._hook = () => this.redrawAll();
        system.addDialogRestoreHook(this._hook);
    }

    add(widget) {
        const key = widget.constructor.name;
        if (this._savedState.has(key)) {
            widget.restoreSaveState(this._savedState.get(key));
        }
        widget.start();
        this._widgets.push(widget);
    }

    remove(widget) {
        const i = this._widgets.indexOf(widget);
        if (i < 0) return;
        this._savedState.set(widget.constructor.name, widget.getSaveState());
        widget.stop();
        this._widgets.splice(i, 1);
        this.redrawAll();
    }

    redrawAll() {
        for (const w of this._widgets) {
            w.draw();
        }
    }

    destroy() {
        this.system.removeDialogRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
    }
}
