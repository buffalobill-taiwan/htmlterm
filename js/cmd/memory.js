import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { bold, red, green, yellow, cyan, gray, CURSOR_HIDE, makeCell } from '../util/sgr.js';
import { isWide } from '../util/unicode-width.js';
import { VirtualBuffer, _blankCell } from '../util/VirtualBuffer.js';
import { GAME_META } from './game-meta.js';
const META = GAME_META.memory;

const DIFFICULTY = {
    easy:   { cols: 4, rows: 3, label: 'Easy',   maxFails: 3, revealMs: 800 },
    medium: { cols: 5, rows: 4, label: 'Medium', maxFails: 4, revealMs: 1600 },
    hard:   { cols: 6, rows: 5, label: 'Hard',   maxFails: 5, revealMs: 2400 },
};

const REVEAL_MS = 800;
const FLIP_STEP_MS = 40;
// A wide front glyph occupies four terminal cells in --big form.
// The half-width back glyph uses two 2x2 blocks to fill the same area.
const FLIP_COLUMNS = 4;
const DOT_CELL = makeCell('.', 7, 0, false);
const BORDER_CELL = makeCell('║', 7, 0, false);

function clipCells(ch, fg, bg, wide) {
    return Array.from({ length: 8 }, (_, i) => {
        const cell = makeCell(ch, fg, bg, false);
        cell.clip = true;
        cell.clipOffX = -(wide ? i % 4 : i % 2);
        cell.clipOffY = -Math.floor(i / 4);
        return cell;
    });
}

function _pool() {
    const out = [];
    for (let cp = 0x2600; cp <= 0x27BF; cp++) {
        if (isWide(cp)) out.push(String.fromCodePoint(cp));
    }
    return out;
}

const POOL = _pool();

function _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

