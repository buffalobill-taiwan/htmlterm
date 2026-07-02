import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { ARTWORKS } from './art.js';
import { screenFlash, borderFlash, artSequence } from '../util/flash-helper.js';

export class Flash extends CmdBase {
    async execute(args) {
        const p = this.parseArgs(args);
        const art = p.flag('--art', '-a');
        const border = art ? null : p.flag('--border', '-b');
        const count = p.rest.length > 0 ? parseInt(p.rest[0], 10) : 1;
        if (isNaN(count) || count < 1) {
            this.error('invalid count');
            return;
        }
        if (art) {
            const loaded = [];
            for (let i = 0; i < count; i++) {
                const loader = ARTWORKS[Math.floor(Math.random() * ARTWORKS.length)];
                loaded.push(await loader());
            }
            artSequence(this, term, loaded);
        } else if (border) {
            borderFlash(this, term, count);
        } else {
            screenFlash(this, term, count);
        }
    }

    static get commandName() { return 'flash'; }
    static get help() { return 'Flash screen N times. --border / --art.'; }
    static get menu() { return 'Flash the screen'; }
    static get usage() { return 'flash [--art|--border] [count]'; }
}
