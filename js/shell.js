class DemoShell {
    constructor(term) {
        this.term = term;
        this.line = '';
        this.prompt = '$ ';
        this.promptShown = false;
        this.running = false;
        this.history = [];
        this.historyPos = -1;
        this.stateStack = new StateStack(this.term);
        this.activeDialog = null;
        this.menuDialog = null;
        this._pendingAction = null;
        this.commands = {};
        this.menuItems = [];
        this._cmdList = [];

        this.widgetManager = new ShellWidgetManager(this);
        this._registerCommands();
        this.start();
    }

    _registerCommands() {
        const classes = [
            Help, Clear, Echo, DateCmd, Uname, Neofetch,
            Cowsay, Ascii, Fortune, Calc, Exit, Whoami, MenuCmd, WidgetCmd,
        ];
        for (const Cls of classes) {
            const cmd = new Cls(this);
            const name = Cls.commandName;
            const help = Cls.help;
            const menu = Cls.menu;
            this.commands[name] = cmd.execute.bind(cmd);
            this._cmdList.push({ name, help });
            if (menu) this.menuItems.push({ name, desc: menu });
        }
    }

    start() {
        this.running = true;
        this.term.write('\x1B[2J\x1B[H');
        this.term.write('\x1B[1;32mOpenCode Terminal v1.0.0\x1B[0m\n');
        this.term.write('Type \x1B[33mhelp\x1B[0m for available commands.\n\n');
        this.term.write('\x1B[90m日本語テスト漢字常用字非常用擴充字\x1B[0m');
        this.term.write('  \x1B[90m\u2200\u2600\u2665\u2713\x1B[0m\n\n');
        this.showPrompt();
    }

    showPrompt() {
        this.term.write(this.prompt);
        this.promptShown = true;
        this.line = '';
        this.historyPos = -1;
    }

    _isWide(ch) {
        const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;

        if (code >= 0x1100) {
            if (code <= 0x11FF) return true;
            if (code >= 0x2E80 && code <= 0x9FFF) return true;
            if (code >= 0xAC00 && code <= 0xD7AF) return true;
            if (code >= 0xF900 && code <= 0xFAFF) return true;
            if (code >= 0xFE10 && code <= 0xFE19) return true;
            if (code >= 0xFE30 && code <= 0xFE6F) return true;
            if (code >= 0xFF01 && code <= 0xFF60) return true;
            if (code >= 0xFFE0 && code <= 0xFFE6) return true;
            if (code >= 0x20000 && code <= 0x2FFFF) return true;
            if (code >= 0x30000 && code <= 0x3FFFF) return true;
        }

        if (code < 0x100) return false;

        if (code === 0x23F0 || code === 0x23F3) return true;

        if (code >= 0x2190 && code <= 0x21FF) return false;
        if (code >= 0x2300 && code <= 0x23FF) return false;
        if (code >= 0x2500 && code <= 0x25FF) return false;

        if (!this._canv) {
            this._canv = document.createElement('canvas');
            this._ctx = this._canv.getContext('2d');
            this._ctx.font = '16px UnifontTerm, monospace';
        }
        const w = this._ctx.measureText(ch).width;
        return w > 10;
    }

    handleInput(data) {
        if (!this.running) return;

        if (this.activeDialog && !this.activeDialog.closed) {
            this.activeDialog.handleKey(data);
            if (this.activeDialog && this.activeDialog.closed) {
                this.activeDialog = null;
            }
            if (this._pendingAction) {
                const a = this._pendingAction;
                this._pendingAction = null;
                if (a.type === 'close-chain') {
                    if (this.menuDialog && !this.menuDialog.closed) this.menuDialog.close();
                    this.menuDialog = null;
                    this.activeDialog = null;
                    this.commands[a.cmd](a.args);
                } else if (a.type === 'exec') {
                    this.menuDialog = null;
                    this.commands[a.cmd](a.args);
                }
            }
            if (!this.activeDialog) this.showPrompt();
            return;
        }

        for (let i = 0; i < data.length; i++) {
            const ch = data[i];
            const code = ch.charCodeAt ? ch.charCodeAt(0) : ch;

            if (code === 0x03) {
                this.term.write('^C\n');
                this.showPrompt();
                continue;
            }

            if (code === 0x04) {
                if (this.line.length === 0) {
                    this.term.write('exit\n');
                    this.showPrompt();
                }
                continue;
            }

            if (code === 0x0C) {
                this.term.write('\x1B[2J\x1B[H');
                this.term.write(this.prompt + this.line);
                continue;
            }

            if (code === 0x0D || code === 0x0A) {
                this.term.write('\r\n');
                this.execute(this.line);
                if (!this.activeDialog) this.showPrompt();
                continue;
            }

            if (code === 0x7F || code === 0x08) {
                if (this.line.length > 0) {
                    const last = this.line[this.line.length - 1];
                    const w = this._isWide(last) ? 2 : 1;
                    this.line = this.line.slice(0, -1);
                    this.term.write('\b'.repeat(w) + ' '.repeat(w) + '\b'.repeat(w));
                }
                continue;
            }

            if (code === 0x09) {
                const completions = Object.keys(this.commands).filter(cmd => cmd.startsWith(this.line));
                if (completions.length === 1) {
                    const rest = completions[0].slice(this.line.length);
                    this.line = completions[0];
                    this.term.write(rest);
                } else if (completions.length > 1) {
                    this.term.write('\r\n');
                    this.term.write(completions.join('  ') + '\n');
                    this.term.write(this.prompt + this.line);
                }
                continue;
            }

            if (code === 0x1B) {
                if (data[i + 1] === '[' || data[i + 1] === 'O') {
                    const seq = data.slice(i, i + 3);
                    if (seq === '\x1B[A') {
                        if (this.history.length > 0) {
                            if (this.historyPos === -1) this.historyPos = this.history.length - 1;
                            else if (this.historyPos > 0) this.historyPos--;
                            const newLine = this.history[this.historyPos];
                            const diff = this.line.length;
                            this.term.write('\b \b'.repeat(diff));
                            this.line = newLine;
                            this.term.write(newLine);
                        }
                        i += 2;
                        continue;
                    }
                    if (seq === '\x1B[B') {
                        if (this.historyPos >= 0) {
                            this.historyPos++;
                            const diff = this.line.length;
                            this.term.write('\b \b'.repeat(diff));
                            if (this.historyPos >= this.history.length) {
                                this.line = '';
                                this.historyPos = -1;
                            } else {
                                this.line = this.history[this.historyPos];
                                this.term.write(this.line);
                            }
                        }
                        i += 2;
                        continue;
                    }
                    if (seq === '\x1B[C' || seq === '\x1B[D') {
                        i += 2;
                        continue;
                    }
                }
                continue;
            }

            if (code >= 0x20) {
                this.line += ch;
                this.term.write(ch);
            }
        }
    }

    execute(line) {
        const trimmed = line.trim();
        if (trimmed.length === 0) return;
        this.history.push(trimmed);
        if (this.history.length > 100) this.history.shift();

        const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        const cmd = parts[0] ? parts[0].toLowerCase() : '';
        const args = parts.slice(1).map(a => a.replace(/^"(.*)"$/, '$1'));

        const handler = this.commands[cmd];
        if (handler) {
            handler(args);
        } else {
            this.print('\x1B[91mCommand not found: ' + cmd + '\x1B[0m\n');
            this.print('Try \x1B[33mhelp\x1B[0m.\n');
        }
    }

    print(text) {
        this.term.write(text);
    }

    _menuCmd() {
        const menuDlg = new MenuDialog(this.term, this.menuItems, {
            width: 44,
            title: 'Command Menu',
            footer: '\u2191\u2193 Navigate  \u21A9 Execute  ESC Quit',
            visibleCount: 5,
            stack: this.stateStack,
            onSelect: (item) => {
                if (item.name === 'calc') {
                    const inputDlg = new InputDialog(this.term, {
                        title: '\u8ACB\u8F38\u5165\u7B97\u5F0F',
                        prompt: '\u7B97\u5F0F\uFF1A',
                        footer: 'Enter Confirm  ESC Back',
                        stack: this.stateStack,
                        onConfirm: (expr) => {
                            this._pendingAction = { type: 'close-chain', cmd: 'calc', args: [expr] };
                        },
                        onCancel: () => {
                            this.activeDialog = menuDlg;
                        }
                    });
                    this.activeDialog = inputDlg;
                    inputDlg.open();
                    return;
                }
                this._pendingAction = { type: 'exec', cmd: item.name, args: [] };
                return 'close';
            },
            onCancel: () => {
                this._pendingAction = null;
            }
        });
        this.activeDialog = menuDlg;
        this.menuDialog = menuDlg;
        menuDlg.open();
    }
}

