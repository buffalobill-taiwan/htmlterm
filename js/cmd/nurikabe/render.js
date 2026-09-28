import { isWide } from '../../util/unicode-width.js';
import { CLUE_CONNECTED, CLUE_OVER, CLUE_OK } from './constants.js';
import { gray, bold, white, red, cyan, yellow } from '../../util/sgr.js';
import { VirtualBuffer, _blankCell } from '../../util/VirtualBuffer.js';
import { term } from '../../system/sys.js';
import { bufWidth } from '../../util/display-width.js';
import { formatClue, BLACK } from '../../util/nurikabe-engine.js';

const CELL_ISLAND = '　';

const CELL_SEA    = '  ';

if (!isWide(CELL_ISLAND)) {
    throw new Error('Nurikabe island glyph must be wide (2-column).');
}

if (CELL_SEA.length !== 2) {
    throw new Error('Nurikabe sea cells must occupy exactly 2 columns.');
}

function _formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _styleClue(status, ch) {
    if (status === CLUE_CONNECTED || status === CLUE_OVER) return gray(ch);
    if (status === CLUE_OK) return bold(white(ch));
    return red(ch);
}

/**
 * Clue styling under the cursor.
 *
 * Cannot reuse `_styleClue` + `\x1B[7m`: inverse swaps the clue's own foreground
 * colour into the background, so the digit ends up drawn in near-identical tones
 * to the cell behind it and becomes unreadable. Instead paint an explicit bright
 * background with a dark foreground per status, matching how the sea cells
 * handle the cursor (`\x1B[107;30m`).
 */
function _styleClueCursor(status, ch) {
    if (status === CLUE_CONNECTED || status === CLUE_OVER) return '\x1B[107;90m' + ch + '\x1B[0m';
    if (status === CLUE_OK) return '\x1B[107;30m\x1B[1m' + ch + '\x1B[0m';
    return '\x1B[107;31m\x1B[1m' + ch + '\x1B[0m';
}

const renderMethods = {
    _initVBs() {
        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardSlot = this._rootVB.addChildSlot();
        }
        const w = 2 * this._size + 2;
        const h = this._size + 2;
        if (!this._boardVB || this._boardVB.width !== w) {
            this._boardVB = new VirtualBuffer(w, h);
        }
        Object.assign(this._boardSlot, { vb: this._boardVB, x: 0, y: 2, active: false });
        this._clearLayout();
    },

    _clearLayout() {
        for (const row of this._rootVB._buffer) row.fill(_blankCell);
        this._boardSlot.active = false;
    },

    _clearRow(row) {
        this._rootVB._buffer[row]?.fill(_blankCell);
    },

    _renderGenerating() {
        this._rootVB.writeStr(0, 0, bold(cyan('  Nurikabe [' + this._label + ']')));
        this._rootVB.writeStr(2, 0, yellow('  Generating puzzle...'));
        term.writeVB(this._rootVB);
    },

    _drawHeader(flush = true) {
        const title = bold(cyan('  Nurikabe [' + this._label + ']'));
        this._clearRow(0);
        this._rootVB.writeStr(0, 0, title + ' '.repeat(Math.max(0, 61 - bufWidth(title))) +
            yellow(_formatTime(this._timer)));
        if (flush) term.writeVB(this._rootVB);
    },

    _footerRow() {
        return 6 + this._size;
    },

    _drawFooter() {
        this._clearRow(1);
        this._rootVB.writeStr(1, 0,
            gray('  ←↑↓→ Move   Space Paint (hold)   [c]onnectivity (hold)   [n][r][q]'));
    },

    _drawBoard(flush = true) {
        const vb = this._boardVB;
        vb.writeStr(0, 0, '╔' + '═'.repeat(this._size * 2) + '╗');
        for (let r = 0; r < this._size; r++) this._drawRow(r, false);
        vb.writeStr(this._size + 1, 0, '╚' + '═'.repeat(this._size * 2) + '╝');
        this._boardSlot.active = true;
        if (flush) term.writeVB(this._rootVB);
    },

    _drawRow(r, flush = true) {
        let row = '║';
        for (let c = 0; c < this._size; c++) row += this._cellStr(r, c);
        this._boardVB.writeStr(r + 1, 0, row + '║');
        if (flush) term.writeVB(this._rootVB);
    },

    _cellStr(r, c) {
        const isCur = r === this._cursorRow && c === this._cursorCol && !this._completed;
        const clue = this._clues[r][c];

        if (clue > 0) {
            const ch = formatClue(clue);
            const st = this._clueStatus[r][c];
            if (isCur) return _styleClueCursor(st, ch);
            return bold(_styleClue(st, ch) + '\x1B[0m');
        }

        const isSea = this._player[r][c] === BLACK;
        if (isSea) {
            const inPool = this._poolMask[r][c];
            // Sea cells are blank, so the cursor can only be shown by changing
            // the *background*. Keeping the pool cell red under the cursor is a
            // no-op (bg 1 -> 1) and the cursor vanishes, so it switches to
            // yellow: the only colour that stays distinguishable from the red
            // pool itself (3.4:1), from the white normal-sea cursor (1.7:1) and
            // from unhighlighted sea (2.4:1), while still reading as a warning.
            if (isCur) {
                return inPool
                    ? '\x1B[43m' + CELL_SEA + '\x1B[0m'
                    : '\x1B[107;30m' + CELL_SEA + '\x1B[0m';
            }
            if (this._connectivityHeld && this._connectivityMask && this._connectivityMask[r][c]) {
                return '\x1B[104m' + CELL_SEA + '\x1B[0m';
            }
            return inPool
                ? '\x1B[41m' + CELL_SEA + '\x1B[0m'
                : '\x1B[100m' + CELL_SEA + '\x1B[0m';
        }
        return isCur ? '\x1B[7m' + CELL_ISLAND + '\x1B[0m' : CELL_ISLAND;
    },

    _drawSeed() {
        const row = this._size + 4;
        this._clearRow(row);
        this._rootVB.writeStr(row, 0, gray('  seed: ' + this._seed));
    },

    _render() {
        this._clearLayout();
        this._drawHeader(false);
        this._drawBoard(false);
        this._drawFooter();
        this._drawSeed();
        term.writeVB(this._rootVB);
    },
};

export { _formatTime, renderMethods };
