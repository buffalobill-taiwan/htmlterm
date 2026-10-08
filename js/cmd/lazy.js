/**
 * Build a registration descriptor for a command whose class loads on first use.
 * Metadata (name/help/usage/menu) is available at startup; `load()` fetches the
 * real CmdBase subclass only when the command runs.
 */
export function defineLazy(meta, load) {
    return {
        commandName: meta.commandName,
        help: meta.help,
        usage: meta.usage,
        menu: meta.menu,
        lazy: true,
        load,
    };
}
