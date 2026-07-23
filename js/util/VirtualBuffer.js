import { _writeStr } from '../dialog/write.js';
import { bufWidth } from './display-width.js';
import { createEmptyBuffer } from './sgr.js';

export class VirtualBuffer {
    constructor(w, h) {
        this.width = w;
        this.height = h;
        this._buffer = createEmptyBuffer(w, h);
        this._children = [];
    }

    writeStr(y, x, str, maxX) {
        _writeStr(this._buffer, y, x, str, maxX ?? this.width);
    }

    clear() {
        for (let r = 0; r < this.height; r++) {
            const row = this._buffer[r];
            for (let c = 0; c < this.width; c++) row[c] = null;
        }
        this._children.length = 0;
    }

    getCell(y, x) {
        return this._buffer[y]?.[x] ?? null;
    }

    setCell(y, x, cell) {
        if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
            this._buffer[y][x] = cell;
        }
    }

    centerRow(row, content) {
        const pad = Math.max(0, this.width - bufWidth(content));
        const left = Math.floor(pad / 2);
        const right = Math.ceil(pad / 2);
        this.writeStr(row, 0, ' '.repeat(left) + content + ' '.repeat(right));
    }

    leftRow(row, content) {
        this.writeStr(row, 0, content);
    }

    rightRow(row, content) {
        const w = bufWidth(content);
        const x = Math.max(0, this.width - w);
        this.writeStr(row, x, content);
    }

    hline(row, ch = '─') {
        this.writeStr(row, 0, ch.repeat(this.width));
    }

    embed(childVB, x, y) {
        this._children.push({ vb: childVB, x, y });
    }

    render() {
        const result = this._buffer.map(row => row.slice());

        for (const { vb, x: ox, y: oy } of this._children) {
            const childCells = vb.render();
            for (let cy = 0; cy < childCells.length; cy++) {
                const dy = oy + cy;
                if (dy >= this.height) break;
                const srcRow = childCells[cy];
                const dstRow = result[dy];
                for (let cx = 0; cx < srcRow.length; cx++) {
                    const dx = ox + cx;
                    if (dx >= this.width) break;
                    if (srcRow[cx]) dstRow[dx] = srcRow[cx];
                }
            }
        }

        return result;
    }

    blit(destBuffer, destX, destY) {
        for (let r = 0; r < this.height; r++) {
            const dy = destY + r;
            if (dy < 0 || dy >= destBuffer.length) continue;
            const srcRow = this._buffer[r];
            const dstRow = destBuffer[dy];
            for (let c = 0; c < this.width; c++) {
                const dx = destX + c;
                if (dx < 0 || dx >= dstRow.length) continue;
                if (srcRow[c]) dstRow[dx] = srcRow[c];
            }
        }
        for (const { vb, x: ox, y: oy } of this._children) {
            vb.blit(destBuffer, destX + ox, destY + oy);
        }
    }
}
