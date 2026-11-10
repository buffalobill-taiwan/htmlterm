/**
 * Install the four static metadata getters that forward to a GAME_META entry.
 * Keeps descriptors non-enumerable like normal class getters.
 * @param {Function} Cls - Command class.
 * @param {Object} META - Entry from js/cmd/game-meta.js.
 */
export function defineMetaGetters(Cls, META) {
    for (const key of ['commandName', 'help', 'menu', 'usage']) {
        Object.defineProperty(Cls, key, {
            get() { return META[key]; },
            enumerable: false,
            configurable: true,
        });
    }
}
