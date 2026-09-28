import { isWide } from '../../util/display-width.js';
import { CELL_W, BOARD_W, BOARD_H, BOARD_X, BOARD_Y, SIDEBAR_X, SIZE, CELL_H } from './constants.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import { makeCell, bold, yellow, gray } from '../../util/sgr.js';

const FW_DIGITS = '０１２３４５６７８９';

function _tileStr(n) {
    const s = String(n);
    return s.length === 1 ? FW_DIGITS[parseInt(s, 10)] : s;
}

function _tileWidth(str) {
    let w = 0;
    for (let i = 0; i < str.length; i++) w += isWide(str[i]) ? 2 : 1;
    return w;
}

function _fmtScore(n) {
    return String(n).padStart(7);
}

const TILE_COLORS = {
    0:    { fg: 0,   bg: 236 },
    2:    { fg: 235, bg: 230 },
    4:    { fg: 235, bg: 223 },
    8:    { fg: 255, bg: 208 },
    16:   { fg: 255, bg: 202 },
    32:   { fg: 255, bg: 196 },
    64:   { fg: 255, bg: 124 },
    128:  { fg: 235, bg: 226 },
    256:  { fg: 235, bg: 214 },
    512:  { fg: 235, bg: 178 },
    1024: { fg: 235, bg: 136 },
    2048: { fg: 0,   bg: 227 },
    4096: { fg: 255, bg: 165 },
    8192: { fg: 255, bg: 93 },
};

function _buildTilePalette() {
    const cell = (ch, fg, bg, bld) => ({
        ch, fg, bg, bold: bld, dim: false, italic: false,
        underline: false, blink: false, inverse: false,
        conceal: false, crossedOut: false, width: 1,
    });
    const palette = {};
    for (const v of Object.keys(TILE_COLORS)) {
        const n = parseInt(v, 10);
        const { fg, bg } = TILE_COLORS[n];
        const ch = n > 0 ? _tileStr(n) : ' ';
        palette[n] = {
            blank: cell(' ', fg, bg, false),
            chars: n > 0 ? _centerTiles(ch, fg, bg) : null,
        };
    }
    return palette;
}

function _centerTiles(str, fg, bg) {
    const cell = (ch, fg, bg, bld, width = 1) => ({
        ch, fg, bg, bold: bld, dim: false, italic: false,
        underline: false, blink: false, inverse: false,
        conceal: false, crossedOut: false, width,
    });
    const w = _tileWidth(str);
    const left = Math.floor((CELL_W - w) / 2);
    const right = CELL_W - left - w;
    const cells = [];
    for (let i = 0; i < left; i++) cells.push(cell(' ', fg, bg, false));
    for (let i = 0; i < str.length; i++) {
        const wide = isWide(str[i]);
        cells.push(cell(str[i], fg, bg, w >= 4, wide ? 2 : 1));
        if (wide) cells.push(cell('', fg, bg, false, 0));
    }
    for (let i = 0; i < right; i++) cells.push(cell(' ', fg, bg, false));
    return cells;
}

