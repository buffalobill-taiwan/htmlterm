// Escape-sequence helpers for game _onKey handlers.

const ARROWS = ['\x1B[A', '\x1B[B', '\x1B[C', '\x1B[D'];
const EDIT = ['\x1B[3~', '\x1B[2~', '\x1B[H', '\x1B[F', '\x1B[5~', '\x1B[6~'];

/** Arrows plus Delete/Insert/Home/End/PageUp/PageDown. */
export const SWALLOW_NAV = new Set([...ARROWS, ...EDIT]);
/** Edit/navigation keys without the arrow keys (arrows have their own action). */
export const SWALLOW_EDIT = new Set(EDIT);
/** SWALLOW_EDIT plus the common Home/End aliases used by Othello. */
export const SWALLOW_EDIT_ALT = new Set([...EDIT, '\x1B[1~', '\x1B[4~']);

/** True when the escape sequence should be consumed without any action. */
export function isSuppressedKey(data, allowed = SWALLOW_NAV) {
    return typeof data === 'string' && allowed.has(data);
}
