import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE, yellow, bold, green, red, fg } from '../../util/sgr.js';
import { FieldPickerDialog } from '../../dialog/FieldPickerDialog.js';
import { idx, isValid, applyMove, other, getValidMoves, countPieces } from './board.js';
import { BLACK, WHITE, N, FLIP_MS, PASS_MS, THINK_MS, BLINK_MS, CLEAR_ROW } from './constants.js';
import { aiMoveEasy, aiMoveMedium, aiMoveHard } from './ai.js';
import { renderMethods } from './render.js';
import { GAME_META } from '../game-meta.js';
const META = GAME_META.othello;

class OthelloCmd extends CmdBase {
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
        this._difficultyDialog = this.openDialog(FieldPickerDialog, 'othello-diff', {
            title: 'Othello',
            fields: [{ key: 'difficulty', label: '難度',
                options: [['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']] }],
            onConfirm: ({ difficulty }) => {
                this._difficultyDialog = null;
                this._startGame(difficulty);
            },
            onCancel: () => {
                this._difficultyDialog = null;
                this._quit();
            },
        });
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
        this._cursorFlips = null;

        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._render();
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
            if (s === '\x1B' || data === 0x1B) this._quit();
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
        this.placeShellCursor(CLEAR_ROW - 1);
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

// Keep the command as the state owner and preserve class-method descriptors.
for (const methods of [renderMethods]) {
    for (const [name, value] of Object.entries(methods)) {
        Object.defineProperty(OthelloCmd.prototype, name, {
            value, writable: true, configurable: true, enumerable: false,
        });
    }
}

export { OthelloCmd };