const renderMethods = {
    _initVBs() {
        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
            this._sidebarVB = new VirtualBuffer(15, BOARD_H);

            this._rootSlotBoard = this._rootVB.addChildSlot();
            this._rootSlotBoard.vb = this._boardVB;
            this._rootSlotBoard.x = BOARD_X;
            this._rootSlotBoard.y = BOARD_Y;
            this._rootSlotBoard.active = true;

            this._rootSlotSidebar = this._rootVB.addChildSlot();
            this._rootSlotSidebar.vb = this._sidebarVB;
            this._rootSlotSidebar.x = SIDEBAR_X;
            this._rootSlotSidebar.y = BOARD_Y;
            this._rootSlotSidebar.active = true;
        }

        if (!this._tilePalette) {
            this._tilePalette = _buildTilePalette();
        }

        if (!this._emptyLineCells) {
            const elvb = new VirtualBuffer(this._rootVB.width, 1);
            elvb.writeStr(0, 0, ' '.repeat(this._rootVB.width));
            this._emptyLineCells = elvb._buffer[0].slice();
        }
    },

    _render() {
        const rootBuf = this._rootVB._buffer;
        const elc = this._emptyLineCells;
        for (let r = 0; r < this._rootVB.height; r++) {
            const row = rootBuf[r];
            for (let c = 0; c < row.length; c++) row[c] = elc[c];
        }
        this._renderHint();
        this._renderSidebar();
        this._renderBoard();
    },

    _renderHint() {
        const buf = this._rootVB._buffer;
        const hint = '←↑↓→ Move  [u]ndo  [r]estart  [q]uit';
        const row = buf[0];
        for (let i = 0; i < hint.length && i < row.length; i++) {
            row[i] = makeCell(hint[i], 8, 0, false);
        }
    },

    _renderSidebar() {
        const vb = this._sidebarVB;
        const buf = vb._buffer;
        for (let r = 0; r < vb.height; r++) {
            const row = buf[r];
            for (let c = 0; c < row.length; c++) row[c] = null;
        }

        vb.writeStr(0, 0, bold(yellow('  2048')));
        vb.writeStr(2, 0, gray(' Score'));
        const scoreStr = _fmtScore(this._score);
        const scoreCells = this._makeStatCells(scoreStr, 11, false);
        for (let i = 0; i < scoreCells.length; i++) buf[3][i] = scoreCells[i];

        const bestRow = Math.min(6, vb.height - 1);
        vb.writeStr(bestRow, 0, gray(' Best'));
        const bestStr = _fmtScore(this._best);
        const bestCells = this._makeStatCells(bestStr, 11, this._best > 0);
        const bestDataRow = bestRow + 1;
        if (bestDataRow < vb.height) {
            for (let i = 0; i < bestCells.length; i++) buf[bestDataRow][i] = bestCells[i];
        }
    },

    _makeStatCells(str, fg, highlight) {
        const cell = (ch, fg, bg, bld) => ({
            ch, fg, bg, bold: bld, dim: false, italic: false,
            underline: false, blink: false, inverse: false,
            conceal: false, crossedOut: false, width: 1,
        });
        const cells = [];
        for (let i = 0; i < str.length; i++) {
            cells.push(cell(str[i], highlight ? 11 : fg, 0, highlight));
        }
        return cells;
    },

    _renderBoard() {
        const buf = this._boardVB._buffer;
        const pal = this._tilePalette;

        for (let tr = 0; tr < SIZE; tr++) {
            for (let tc = 0; tc < SIZE; tc++) {
                const v = this._board[tr][tc];
                const tile = pal[v] || pal[0];
                const baseRow = tr * CELL_H;
                const baseCol = tc * CELL_W;

                for (let r = 0; r < CELL_H; r++) {
                    const dstRow = buf[baseRow + r];
                    for (let c = 0; c < CELL_W; c++) {
                        dstRow[baseCol + c] = tile.blank;
                    }
                }

                if (tile.chars) {
                    const numRow = buf[baseRow + 1];
                    for (let c = 0; c < tile.chars.length; c++) {
                        numRow[baseCol + c] = tile.chars[c];
                    }
                }
            }
        }

        if (this._completed && !this._won) {
            this._renderGameOverOverlay();
        }

        term.writeVB(this._rootVB);
    },

    _renderMoveOverlay(moveCells) {
        const buf = this._boardVB._buffer;

        for (const mc of moveCells) {
            const { r, c, srcR, srcC, value } = mc;
            const isHoriz = srcR === r;
            const { fg, bg } = TILE_COLORS[value] || TILE_COLORS[0];

            let left, top, w, h;
            if (isHoriz) {
                left = Math.min(c, srcC) * CELL_W + 1;
                top = r * CELL_H;
                w = CELL_W * 2 - 2;
                h = CELL_H;
            } else {
                left = c * CELL_W;
                top = Math.min(r, srcR) * CELL_H + 1;
                w = CELL_W;
                h = CELL_H * 2 - 1;
            }

            for (let dy = 0; dy < h; dy++) {
                const row = buf[top + dy];
                for (let dx = 0; dx < w; dx++) {
                    row[left + dx] = makeCell(' ', fg, bg, false);
                }
            }

            const numStr = _tileStr(value);
            const numW = _tileWidth(numStr);
            const numLeft = left + Math.floor((w - numW) / 2);
            const numRow = top + Math.floor(h / 2);
            let nx = 0;
            for (let i = 0; i < numStr.length; i++) {
                const wide = isWide(numStr[i]);
                buf[numRow][numLeft + nx] = makeCell(numStr[i], fg, bg, numW >= 4, wide ? 2 : 1);
                if (wide) {
                    buf[numRow][numLeft + nx + 1] = makeCell('', fg, bg, false, 0);
                    nx += 2;
                } else {
                    nx++;
                }
            }
        }

        term.writeVB(this._rootVB);
    },

    _renderMergeOverlay(mergeCells) {
        const buf = this._boardVB._buffer;

        for (const mc of mergeCells) {
            const { r, c, srcR, srcC, value } = mc;
            const isHoriz = c !== srcC;
            const { fg, bg } = TILE_COLORS[value] || TILE_COLORS[0];

            let left, top, w, h;
            if (isHoriz) {
                left = Math.min(c, srcC) * CELL_W + 1;
                top = r * CELL_H;
                w = CELL_W * 2 - 2;
                h = CELL_H;
            } else {
                left = c * CELL_W;
                top = Math.min(r, srcR) * CELL_H + 1;
                w = CELL_W;
                h = CELL_H * 2 - 1;
            }

            for (let dy = 0; dy < h; dy++) {
                const row = buf[top + dy];
                for (let dx = 0; dx < w; dx++) {
                    row[left + dx] = makeCell(' ', fg, bg, false);
                }
            }

            const numStr = _tileStr(value);
            const numW = _tileWidth(numStr);
            const numLeft = left + Math.floor((w - numW) / 2);
            const numRow = top + Math.floor(h / 2);
            let nx = 0;
            for (let i = 0; i < numStr.length; i++) {
                const wide = isWide(numStr[i]);
                buf[numRow][numLeft + nx] = makeCell(numStr[i], fg, bg, numW >= 4, wide ? 2 : 1);
                if (wide) {
                    buf[numRow][numLeft + nx + 1] = makeCell('', fg, bg, false, 0);
                    nx += 2;
                } else {
                    nx++;
                }
            }
        }

        term.writeVB(this._rootVB);
    },

    _renderWinOverlay() {
        const fw = 20, fh = 5;
        const ox = Math.floor((BOARD_W - fw) / 2);
        const oy = Math.floor((BOARD_H - fh) / 2);

        const cell = (ch, fg, bg, bld) => ({
            ch, fg, bg, bold: bld, dim: false, italic: false,
            underline: false, blink: false, inverse: false,
            conceal: false, crossedOut: false, width: 1,
        });

        for (let r = 0; r < fh; r++) {
            const row = this._boardVB._buffer[oy + r];
            for (let c = 0; c < fw; c++) {
                row[ox + c] = cell(' ', 0, 22, false);
            }
        }

        const winStr = '  YOU WIN!  ';
        const wx = ox + Math.floor((fw - winStr.length) / 2);
        for (let i = 0; i < winStr.length; i++) {
            this._boardVB._buffer[oy + 1][wx + i] = cell(winStr[i], 11, 22, true);
        }

        const hint = '[c]ontinue [q]uit';
        const hx = ox + Math.floor((fw - hint.length) / 2);
        for (let i = 0; i < hint.length; i++) {
            this._boardVB._buffer[oy + 3][hx + i] = cell(hint[i], 7, 22, false);
        }
    },

    _renderGameOverOverlay() {
        const fw = 22, fh = 5;
        const ox = Math.floor((BOARD_W - fw) / 2);
        const oy = Math.floor((BOARD_H - fh) / 2);

        const cell = (ch, fg, bg, bld) => ({
            ch, fg, bg, bold: bld, dim: false, italic: false,
            underline: false, blink: false, inverse: false,
            conceal: false, crossedOut: false, width: 1,
        });

        for (let r = 0; r < fh; r++) {
            const row = this._boardVB._buffer[oy + r];
            for (let c = 0; c < fw; c++) {
                row[ox + c] = cell(' ', 0, 1, false);
            }
        }

        const goStr = '  GAME OVER  ';
        const gx = ox + Math.floor((fw - goStr.length) / 2);
        for (let i = 0; i < goStr.length; i++) {
            this._boardVB._buffer[oy + 1][gx + i] = cell(goStr[i], 15, 1, true);
        }

        const hint = '[n]ew [q]uit';
        const hx = ox + Math.floor((fw - hint.length) / 2);
        for (let i = 0; i < hint.length; i++) {
            this._boardVB._buffer[oy + 3][hx + i] = cell(hint[i], 7, 1, false);
        }
    },
};

export { renderMethods };
