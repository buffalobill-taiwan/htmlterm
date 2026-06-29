import { Dialog } from './Dialog.js';
import { makeCursorCell } from '../util/sgr.js';
import { centeredDialogPos } from './position.js';
import { DEFAULT_DIALOG_WIDTH } from '../util/constants.js';
import { TextInputModel, parseCSI } from '../shell/TextInputModel.js';

export class InputDialog extends Dialog {
    constructor(term, opts) {
        const width = opts.width || DEFAULT_DIALOG_WIDTH;
        const h = 8;
        const pos = centeredDialogPos(term, width, h);

        super(term, { ...opts, width });

        this.x = opts.x != null ? opts.x : pos.x;
        this.y = opts.y != null ? opts.y : Math.max(0, pos.y - 1);
        this.h = h;
        this.prompt = opts.prompt || '';
        this._model = new TextInputModel();
        this._onConfirm = opts.onConfirm || (() => {});
        this._onCancel  = opts.onCancel  || (() => {});
    }

    // Keep inputText as a readable alias for external callers if any
    get inputText() { return this._model.value; }

    open() {
        super.open();
        this._showCursor();
    }

    _showCursor() {
        const PREFIX = ' > ';
        const col = 1 + PREFIX.length + this._model.widthRange(0, this._model.cursor);
        const row = this._inputRow;
        if (col < this.width - 1) {
            this._buffer[row][col] = makeCursorCell();
        }
        this.term.markRowDirty(this.y + row);
    }

    _renderContent() {
        this._inputRow = 4;
        const PREFIX = ' > ';
        this._leftRow(3, '  ' + this.prompt);
        this._leftRow(this._inputRow, PREFIX + this._model.value);
        this._showCursor();
    }

    _onKey(data) {
        const result = this._handleInput(data);
        if (result === 'close') return 'close';
        if (result !== 'none') this.refreshContent();
    }

    _handleInput(data) {
        let changed = 'none';

        for (let i = 0; i < data.length; i++) {
            const ch   = data[i];
            const code = ch.charCodeAt(0);

            if (code === 0x0D || code === 0x0A) {           // Enter
                this._onConfirm(this._model.value);
                return 'close';
            }
            if (code === 0x03) {                            // Ctrl+C
                this._onCancel();
                return 'close';
            }
            if (code === 0x1B) {
                // Single ESC = cancel; ESC [ / ESC O = cursor/edit sequence
                const csi = parseCSI(data.slice(i));
                if (!csi) { this._onCancel(); return 'close'; }
                this._handleCSIFinal(csi.final, csi.params);
                i += csi.consumed - 1;
                changed = 'content';
                continue;
            }

            let r = 'none';
            if (code === 0x7F || code === 0x08) r = this._model.backspace();
            else if (code === 0x01) r = this._model.moveHome();
            else if (code === 0x05) r = this._model.moveEnd();
            else if (code === 0x15) r = this._model.deleteToStart();
            else if (code === 0x0B) r = this._model.deleteToEnd();
            else if (code === 0x17) r = this._model.deleteWordBefore();
            else if (code >= 0x20) {
                const cp = data.codePointAt(i);
                r = this._model.insert(String.fromCodePoint(cp));
                i += cp > 0xFFFF ? 1 : 0;
            }

            if (r !== 'none') changed = r;
        }

        return changed;
    }

    _handleCSIFinal(final, params) {
        const m = this._model;
        switch (final) {
            case 'C': m.moveRight();    break;   // →
            case 'D': m.moveLeft();     break;   // ←
            case 'H': m.moveHome();     break;   // Home
            case 'F': m.moveEnd();      break;   // End
            case '~':
                if (params === '1' || params === '7') m.moveHome();
                else if (params === '4' || params === '8') m.moveEnd();
                else if (params === '3') m.deleteForward();
                break;
        }
    }
}
