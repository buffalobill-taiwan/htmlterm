import * as cmdModule from './cmd/index.js';
import { SystemManager } from './system.js';
import { bold, green, yellow, gray } from './sgr.js';

export class DemoShell {
    constructor(term) {
        this.term = term;
        this.prompt = '$ ';
        this.running = false;
        this.commands = {};
        this.menuItems = [];
        this.cmdList = [];

        this.system = new SystemManager(this);
        this._registerCommands();
        this.system.setup();

        this.typewriter = this.system.typewriter;
        this.editor = this.system.editor;
        this.widgetManager = this.system.widgetManager;
        this.menuDialog = null;

        this.start();
    }

    get busy() { return this.system.busy; }

    get abortGeneration() { return this.system.abortGeneration; }

    holdBusy() { this.system.holdBusy(); }

    releaseBusy() { this.system.releaseBusy(); }

    _registerCommands() {
        this._cmdInstances = {};
        for (const Cls of Object.values(cmdModule)) {
            if (typeof Cls !== 'function' || !Cls.commandName) continue;
            const cmd = new Cls(this);
            const name = Cls.commandName;
            const help = Cls.help;
            const menu = Cls.menu;
            this._cmdInstances[name] = cmd;
            this.commands[name] = cmd.execute.bind(cmd);
            this.cmdList.push({ name, help });
            if (menu) this.menuItems.push({ name, desc: menu });
        }
        this.cmdList.sort((a, b) => a.name.localeCompare(b.name));
        this.menuItems.sort((a, b) => a.name.localeCompare(b.name));
    }

    start() {
        this.running = true;
        this.term.write('\x1B[2J\x1B[H');
        this.term.write(bold(green('OpenCode Terminal v1.0.0')) + '\n');
        this.term.write('Type ' + yellow('help') + ' for available commands.\n\n');
        this.term.write(gray('AEIOUÀÈÌÒÙ金木水火土鑫森淼焱垚あいうえおアイウエオ') + '\n\n');
        this.showPrompt();
    }

    showPrompt() {
        this.term.write(this.prompt);
        this.editor.reset();
        this.system._flushQueuedInput();
    }

    print(text) {
        this.typewriter.enqueue(text);
    }

    execute(line) { this.system.execute(line); }

    handleInput(data) { this.system.handleInput(data); }

    pushDialogFrame(dlg) { this.system.pushDialogFrame(dlg); }

    readLine(callback) { this.system.readLine(callback); }
}
