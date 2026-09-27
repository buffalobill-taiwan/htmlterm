// Registration metadata stays independent of input, frames and rendering.
export class CommandRegistry {
    constructor(module) {
        this.commands = Object.create(null);
        this.instances = Object.create(null);
        this.cmdList = [];
        this.menuItems = [];
        for (const Cls of Object.values(module)) {
            if (typeof Cls !== 'function' || !Cls.commandName || Cls.commandName === 'shell') continue;
            const name = Cls.commandName;
            if (this.instances[name]) throw new Error('Duplicate command: ' + name);
            const cmd = new Cls();
            this.instances[name] = cmd;
            this.commands[name] = cmd.execute.bind(cmd);
            this.cmdList.push({ name, help: Cls.help, usage: Cls.usage });
            if (Cls.menu) this.menuItems.push({ name, desc: Cls.menu });
        }
        this.cmdList.sort((a, b) => a.name.localeCompare(b.name));
        this.menuItems.sort((a, b) => a.name.localeCompare(b.name));
    }
}