export class MemoryCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {
            flags: { '--easy': Boolean, '--medium': Boolean, '--hard': Boolean },
        });
        if (p.hasHelp) return this.showHelp();
        let diff = null;
        if (p.flag('--easy'))   diff = 'easy';
        if (p.flag('--medium')) diff = 'medium';
        if (p.flag('--hard'))   diff = 'hard';
        if (diff) {
            this._startGame(diff);
        } else {
            this._pickDifficulty();
        }
    }

    _boardW() {
        return this._cols * 4 + (this._cols - 1) + 2;
    }

    _boardH() {
        return this._rows * 2 + 2;
    }

    _pickDifficulty() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._completed = true;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        const opts = ['Easy', 'Medium', 'Hard'];
        this._difficultyDialog = this.openDialog(SelectDialog, 'memory-diff', {
            title: 'Memory',
            message: yellow('Select difficulty'),
            options: opts,
            footer: '← → Move  ↩ Confirm  ESC Quit',
            onSelect: (idx) => {
                this._difficultyDialog = null;
                this._startGame(opts[idx].toLowerCase());
            },
            onCancel: () => {
                this._difficultyDialog = null;
                this._quit();
            },
        });
    }

    _startGame(diff) {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._flipTimer) { clearTimeout(this._flipTimer); this._flipTimer = null; }
        if (this._flipAnimTimer) { clearInterval(this._flipAnimTimer); this._flipAnimTimer = null; }
        if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }

        const cfg = DIFFICULTY[diff];
        this._difficulty = diff;
        this._cols = cfg.cols;
        this._rows = cfg.rows;
        this._maxFails = cfg.maxFails;
        this._revealMs = cfg.revealMs;
        this._total = cfg.cols * cfg.rows;
        this._pairsLeft = this._total / 2;
        this._moves = 0;
        this._failCount = 0;
        this._highlightRow = Math.floor(cfg.rows / 2);
        this._highlightCol = Math.floor(cfg.cols / 2);
        this._pending = true;
        this._completed = false;
        this._won = false;
        this._matchedSet = new Set();
        this._flipped = [];

        const indices = [];
        for (let i = 0; i < POOL.length; i++) indices.push(i);
        _shuffle(indices);

        const pairCount = this._pairsLeft;
        const syms = indices.slice(0, pairCount);
        const deck = [];
        for (const s of syms) deck.push(s, s);
        _shuffle(deck);

        this._cellSym = [];
        this._revealed = [];
        this._flipProgress = [];
        let k = 0;
        for (let r = 0; r < this._rows; r++) {
            this._cellSym[r] = [];
            this._revealed[r] = [];
            this._flipProgress[r] = [];
            for (let c = 0; c < this._cols; c++) {
                this._cellSym[r][c] = POOL[deck[k++]];
                this._revealed[r][c] = false;
                this._flipProgress[r][c] = 0;
            }
        }

        this.open();
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._revealAll();
        this._revealTicksLeft = Math.round(this._revealMs / 100);
        this._render();

        this._revealTimer = setInterval(() => {
            const oldN = this._revealTicksLeft;
            this._revealTicksLeft--;
            if (this._revealTicksLeft <= 0) {
                clearInterval(this._revealTimer);
                this._revealTimer = null;
                for (let r = 0; r < this._rows; r++)
                    for (let c = 0; c < this._cols; c++)
                        this._revealed[r][c] = false;
                for (let r = 0; r < this._rows; r++)
                    for (let c = 0; c < this._cols; c++)
                        this._flipProgress[r][c] = 0;
                this._pending = false;
                this._render();
                return;
            }
            const lineW = this._boardW();
            const blank = _blankCell;
            this._rootVB.setCell(2, this._boardX - oldN, blank);
            this._rootVB.setCell(2, this._boardX + lineW + oldN - 1, blank);
            this._drawRevealDots(this._rootVB);
            term.writeVB(this._rootVB);
        }, 100);
    }

    _revealAll() {
        for (let r = 0; r < this._rows; r++)
            for (let c = 0; c < this._cols; c++)
                this._revealed[r][c] = true;
        for (let r = 0; r < this._rows; r++)
            for (let c = 0; c < this._cols; c++)
                this._flipProgress[r][c] = FLIP_COLUMNS;
    }

    _footerRow() {
        return this._rows * 2 + 6;
    }

    _initVBs() {
        this._backCells = [clipCells('▒', 7, 0, false), clipCells('▒', 7, 104, false)];
        this._faceCells = new Map();
        for (const row of this._cellSym) {
            for (const sym of row) {
                if (this._faceCells.has(sym)) continue;
                this._faceCells.set(sym, [
                    clipCells(sym, 7, 0, true), clipCells(sym, 7, 104, true),
                    clipCells(sym, 2, 0, true), clipCells(sym, 2, 104, true),
                ]);
            }
        }
        this._boardX = Math.floor((term.cols - this._boardW()) / 2);
        this._boardVB = new VirtualBuffer(this._boardW(), this._boardH());
        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._boardSlot = this._rootVB.addChildSlot();
        }
        Object.assign(this._boardSlot, { vb: this._boardVB, x: this._boardX, y: 2, active: true });
    }

    _render() {
        for (const row of this._boardVB._buffer) row.fill(_blankCell);
        for (const row of this._rootVB._buffer) row.fill(_blankCell);

        this._drawHeader(this._rootVB);
        this._drawFooter(this._rootVB);
        this._drawBoard(this._boardVB);
        this._drawRevealDots(this._rootVB);
        term.writeVB(this._rootVB);
    }

    _drawRevealDots(vb) {
        if (!(this._pending && this._revealTicksLeft > 0)) return;
        const lineW = this._boardW();
        const n = Math.min(this._revealTicksLeft, this._boardX - 1);
        for (let i = 1; i <= n; i++)
            vb.setCell(2, this._boardX - i, DOT_CELL);
        for (let i = 0; i < n; i++)
            vb.setCell(2, this._boardX + lineW + i, DOT_CELL);
    }

    _renderRow(r) {
        this._drawBoardRow(this._boardVB, r);
        term.writeVB(this._rootVB);
    }

    _drawHeader(vb) {
        const cfg = DIFFICULTY[this._difficulty];
        const title = '  Memory [' + cfg.label + ']';
        const stats = 'Moves: ' + this._moves +
            '  Fails: ' + red(this._failCount + '/' + this._maxFails) +
            '  Pairs left: ' + yellow(this._pairsLeft);
        vb.centerRow(0, bold(cyan(title)) + '  ' + stats);
    }

    _drawFooter(vb) {
        vb.centerRow(1, gray('  ←↑↓→ Move   Enter Flip   [n]ew [q]uit'));
    }

    _drawBoard(vb) {
        const lineW = this._boardW();
        vb.writeStr(0, 0, '╔' + '═'.repeat(lineW - 2) + '╗');
        for (let r = 0; r < this._rows; r++)
            this._drawBoardRow(vb, r);
        for (let y = 1; y < this._rows * 2 + 1; y++) {
            vb.setCell(y, 0, BORDER_CELL);
            vb.setCell(y, lineW - 1, BORDER_CELL);
        }
        vb.writeStr(this._rows * 2 + 1, 0, '╚' + '═'.repeat(lineW - 2) + '╝');
    }

    _drawBoardRow(vb, r) {
        const baseY = r * 2 + 1;
        for (let c = 0; c < this._cols; c++) {
            const isCur = r === this._highlightRow && c === this._highlightCol && !this._pending && !this._completed;
            const open = this._revealed[r][c];
            const sym = this._cellSym[r][c];
            const matched = this._matchedSet.has(sym) && open;
            const face = this._faceCells.get(sym)[(matched ? 2 : 0) + (isCur ? 1 : 0)];
            const back = this._backCells[isCur ? 1 : 0];
            const progress = this._flipProgress[r][c];
            for (let rr = 0; rr < 2; rr++) {
                for (let cc = 0; cc < FLIP_COLUMNS; cc++) {
                    const cells = open && cc < progress ? face : back;
                    vb.setCell(baseY + rr, 1 + c * 5 + cc, cells[rr * 4 + cc]);
                }
            }
        }
    }

    _move(dr, dc) {
        if (this._pending || this._completed) return;
        const nr = this._highlightRow + dr;
        const nc = this._highlightCol + dc;
        if (nr < 0 || nr >= this._rows || nc < 0 || nc >= this._cols) return;
        const oldR = this._highlightRow;
        this._highlightRow = nr;
        this._highlightCol = nc;
        this._renderRow(oldR);
        this._renderRow(nr);
    }

    _flip(r, c) {
        if (this._pending || this._completed) return;
        if (this._revealed[r][c]) return;
        if (this._flipped.length >= 2) return;
        if (this._matchedSet.has(this._cellSym[r][c])) return;

        this._flipped.push({ r, c });
        this._revealed[r][c] = true;
        this._flipProgress[r][c] = 0;

        this._pending = true;
        term.write(CURSOR_HIDE);
        this._drawHeader(this._rootVB);
        this._renderRow(r);
        this._animateFlip(r, c, () => {
            if (this._flipped.length === 1) {
                this._pending = false;
                this._drawHeader(this._rootVB);
                this._renderRow(r);
                return;
            }

            this._moves++;
            const [a, b] = this._flipped;
            const same = this._cellSym[a.r][a.c] === this._cellSym[b.r][b.c];
            if (same) {
                this._resolveFlip(a, b, same);
                return;
            }

            this._flipTimer = setTimeout(() => {
                this._flipTimer = null;
                this._resolveFlip(a, b, same);
            }, REVEAL_MS);
        });
    }

    _animateFlip(r, c, done) {
        let progress = 0;
        if (this._flipAnimTimer) clearInterval(this._flipAnimTimer);
        this._flipAnimTimer = setInterval(() => {
            progress++;
            this._flipProgress[r][c] = progress;
            this._renderRow(r);
            if (progress < FLIP_COLUMNS) return;
            clearInterval(this._flipAnimTimer);
            this._flipAnimTimer = null;
            done();
        }, FLIP_STEP_MS);
    }

    _resolveFlip(a, b, same) {
        if (!same) {
            this._failCount++;
            this._animateClose(a, b, () => {
                this._revealed[a.r][a.c] = false;
                this._revealed[b.r][b.c] = false;
                this._flipped = [];
                this._pending = false;
                this._drawHeader(this._rootVB);
                this._renderRow(a.r);
                this._renderRow(b.r);
                if (this._failCount >= this._maxFails) this._gameOver(false);
            });
            return;
        }

        this._flipped = [];
        this._matchedSet.add(this._cellSym[a.r][a.c]);
        this._pairsLeft--;
        this._pending = false;
        this._drawHeader(this._rootVB);
        this._renderRow(a.r);
        this._renderRow(b.r);
        if (this._pairsLeft === 0) {
            this._gameOver(true);
        }
    }

    _animateClose(a, b, done) {
        let progress = FLIP_COLUMNS;
        if (this._flipAnimTimer) clearInterval(this._flipAnimTimer);
        this._flipAnimTimer = setInterval(() => {
            progress--;
            this._flipProgress[a.r][a.c] = progress;
            this._flipProgress[b.r][b.c] = progress;
            this._renderRow(a.r);
            this._renderRow(b.r);
            if (progress > 0) return;
            clearInterval(this._flipAnimTimer);
            this._flipAnimTimer = null;
            done();
        }, FLIP_STEP_MS);
    }

    _gameOver(won) {
        this._completed = true;
        this._won = won;
        if (this._flipTimer) { clearTimeout(this._flipTimer); this._flipTimer = null; }
        if (this._flipAnimTimer) { clearInterval(this._flipAnimTimer); this._flipAnimTimer = null; }
        this._flipped = [];
        this._revealAll();
        term.write(CURSOR_HIDE);
        this._render();
        const msgRow = this._rows * 2 + 4;
        const msg = won
            ? bold(green('  Congratulations! Cleared in ' + this._moves + ' moves, ' + this._failCount + ' fails.'))
            : bold(red('  Game Over! ' + this._failCount + '/' + this._maxFails + ' fails.'));
        this._rootVB.centerRow(msgRow, msg);
        this._rootVB.centerRow(msgRow + 1, gray('  Press [n]ew game or [q]uit'));
        term.writeVB(this._rootVB);
    }

    _onKey(data) {

        if (this._completed) {
            const code = typeof data === 'string' ? data.charCodeAt(0) : data;
            if (code === 0x03) { this._quit(); return; }
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') { this._quit(); return; }
                if (ch === 'n') { this._pickDifficulty(); return; }
            }
            return;
        }

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._move(-1, 0); return; }
            if (s === '\x1B[B') { this._move(1, 0); return; }
            if (s === '\x1B[D') { this._move(0, -1); return; }
            if (s === '\x1B[C') { this._move(0, 1); return; }
            if (s === '\x1B[3~' || s === '\x1B[2~' ||
                s === '\x1B[H'  || s === '\x1B[F'  ||
                s === '\x1B[5~' || s === '\x1B[6~') return;
            if (s === '\x1B' || data === 0x1B) this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (code === 0x0D || code === 0x0A || code === 0x20) {
            this._flip(this._highlightRow, this._highlightCol);
            return;
        }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'n') { this._pickDifficulty(); return; }
        }
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        if (this._flipTimer) {
            clearTimeout(this._flipTimer);
            this._flipTimer = null;
        }
        if (this._revealTimer) {
            clearInterval(this._revealTimer);
            this._revealTimer = null;
        }
        if (this._flipAnimTimer) {
            clearInterval(this._flipAnimTimer);
            this._flipAnimTimer = null;
        }
        this.placeShellCursor(this._footerRow());
        this.close();
    }

    onCancel() {
        this._quit();
    }


    static get commandName() { return META.commandName; }
    static get help() { return META.help; }
    static get menu() { return META.menu; }
    static get usage() { return META.usage; }
}
