import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { SelectDialog } from '../dialog/SelectDialog.js';
import { VirtualBuffer } from '../util/VirtualBuffer.js';
import { bufWidth } from '../util/display-width.js';
import { bold, red, green, yellow, cyan, fg, CURSOR_HIDE, makeCell } from '../util/sgr.js';

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const N = 8;

const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
];

const DIFFICULTY = {
    easy:   { label: 'Easy' },
    medium: { label: 'Medium' },
    hard:   { label: 'Hard' },
};

// Positional weights for the medium evaluation.
const POS = [
    [120, -20,  10,   5,   5,  10, -20, 120],
    [ -20, -40,  -2,  -2,  -2,  -2, -40, -20],
    [  10,  -2,   1,   1,   1,   1,  -2,  10],
    [   5,  -2,   1,   0,   0,   1,  -2,   5],
    [   5,  -2,   1,   0,   0,   1,  -2,   5],
    [  10,  -2,   1,   1,   1,   1,  -2,  10],
    [ -20, -40,  -2,  -2,  -2,  -2, -40, -20],
    [ 120, -20,  10,   5,   5,  10, -20, 120],
];

const FLIP_MS = 150;
const THINK_MS = 150;
const BLINK_MS = 150;
const PASS_MS = 700;

const GRID_X = 31;
const GRID_Y = 4;
const BOARD_W = 18;
const BOARD_H = 10;
const STATUS_Y = 15;
const FOOTER_Y = 16;
const CLEAR_ROW = 18;

const idx = (r, c) => r * N + c;
const inb = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const other = (p) => p === BLACK ? WHITE : BLACK;

// ── Board rules ────────────────────────────────────────────────────────────

function discFlips(board, r, c, p) {
    if (board[idx(r, c)] !== EMPTY) return null;
    const opp = other(p);
    const out = [];
    for (const [dr, dc] of DIRS) {
        let rr = r + dr;
        let cc = c + dc;
        if (!inb(rr, cc)) continue;
        if (board[idx(rr, cc)] !== opp) continue;
        const seen = [];
        while (inb(rr, cc) && board[idx(rr, cc)] === opp) {
            seen.push(idx(rr, cc));
            rr += dr;
            cc += dc;
        }
        if (inb(rr, cc) && board[idx(rr, cc)] === p) {
            for (const id of seen) out.push(id);
        }
    }
    return out.length ? out : null;
}

function isValid(board, r, c, p) {
    if (board[idx(r, c)] !== EMPTY) return false;
    const opp = other(p);
    for (const [dr, dc] of DIRS) {
        let rr = r + dr;
        let cc = c + dc;
        if (!inb(rr, cc)) continue;
        if (board[idx(rr, cc)] !== opp) continue;
        rr += dr;
        cc += dc;
        while (inb(rr, cc) && board[idx(rr, cc)] === opp) {
            rr += dr;
            cc += dc;
        }
        if (inb(rr, cc) && board[idx(rr, cc)] === p) return true;
    }
    return false;
}

function getValidMoves(board, p) {
    const moves = [];
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
            if (isValid(board, r, c, p)) moves.push([r, c]);
    return moves;
}

function applyMove(board, r, c, p) {
    const flips = discFlips(board, r, c, p);
    if (!flips) return null;
    board[idx(r, c)] = p;
    for (const id of flips) board[id] = p;
    return flips;
}

function undoMove(board, r, c, p, flips) {
    board[idx(r, c)] = EMPTY;
    const opp = other(p);
    for (const id of flips) board[id] = opp;
}

function discDiff(board, p) {
    let d = 0;
    for (const v of board) {
        if (v === p) d++;
        else if (v !== EMPTY) d--;
    }
    return d;
}

function countPieces(board, p) {
    let n = 0;
    for (const v of board) if (v === p) n++;
    return n;
}

// ── Easy: random legal move ────────────────────────────────────────────────

function aiMoveEasy(board, p) {
    const moves = getValidMoves(board, p);
    if (!moves.length) return null;
    return moves[(Math.random() * moves.length) | 0];
}

// ── Shared evaluation: positional weights + mobility ─────────────────

function evalPos(board, ai) {
    const opp = other(ai);
    let score = 0;
    for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
            const v = board[idx(r, c)];
            if (v === ai) score += POS[r][c];
            else if (v === opp) score -= POS[r][c];
        }
    const my = getValidMoves(board, ai).length;
    const op = getValidMoves(board, opp).length;
    return score + (my - op) * 8;
}

