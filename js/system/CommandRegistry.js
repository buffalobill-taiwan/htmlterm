// Registration metadata stays independent of input, frames and rendering.
// Entries may be eager CmdBase subclasses or lazy descriptors from defineLazy().
export class CommandRegistry {
    constructor(module) {
        this.commands = Object.create(null);
        this.instances = Object.create(null);
        this.loaders = Object.create(null);
        this.cmdList = [];
        this.menuItems = [];
        for (const item of Object.values(module)) {
            if (item && item.lazy && item.commandName) {
                this._registerLazy(item);
            } else if (typeof item === 'function' && item.commandName && item.commandName !== 'shell') {
                this._registerClass(item);
            }
        }
        this.cmdList.sort((a, b) => a.name.localeCompare(b.name));
        this.menuItems.sort((a, b) => a.name.localeCompare(b.name));
    }

    _registerClass(Cls) {
        const name = Cls.commandName;
        if (this.commands[name]) throw new Error('Duplicate command: ' + name);
        const cmd = new Cls();
        this.instances[name] = cmd;
        this.commands[name] = cmd.execute.bind(cmd);
        this.cmdList.push({ name, help: Cls.help, usage: Cls.usage });
        if (Cls.menu) this.menuItems.push({ name, desc: Cls.menu });
    }

    _registerLazy(desc) {
        const name = desc.commandName;
        if (this.commands[name]) throw new Error('Duplicate command: ' + name);
        this.loaders[name] = desc.load;
        // Placeholder: SystemManager replaces this with a frame-binding wrapper.
        this.commands[name] = () => {
            throw new Error('Lazy command not wired: ' + name);
        };
        this.cmdList.push({ name, help: desc.help, usage: desc.usage });
        if (desc.menu) this.menuItems.push({ name, desc: desc.menu });
    }
}
