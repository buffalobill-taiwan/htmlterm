import { Dialog } from './Dialog.js';
import { centeredDialogPos } from './position.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';

/**
 * A border-only dialog for caller-owned VirtualBuffer content.
 * The buffer supplies the complete inner area; the dialog adds one cell of
 * border on each side.
 */
export class InfoDialog extends Dialog {
    constructor(term, opts) {
        const content = opts.buffer;
        if (!(content instanceof VirtualBuffer)) {
            throw new TypeError('InfoDialog requires opts.buffer to be a VirtualBuffer');
        }

        const width = content.width + 2;
        const h = content.height + 2;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width, header: false, footer: false });

        this.h = h;
        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : pos.y;
        this._content = content;
        this._contentSlot = null;
        this._onExit = opts.onExit || (() => {});
        this._onCancel = opts.onCancel || (() => {});
        this._onQuit = opts.onQuit || (() => {});
    }

    _initBuffer() {
        this._vb = new VirtualBuffer(this.width, this._fullHeight);
        this._contentSlot = this._vb.addChildSlot();
        const viewport = new VirtualBuffer(this.width - 2, this._content.height);
        const contentSlot = viewport.addChildSlot();
        contentSlot.vb = this._content;
        contentSlot.active = true;
        this._contentSlot.vb = viewport;
        this._contentSlot.x = 1;
        this._contentSlot.y = 1;
        this._contentSlot.active = true;
    }

    _renderContent() {}

    _onKey(data) {
        if (data.length !== 1) return;
        const code = data.charCodeAt(0);
        if (code === 0x71 || code === 0x51) {
            this._onQuit();
            return;
        }
        if (code === 0x1B || code === 0x03) {
            return this.complete(this._onCancel);
        }
        if (code === 0x0D || code === 0x0A) {
            return this.complete(this._onExit);
        }
    }
}