// ── Medium: depth-1 — pick the move that maximizes the static eval ──────────

function aiMoveMedium(board, ai) {
    const moves = getValidMoves(board, ai);
    if (!moves.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const [r, c] of moves) {
        const flips = applyMove(board, r, c, ai);
        const s = evalPos(board, ai);
        undoMove(board, r, c, ai, flips);
        if (s > bestScore) {
            bestScore = s;
            best = [r, c];
        }
    }
    return best;
}

// ── Hard: minimax + alpha-beta, depth 3 (root + 2 replies) on evalPos ───────

function minimax(board, depth, alpha, beta, isMaximizing, ai) {
    if (depth <= 0) return evalPos(board, ai);
    const me = isMaximizing ? ai : other(ai);
    const moves = getValidMoves(board, me);
    if (moves.length === 0) {
        if (getValidMoves(board, other(me)).length === 0) {
            return discDiff(board, ai) * 10000;
        }
        return -minimax(board, depth - 1, -alpha, -beta, !isMaximizing, ai);
    }
    if (isMaximizing) {
        let best = -Infinity;
        for (const [r, c] of moves) {
            const flips = applyMove(board, r, c, me);
            const s = minimax(board, depth - 1, alpha, beta, false, ai);
            undoMove(board, r, c, me, flips);
            if (s > best) best = s;
            if (s > alpha) alpha = s;
            if (beta <= alpha) break;
        }
        return best;
    }
    let best = Infinity;
    for (const [r, c] of moves) {
        const flips = applyMove(board, r, c, me);
        const s = minimax(board, depth - 1, alpha, beta, true, ai);
        undoMove(board, r, c, me, flips);
        if (s < best) best = s;
        if (s < beta) beta = s;
        if (beta <= alpha) break;
    }
    return best;
}

function aiMoveHard(board, ai) {
    const moves = getValidMoves(board, ai);
    if (!moves.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const [r, c] of moves) {
        const flips = applyMove(board, r, c, ai);
        const s = minimax(board, 2, -Infinity, Infinity, false, ai);
        undoMove(board, r, c, ai, flips);
        if (s > bestScore) {
            bestScore = s;
            best = [r, c];
        }
    }
    return best;
}

export class OthelloCmd extends CmdBase {
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

    _pickDifficulty() {
        this._completed = false;
        this._difficulty = null;
        this._clearTimers();
        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        const opts = ['Easy', 'Medium', 'Hard'];
        const dialog = new SelectDialog(term, {
            title: 'Othello',
            message: yellow('Select difficulty'),
            options: opts,
            footer: '← → Move  ↩ Confirm  ESC Quit',
            onSelect: (i) => {
                this._difficultyDialog = null;
                this._startGame(opts[i].toLowerCase());
            },
            onCancel: () => {
                this._difficultyDialog = null;
                this._quit();
            },
        });
        dialog.open();
        this._difficultyDialog = dialog;
    }

    _startGame(diff) {
        this._difficulty = diff;
        this._completed = false;
        this._difficultyDialog = null;
        this._clearTimers();
        this._board = new Uint8Array(64);
        this._board[idx(3, 3)] = BLACK;
        this._board[idx(4, 4)] = BLACK;
        this._board[idx(3, 4)] = WHITE;
        this._board[idx(4, 3)] = WHITE;
        this._turn = BLACK;
        this._cursorR = 3;
        this._cursorC = 3;
        this._flipBusy = false;
        this._pendingFlips = null;
        this._waveIndex = 0;
        this._thinkHighlight = null;
        this._passMsg = null;
        this._result = null;
        this._firstMove = true;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._render();
    }

    _initCells() {
        if (this._cells) return;
        const cont = (bg) => makeCell('', 0, bg, false, 0);
        this._cells = {
            line: makeCell(' ', 0, 0, false),
            sq:   makeCell('　', 240, 0, false, 2),
            sq2:  cont(0),
            hint:  makeCell('・', 250, 0, false, 2),
            hint2: cont(0),
            black:     makeCell('◯', 15, 0, true, 2),
            blackC:    cont(0),
            white:     makeCell('⬤', 15, 0, true, 2),
            whiteC:    cont(0),
            curBlack:  makeCell('◯', 15, 5, true, 2),
            curBlackC: cont(5),
            curWhite:  makeCell('⬤', 15, 5, true, 2),
            curWhiteC: cont(5),
            curHint:    makeCell('・', 15, 5, false, 2),
            curHint2:   cont(5),
            curSq:     makeCell('　', 15, 5, false, 2),
            curSq2:    cont(5),
            thinkBlack:  makeCell('◯', 0, 3, true, 2),
            thinkBlackC: cont(3),
            thinkWhite:  makeCell('⬤', 15, 3, true, 2),
            thinkWhiteC: cont(3),
            thinkSq:     makeCell('　', 15, 3, false, 2),
            thinkSq2:    cont(3),
        };
    }

