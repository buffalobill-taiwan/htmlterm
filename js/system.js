import { Typewriter } from './typewriter.js';
import { LineEditor } from './LineEditor.js';
import { MenuDialog } from './dialog/index.js';
import { SyncCmdFrame } from './CmdFrame.js';

export class SystemManager {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;

        this.typewriter = new Typewriter(this.term);
        this.typewriter.onDrain(() => shell._tick());

        this.editor = new LineEditor(this.term, {
            onExecute: (line) => shell.execute(line),
            onShowPrompt: () => shell._tick(),
        });

        this._dialogRestoreHooks = [];
        this._dialogPositions = {};

        this.widgetManager = new WidgetManager(this);
        this._dragTarget = null;
        this.menuDialog = null;
    }

    setup() {
        this.editor.setPrompt(this.shell.prompt);
        this.editor.setCommands(Object.keys(this.shell.commands));
    }

    addDialogRestoreHook(fn) {
        this._dialogRestoreHooks.push(fn);
    }

    removeDialogRestoreHook(fn) {
        const i = this._dialogRestoreHooks.indexOf(fn);
        if (i >= 0) this._dialogRestoreHooks.splice(i, 1);
    }

    handleMouse(type, info) {
        if (type === 'mousedown') {
            const ovs = this.term.overlays;
            for (let i = ovs.length - 1; i >= 0; i--) {
                const ov = ovs[i];
                if (info.col >= ov.x && info.col < ov.x + ov.w &&
                    info.row >= ov.y && info.row < ov.y + ov.h) {
                    const owner = ov.owner;
                    if (owner && typeof owner.startDrag === 'function') {
                        this._dragTarget = owner;
                        owner.startDrag(info.col, info.row);
                        return true;
                    }
                    break;
                }
            }
            return false;
        }

        if (type === 'mousemove' && this._dragTarget) {
            this._dragTarget.moveDrag(info.col, info.row);
            return true;
        }

        if (type === 'mouseup' && this._dragTarget) {
            this._dragTarget.endDrag();
            this._dragTarget = null;
            return true;
        }

        return false;
    }

    _createDialog(DialogClass, key, opts, ...ctorArgs) {
        const pos = this._dialogPositions[key] || {};
        const dlg = new DialogClass(this.term, ...ctorArgs, {
            ...opts,
            x: pos.x,
            y: pos.y,
            savePos: (x, y) => { this._dialogPositions[key] = { x, y }; },
        });
        this.shell.pushDialogFrame(dlg);
        return dlg;
    }

    menuCmd() {
        this.menuDialog = null;
        const menuDlg = this._createDialog(MenuDialog, 'menu', {
            width: 44,
            title: 'Command Menu',
            footer: '↑↓ Navigate  ↩ Execute  ESC Quit',
            visibleCount: 5,
            onSelect: (item) => {
                const inst = this.shell._cmdInstances[item.name];
                if (inst && inst.constructor.openMenuDialog) {
                    inst.constructor.openMenuDialog(this.shell, menuDlg);
                    return;
                }
                this.shell._pushFrame(new SyncCmdFrame(this.shell, item.name, [], inst));
                this.menuDialog = null;
                return 'close';
            },
            onCancel: () => {}
        }, this.shell.menuItems);
        this.menuDialog = menuDlg;
    }
}

export class WidgetManager {
    constructor(system) {
        this.system = system;
        this.shell = system.shell;
        this.term = system.term;
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
