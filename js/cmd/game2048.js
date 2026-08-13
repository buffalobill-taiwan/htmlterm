import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { bold, gray, yellow, CURSOR_HIDE } from '../util/sgr.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';
import { isWide } from '../util/display-width.js';

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

const SIZE = 4;
const CELL_W = 6;
const CELL_H = 3;

const BOARD_W = SIZE * CELL_W;
const BOARD_H = SIZE * CELL_H;
const BOARD_X = 2;
const BOARD_Y = 2;
const SIDEBAR_X = BOARD_X + BOARD_W + 2;

function _emptyBoard() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
}

function _copyBoard(b) {
    return b.map(r => [...r]);
}

function _emptyCells(b) {
    const cells = [];
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (b[r][c] === 0) cells.push([r, c]);
    return cells;
}

function _spawnTile(b) {
    const cells = _emptyCells(b);
    if (cells.length === 0) return;
    const [r, c] = cells[Math.floor(Math.random() * cells.length)];
    b[r][c] = Math.random() < 0.9 ? 2 : 4;
}

function _slideRow(row) {
    const filtered = [];
    const filteredIdx = [];
    for (let i = 0; i < row.length; i++) {
        if (row[i] !== 0) {
            filtered.push(row[i]);
            filteredIdx.push(i);
        }
    }
    const merged = [];
    const mergePairs = [];
    let score = 0;
    let i = 0;
    while (i < filtered.length) {
        if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
            const v = filtered[i] * 2;
            merged.push(v);
            mergePairs.push({ dest: merged.length - 1, src: i + 1, value: v });
            score += v;
            i += 2;
        } else {
            merged.push(filtered[i]);
            i++;
        }
    }
    while (merged.length < SIZE) merged.push(0);
    const slide = [...filtered];
    while (slide.length < SIZE) slide.push(0);
    return { slide, result: merged, score, mergePairs, filteredIdx };
}

function _slide(b, dir) {
    let totalScore = 0;
    let moved = false;
    const nb = _copyBoard(b);
    const ns = _copyBoard(b);
    const mergeCells = [];
    const moveCells = [];

    if (dir === 0) {
        for (let c = 0; c < SIZE; c++) {
            const col = [];
            for (let r = 0; r < SIZE; r++) col.push(nb[r][c]);
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(col);
            totalScore += score;
            for (let r = 0; r < SIZE; r++) {
                if (nb[r][c] !== result[r]) moved = true;
                nb[r][c] = result[r];
                ns[r][c] = slide[r];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r: m.dest, c, srcR: m.src, srcC: c, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r: i, c, srcR: filteredIdx[i], srcC: c, value: slide[i] });
                }
            }
        }
    } else if (dir === 2) {
        for (let c = 0; c < SIZE; c++) {
            const col = [];
            for (let r = SIZE - 1; r >= 0; r--) col.push(nb[r][c]);
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(col);
            totalScore += score;
            for (let i = 0; i < SIZE; i++) {
                const r = SIZE - 1 - i;
                if (nb[r][c] !== result[i]) moved = true;
                nb[r][c] = result[i];
                ns[r][c] = slide[i];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r: SIZE - 1 - m.dest, c, srcR: SIZE - 1 - m.src, srcC: c, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r: SIZE - 1 - i, c, srcR: SIZE - 1 - filteredIdx[i], srcC: c, value: slide[i] });
                }
            }
        }
    } else if (dir === 1) {
        for (let r = 0; r < SIZE; r++) {
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(nb[r]);
            totalScore += score;
            for (let c = 0; c < SIZE; c++) {
                if (nb[r][c] !== result[c]) moved = true;
                nb[r][c] = result[c];
                ns[r][c] = slide[c];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r, c: m.dest, srcR: r, srcC: m.src, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r, c: i, srcR: r, srcC: filteredIdx[i], value: slide[i] });
                }
            }
        }
    } else {
        for (let r = 0; r < SIZE; r++) {
            const reversed = nb[r].slice().reverse();
            const { slide, result, score, mergePairs, filteredIdx } = _slideRow(reversed);
            totalScore += score;
            const orig = nb[r];
            for (let c = 0; c < SIZE; c++) {
                const v = result[SIZE - 1 - c];
                if (orig[c] !== v) moved = true;
                nb[r][c] = v;
                ns[r][c] = slide[SIZE - 1 - c];
            }
            const mergeSet = new Set(mergePairs.map(m => m.dest));
            for (const m of mergePairs) {
                mergeCells.push({ r, c: SIZE - 1 - m.dest, srcR: r, srcC: SIZE - 1 - m.src, value: m.value });
            }
            for (let i = 0; i < filteredIdx.length; i++) {
                if (!mergeSet.has(i) && filteredIdx[i] !== i) {
                    moveCells.push({ r, c: SIZE - 1 - i, srcR: r, srcC: SIZE - 1 - filteredIdx[i], value: slide[i] });
                }
            }
        }
    }

    return { board: nb, slideBoard: ns, mergeCells, moveCells, score: totalScore, moved };
}

function _canMove(b) {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
            if (b[r][c] === 0) return true;
            if (c + 1 < SIZE && b[r][c] === b[r][c + 1]) return true;
            if (r + 1 < SIZE && b[r][c] === b[r + 1][c]) return true;
        }
    return false;
}