    _initVBs() {
        this._initCells();
        if (this._rootVB) return;
        this._rootVB = new VirtualBuffer(term.cols, term.rows);
        this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._slot = this._rootVB.addChildSlot();
        this._slot.vb = this._boardVB;
        this._slot.x = GRID_X;
        this._slot.y = GRID_Y;
        this._slot.active = true;
    }

    _render() {
        const C = this._cells;
        const root = this._rootVB;
        for (let r = 0; r < root.height; r++) {
            const row = root._buffer[r];
            for (let c = 0; c < row.length; c++) row[c] = C.line;
        }

        const vb = this._boardVB;
        for (let r = 0; r < vb.height; r++) {
            const row = vb._buffer[r];
            for (let c = 0; c < row.length; c++) row[c] = C.line;
        }
        vb.writeStr(0, 0, fg(250)('╔' + '═'.repeat(16) + '╗'));
        for (let r = 1; r <= 8; r++) {
            vb.writeStr(r, 0, fg(250)('║'));
            vb.writeStr(r, 17, fg(250)('║'));
        }
        vb.writeStr(9, 0, fg(250)('╚' + '═'.repeat(16) + '╝'));

        for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++)
                this._drawSquare(vb, r, c);

        this._drawHeader(root);
        this._drawStatus(root);
        this._drawFooter(root);
        term.writeVB(root);
    }

    _drawSquare(vb, r, c) {
        const C = this._cells;
        const x = 1 + c * 2;
        const y = 1 + r;
        const p = this._board[idx(r, c)];
        const isCur = this._flipBusy === false && this._completed === false &&
            this._turn === BLACK && r === this._cursorR && c === this._cursorC;
        const isThink = this._thinkHighlight &&
            this._thinkHighlight[0] === r && this._thinkHighlight[1] === c;

        let shown = p;
        if (p !== EMPTY && this._pendingFlips) {
            const ring = this._pendingFlips.get(idx(r, c));
            if (ring !== undefined && ring > this._waveIndex) shown = other(p);
        }

        let cell, cell2;
        if (shown === BLACK) {
            if (isThink) { cell = C.thinkBlack; cell2 = C.thinkBlackC; }
            else if (isCur) { cell = C.curBlack; cell2 = C.curBlackC; }
            else { cell = C.black; cell2 = C.blackC; }
        } else if (shown === WHITE) {
            if (isThink) { cell = C.thinkWhite; cell2 = C.thinkWhiteC; }
            else if (isCur) { cell = C.curWhite; cell2 = C.curWhiteC; }
            else { cell = C.white; cell2 = C.whiteC; }
        } else if (isThink) {
            cell = C.thinkSq;
            cell2 = C.thinkSq2;
        } else if (!this._flipBusy && !this._passMsg && !this._completed &&
                this._turn === BLACK && isValid(this._board, r, c, BLACK)) {
            if (isCur) { cell = C.curHint; cell2 = C.curHint2; }
            else { cell = C.hint; cell2 = C.hint2; }
        } else if (isCur) {
            cell = C.curSq;
            cell2 = C.curSq2;
        } else {
            cell = C.sq;
            cell2 = C.sq2;
        }
        vb.setCell(y, x, cell);
        vb.setCell(y, x + 1, cell2);
    }

    _drawHeader(root) {
        const label = DIFFICULTY[this._difficulty].label;
        const b = countPieces(this._board, BLACK);
        const w = countPieces(this._board, WHITE);
        const left = '  ' + bold(cyan('Othello')) + ' [' + label + ']';
        const right = '  ' + fg(240)('◯') + ' ' + b + '   ' + fg(240)('⬤') + ' ' + w + '  ';
        const pad = Math.max(0, root.width - bufWidth(left) - bufWidth(right));
        root.writeStr(0, 0, left + ' '.repeat(pad) + right);
    }

    _drawStatus(root) {
        root.writeStr(STATUS_Y, 1, ' '.repeat(60));
        let msg;
        if (this._completed) {
            msg = this._result || '';
        } else if (this._flipBusy) {
            msg = this._turn === WHITE ? yellow(' AI thinking...') : fg(240)(' Flipping...');
        } else if (this._passMsg) {
            msg = fg(240)(this._passMsg);
        } else if (this._turn === BLACK && this._firstMove) {
            msg = fg(240)(' Your turn — [p] pass, AI moves first');
        } else {
            msg = fg(240)(' Your turn');
        }
        root.writeStr(STATUS_Y, 1, '  ' + msg);
    }

    _drawFooter(root) {
        const pass = this._firstMove ? '   [p]ass' : '';
        root.writeStr(FOOTER_Y, 1, '  ' +
            fg(240)('←↑↓→ Move   Enter Place' + pass + '   [n]ew [q]uit'));
    }

    // ── Turn flow ───────────────────────────────────────────────────────────

    _tryPlace() {
        if (this._completed || this._flipBusy) return;
        if (this._turn !== BLACK) return;
        const r = this._cursorR;
        const c = this._cursorC;
        if (!isValid(this._board, r, c, BLACK)) return;
        this._playMove(r, c);
    }

    _passFirst() {
        if (this._completed || this._flipBusy) return;
        if (this._turn !== BLACK || !this._firstMove) return;
        this._firstMove = false;
        this._startAiTurn();
    }

    _playMove(r, c) {
        const p = this._turn;
        const flips = applyMove(this._board, r, c, p);
        if (!flips) return;
        this._firstMove = false;

        const map = new Map();
        let maxRing = 0;
        const rings = new Set();
        for (const id of flips) {
            const rr = (id / N) | 0;
            const cc = id % N;
            const ring = Math.max(Math.abs(rr - r), Math.abs(cc - c));
            map.set(id, ring);
            rings.add(ring);
            if (ring > maxRing) maxRing = ring;
        }

        this._pendingFlips = map;
        this._waveIndex = 0;
        this._flipBusy = true;
        this._render();

        const epoch = this.abortEpoch;
        for (const ring of rings) {
            const t = setTimeout(() => {
                if (this.abortEpoch !== epoch) return;
                if (this._completed) return;
                this._waveIndex = ring;
                for (const [id, rng] of [...this._pendingFlips]) {
                    if (rng === ring) this._pendingFlips.delete(id);
                }
                this._render();
            }, ring * FLIP_MS);
            this._timers.push(t);
        }

        const finalT = setTimeout(() => {
            if (this.abortEpoch !== epoch) return;
            if (this._completed) return;
            if (this._pendingFlips) this._pendingFlips = null;
            this._waveIndex = 0;
            this._flipBusy = false;
            this._nextTurn();
        }, maxRing * FLIP_MS + 40);
        this._timers.push(finalT);
    }

    _nextTurn() {
        const next = other(this._turn);
        if (getValidMoves(this._board, next).length > 0) {
            this._turn = next;
            this._render();
            if (next === WHITE) this._startAiTurn();
            return;
        }
        const back = other(next);
        if (getValidMoves(this._board, back).length === 0) {
            this._gameOver();
            return;
        }
        this._passMsg = (next === BLACK ? 'You' : 'AI') + ' has no moves — pass';
        this._turn = back;
        this._render();
        const epoch = this.abortEpoch;
        const t = setTimeout(() => {
            if (this.abortEpoch !== epoch) return;
            if (this._completed) return;
            this._passMsg = null;
            if (this._turn === WHITE) {
                this._startAiTurn();
            } else {
                this._render();
            }
        }, PASS_MS);
        this._timers.push(t);
    }

    _startAiTurn() {
        this._turn = WHITE;
        this._flipBusy = true;
        this._render();
        const moves = getValidMoves(this._board, WHITE);
        if (!moves.length) {
            this._flipBusy = false;
            this._render();
            return;
        }

        const shuffled = moves.slice().sort(() => Math.random() - 0.5);
        const k = 1 + ((Math.random() * 3) | 0);
        const cands = shuffled.slice(0, Math.min(k, shuffled.length));
        this._thinkHighlight = null;

        const epoch = this.abortEpoch;
        cands.forEach((m, i) => {
            const t = setTimeout(() => {
                if (this.abortEpoch !== epoch) return;
                if (this._completed) return;
                this._thinkHighlight = m;
                this._render();
            }, (i + 1) * THINK_MS);
            this._timers.push(t);
        });

        const decideT = setTimeout(() => {
            if (this.abortEpoch !== epoch) return;
            if (this._completed) return;
            this._thinkHighlight = null;
            this._render();
            let mv = null;
            if (this._difficulty === 'easy') {
                mv = aiMoveEasy(this._board, WHITE);
            } else if (this._difficulty === 'medium') {
                mv = aiMoveMedium(this._board, WHITE);
            } else {
                mv = aiMoveHard(this._board, WHITE);
            }
            if (!mv) {
                this._flipBusy = false;
                this._render();
                return;
            }
            this._thinkHighlight = mv;
            this._render();
            const blinkSeq = [null, mv, null];
            for (let i = 0; i < blinkSeq.length; i++) {
                const t = setTimeout(() => {
                    if (this.abortEpoch !== epoch) return;
                    if (this._completed) return;
                    this._thinkHighlight = blinkSeq[i];
                    this._render();
                }, (i + 1) * BLINK_MS);
                this._timers.push(t);
            }
            const playT = setTimeout(() => {
                if (this.abortEpoch !== epoch) return;
                if (this._completed) return;
                this._thinkHighlight = null;
                this._playMove(mv[0], mv[1]);
            }, 4 * BLINK_MS);
            this._timers.push(playT);
        }, (cands.length + 1) * THINK_MS);
        this._timers.push(decideT);
    }

    _gameOver() {
        this._completed = true;
        this._flipBusy = false;
        this._pendingFlips = null;
        this._thinkHighlight = null;
        const b = countPieces(this._board, BLACK);
        const w = countPieces(this._board, WHITE);
        if (b > w) {
            this._result = bold(green('Black wins! ')) + yellow(b + ' vs ' + w);
        } else if (w > b) {
            this._result = bold(red('White wins! ')) + yellow(b + ' vs ' + w);
        } else {
            this._result = bold(fg(240)('Draw! ')) + yellow(b + ' vs ' + w);
        }
        this._render();
    }

    // ── Input ───────────────────────────────────────────────────────────────

    _move(dr, dc) {
        const nr = this._cursorR + dr;
        const nc = this._cursorC + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) return;
        this._cursorR = nr;
        this._cursorC = nc;
        this._render();
    }

    _onKey(data) {
        if (this._difficultyDialog) {
            this._difficultyDialog.handleKey(data);
            return;
        }

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A') { this._move(-1, 0); return; }
            if (s === '\x1B[B') { this._move(1, 0); return; }
            if (s === '\x1B[C') { this._move(0, 1); return; }
            if (s === '\x1B[D') { this._move(0, -1); return; }
            if (s === '\x1B[3~') return;
            if (s === '\x1B[2~') return;
            if (s === '\x1B[H' || s === '\x1B[1~') return;
            if (s === '\x1B[F' || s === '\x1B[4~') return;
            if (s === '\x1B[5~') return;
            if (s === '\x1B[6~') return;
            this._quit();
            return;
        }

        if (code === 0x03) { this._quit(); return; }

        if (code === 0x0D || code === 0x0A || code === 0x20) {
            this._tryPlace();
            return;
        }

        if (typeof data === 'string') {
            const ch = data.toLowerCase();
            if (ch === 'q') { this._quit(); return; }
            if (ch === 'n') { this._newGame(); return; }
            if (ch === 'p') { this._passFirst(); return; }
        }
    }

    _newGame() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._clearTimers();
        this._pickDifficulty();
    }

    _clearTimers() {
        if (this._timers) {
            for (const t of this._timers) clearTimeout(t);
        }
        this._timers = [];
    }

    _quit() {
        if (this._difficultyDialog) {
            this._difficultyDialog.close();
            this._difficultyDialog = null;
        }
        this._clearTimers();
        term.write('\x1B[' + CLEAR_ROW + ';1H');
        this.close();
    }

    onCancel() {
        this._quit();
    }

    static get commandName() { return 'othello'; }
    static get help() { return 'Play Othello (Reversi)'; }
    static get menu() { return 'Othello'; }
    static get usage() { return 'othello [--easy|--medium|--hard]'; }
}

// Pure game-logic helpers, exported for testability (no commandName, so the
// command registry skips them).
export { EMPTY, BLACK, WHITE, idx, getValidMoves, discFlips, isValid, applyMove, undoMove, aiMoveEasy, aiMoveMedium, aiMoveHard };