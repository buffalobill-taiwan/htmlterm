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

        super(term, { ...opts, width, title: '', footer: '' });

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
        this._vb = new VirtualBuffer(this.width, this.h);
        this._contentSlot = this._vb.addChildSlot();
        this._contentSlot.vb = this._content;
        this._contentSlot.x = 1;
        this._contentSlot.y = 1;
        this._contentSlot.active = true;
    }

    _drawFrame() {
        const H = '─';
        this._t(0, '┌' + H.repeat(this.width - 2) + '┐');
        for (let row = 1; row < this.h - 1; row++) {
            this._vb.writeStr(row, 0, '│');
            this._vb.writeStr(row, this.width - 1, '│');
        }
        this._t(this.h - 1, '└' + H.repeat(this.width - 2) + '┘');
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
            this._onCancel();
            return 'close';
        }
        if (code === 0x0D || code === 0x0A) {
            this._onExit();
            return 'close';
        }
    }
}
