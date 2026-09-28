import { displayWidth } from '../../../util/display-width.js';
import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { makeOverlayGetCell } from '../../../util/sgr.js';
import { term } from '../../../system/sys.js';

const overlaysMethods = {
    _buildTileStripVB(tiles, cursor, label) {
        const n = tiles.length;
        const pal = cursor ? this._palCursor : this._palNormal;
        const labelW = label ? displayWidth(label) : 0;
        const vb = new VirtualBuffer(n * 2 + (label ? 1 + labelW : 0), 2);
        const buf = vb._buffer;
        for (let i = 0; i < n; i++) this._writeTile2x2(buf, 0, i * 2, pal[tiles[i].key()]);
        if (label) vb.writeStr(0, n * 2 + 1, label);
        return vb;
    },

    _buildRiichiStripVB(o, cursor) {
        const waits = o.waits;
        const pal = cursor ? this._palCursor : this._palNormal;
        const vb = new VirtualBuffer(3 + waits.length * 2, 2);
        const buf = vb._buffer;
        this._writeTile2x2(buf, 0, 0, pal[o.tile.key()]);
        for (let i = 0; i < waits.length; i++) this._writeTile2x2(buf, 0, 3 + i * 2, pal[waits[i].key()]);
        vb.writeStr(0, 2, '→');
        return vb;
    },

    _drawPauseOverlay() {
        const vb = this._pauseVB;
        const buf = vb._buffer;
        const ow = 36, oh = 15;
        const bc = this._blankCell;
        const by = this._cellBorderY;

        for (let r = 0; r < oh; r++) {
            const row = buf[r];
            for (let c = 0; c < ow; c++) row[c] = bc;
        }

        vb.writeStr(0, 0, '\x1B[1;33m┌' + '─'.repeat(ow - 2) + '┐\x1B[0m');
        for (let r = 1; r < oh - 1; r++) { buf[r][0] = by; buf[r][ow - 1] = by; }
        vb.writeStr(oh - 1, 0, '\x1B[1;33m└' + '─'.repeat(ow - 2) + '┘\x1B[0m');

        vb.writeStr(3, 2, '\x1B[1;33m' + ' '.repeat(8) + '暫停中' + ' '.repeat(8) + '\x1B[0m');
        vb.writeStr(7, 2, '  P 取消暫停    Q 退出');
        vb.writeStr(9, 2, '  按住 Tab 查看捨牌');

        this._pauseVBBuffer = vb.render();
        if (!this._pauseOverlay) {
            this._pauseOverlay = {
                x: 4, y: 2, w: ow, h: oh,
                owner: this,
                getCell: makeOverlayGetCell(() => this._peekHeld ? null : this._pauseVBBuffer, ow, oh),
            };
            term.addOverlay(this._pauseOverlay);
        }
        for (let r = 2; r < 2 + oh; r++) term.markRowDirty(r);
    },

    _removePauseOverlay() {
        if (this._pauseOverlay) {
            term.removeOverlay(this._pauseOverlay);
            this._pauseOverlay = null;
            for (let r = 2; r < 17; r++) term.markRowDirty(r);
        }
    },
};

export { overlaysMethods };
