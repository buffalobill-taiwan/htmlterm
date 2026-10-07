import { system } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';

export class ShellCmd extends CmdBase {
    static get commandName() { return 'shell'; }
    static get help() { return null; }
    static get menu() { return null; }

    start() {
        this.open();
    }

    handleKey(data) {
        system.editor.handleKey(data);
        system.requeueRest(system.editor);
        return true;
    }

    showPrompt() {
        const s = system;
        s.term.write(s.prompt);
        s.editor.reset();
        s.flushQueuedInput();
    }

    close() {}

    onCancel() {
        system.term.write('^C\n');
        this.showPrompt();
    }
}