class ShellWidgetManager {
    constructor(shell) {
        this.shell = shell;
        this.term = shell.term;
        this._widgets = [];
        this._hook = () => this.redrawAll();
        shell.stateStack.addRestoreHook(this._hook);
    }

    add(widget) {
        const n = this._widgets.length;
        widget._row = n;
        const total = n + 1;
        this._setScrollTop(total);
        widget.start();
        this._widgets.push(widget);
    }

    remove(widget) {
        const i = this._widgets.indexOf(widget);
        if (i < 0) return;
        widget.stop();
        this._widgets.splice(i, 1);
        for (let j = 0; j < this._widgets.length; j++) {
            this._widgets[j]._row = j;
        }
        const total = this._widgets.length;
        this._setScrollTop(total);
        this.redrawAll();
    }

    redrawAll() {
        for (const w of this._widgets) {
            if (!this.shell.stateStack.isCovered(w._row)) {
                w.draw();
            }
        }
    }

    _setScrollTop(n) {
        this.term.scrollTop = n;
        this.term.scrollBottom = this.term.rows - 1;
        this.term._markAllDirty();
    }

    destroy() {
        this.shell.stateStack.removeRestoreHook(this._hook);
        for (const w of this._widgets) w.stop();
        this._widgets = [];
        this._setScrollTop(0);
    }
}
