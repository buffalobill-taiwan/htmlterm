import { frameMethods } from './frame.js';
import { tilesMethods } from './tiles.js';
import { handsMethods } from './hands.js';
import { discardsMethods } from './discards.js';
import { panelsMethods } from './panels.js';

const renderMixin = {
    ...frameMethods,
    ...tilesMethods,
    ...handsMethods,
    ...discardsMethods,
    ...panelsMethods,
};

export { renderMixin };
