import { actionsMethods } from './actions.js';
import { keysMethods } from './keys.js';
import { cursorMethods } from './cursor.js';
import { overlaysMethods } from './overlays.js';

const inputMixin = {
    ...actionsMethods,
    ...keysMethods,
    ...cursorMethods,
    ...overlaysMethods,
};

export { inputMixin };
