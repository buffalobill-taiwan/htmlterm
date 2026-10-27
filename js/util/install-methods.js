/**
 * Install reusable method groups on a class prototype.
 *
 * Command and game classes keep their mutable state in the class and split
 * rendering or rule helpers into plain method objects. Copying those methods
 * once at module initialization keeps `this` bound to the instance, and the
 * descriptors stay non-enumerable/writable/configurable like real class
 * methods. Later groups win when two groups define the same name.
 *
 * @param {Function} Cls - Target class.
 * @param {...Object} groups - Method maps keyed by method name.
 */
export function installMethods(Cls, ...groups) {
    for (const methods of groups) {
        for (const [name, value] of Object.entries(methods)) {
            Object.defineProperty(Cls.prototype, name, {
                value, writable: true, configurable: true, enumerable: false,
            });
        }
    }
}
