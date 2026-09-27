// Runtime binding is independent of SystemManager to avoid command import cycles.
let currentSystem = null;
export function getSystem() { return currentSystem; }
export function setSystem(value) { currentSystem = value; }

function instance() {
    const s = currentSystem;
    if (!s) throw new Error('SystemManager not initialized');
    return s;
}

export const system = new Proxy({}, {
    get(_, prop) {
        const s = instance();
        const v = s[prop];
        return typeof v === 'function' ? (...args) => v.apply(s, args) : v;
    },
    set(_, prop, value) {
        return Reflect.set(instance(), prop, value);
    }
});

export const term = new Proxy({}, {
    get(_, prop) {
        const t = instance().term;
        const v = t[prop];
        return typeof v === 'function' ? (...args) => v.apply(t, args) : v;
    },
    set(_, prop, value) {
        return Reflect.set(instance().term, prop, value);
    }
});