function _hasWon(b) {
    for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++)
            if (b[r][c] >= 2048) return true;
    return false;
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

export class Game2048Cmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args);
        if (p.hasHelp) return this.showHelp();
        this._startGame();
    }

    _startGame() {
        this._board = _emptyBoard();
        this._score = 0;
        this._best = 0;
        this._completed = false;
        this._won = false;
        this._continueAfterWin = false;
        this._prevBoard = null;
        this._prevScore = 0;
        this._animating = false;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        this._initVBs();
        _spawnTile(this._board);
        _spawnTile(this._board);
        this._render();
    }

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
    }

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x03) { this._quit(); return; }

        if (this._completed) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._startGame(); return; }
            }
            return;
        }

        if (this._won && !this._continueAfterWin) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'c') {
                    this._continueAfterWin = true;
                    this._render();
                    return;
                }
                if (ch === 'q') { this._quit(); return; }
            }
            if (code === 0x1B) {
                const s = typeof data === 'string' ? data : '';
                if (s === '\x1B[3~') return;
                if (s === '\x1B[2~') return;
                if (s === '\x1B[H') return;
                if (s === '\x1B[F') return;
                if (s === '\x1B[5~') return;
                if (s === '\x1B[6~') return;
                this._quit();
                return;
            }
            return;
        }

        if (this._animating) return;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._move(0); return; }
            if (s === '\x1B[B') { this._move(2); return; }
            if (s === '\x1B[D') { this._move(1); return; }
            if (s === '\x1B[C') { this._move(3); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H') return;
            if (s === '\x1B[F') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            this._quit();
            return;
        }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'u') { this._undo(); return; }
            if (ch === 'r') { this._startGame(); return; }
            if (ch === 'n') { this._startGame(); return; }
            if (ch === 'q') { this._quit(); return; }
        }
    }

    _move(dir) {
        if (this._animating) return;
        const prev = _copyBoard(this._board);
        const prevScore = this._score;
        const { board, slideBoard, mergeCells, moveCells, score, moved } = _slide(this._board, dir);
        if (!moved) return;

        this._prevBoard = prev;
        this._prevScore = prevScore;
        this._score += score;
        if (this._score > this._best) this._best = this._score;

        this._animating = true;

        const finishMerge = () => {
            this._board = board;
            _spawnTile(this._board);

            if (!this._won && _hasWon(this._board)) {
                this._won = true;
                this._render();
                this._renderWinOverlay();
                term.writeVB(this._rootVB);
            } else {
                if (!_canMove(this._board)) this._completed = true;
                this._render();
            }
            this._animating = false;
        };

        if (moveCells.length > 0) {
            this._renderMoveOverlay(moveCells);
            const hasMerge = mergeCells.length > 0;
            const moveDelay = hasMerge ? 30 : 60;

            setTimeout(() => {
                this._board = slideBoard;
                this._render();

                if (hasMerge) {
                    setTimeout(() => {
                        this._renderMergeOverlay(mergeCells);
                        setTimeout(finishMerge, 80);
                    }, 30);
                } else {
                    finishMerge();
                }
            }, moveDelay);
        } else if (mergeCells.length > 0) {
            this._board = slideBoard;
            this._render();

            setTimeout(() => {
                this._renderMergeOverlay(mergeCells);
                setTimeout(finishMerge, 80);
            }, 30);
        } else {
            finishMerge();
        }
    }

    _undo() {
        if (!this._prevBoard || this._completed || this._animating) return;
        this._board = this._prevBoard;
        this._score = this._prevScore;
        this._prevBoard = null;
        this._prevScore = 0;
        this._render();
    }

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
    }

    _renderHint() {
        const buf = this._rootVB._buffer;
        const makeCell = (ch, fg, bg, bold) => ({
            ch, fg, bg, bold, dim: false, italic: false,
            underline: false, blink: false, inverse: false,
            conceal: false, crossedOut: false, width: 1,
        });
        const hint = '←↑↓→ Move  [u]ndo  [r]estart  [q]uit';
        const row = buf[0];
        for (let i = 0; i < hint.length && i < row.length; i++) {
            row[i] = makeCell(hint[i], 8, 0, false);
        }
    }

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
    }

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
    }

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
    }

    _renderMoveOverlay(moveCells) {
        const buf = this._boardVB._buffer;

        const makeCell = (ch, fg, bg, bold, width = 1) => ({
            ch, fg, bg, bold, dim: false, italic: false,
            underline: false, blink: false, inverse: false,
            conceal: false, crossedOut: false, width,
        });

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
    }

    _renderMergeOverlay(mergeCells) {
        const buf = this._boardVB._buffer;

        const makeCell = (ch, fg, bg, bold, width = 1) => ({
            ch, fg, bg, bold, dim: false, italic: false,
            underline: false, blink: false, inverse: false,
            conceal: false, crossedOut: false, width,
        });

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
    }

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
    }

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
    }

    _quit() {
        term.write('\x1B[' + (BOARD_Y + BOARD_H + 2) + ';1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return '2048'; }
    static get help() { return 'Play 2048'; }
    static get menu() { return '2048'; }
    static get usage() { return '2048'; }
}
