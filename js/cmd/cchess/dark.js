import { CHARS } from './engine/constants.js';
import { opp } from './engine/helpers.js';
import { FieldPickerDialog } from '../../dialog/FieldPickerDialog.js';
// This export was added with dark-chess blinking; bypass older cached modules.
import { animateDarkAction } from './animation.js?v=dark-blink-1';

const RANK = { king: 7, advisor: 6, elephant: 5, chariot: 4, horse: 3, cannon: 2, soldier: 1 };

export function newDarkBoard() {
    const pieces = [];
    for (const color of ['red', 'black']) {
        for (const [type, count] of Object.entries({ king: 1, advisor: 2, elephant: 2, chariot: 2, horse: 2, cannon: 2, soldier: 5 })) {
            for (let i = 0; i < count; i++) pieces.push({ color, type, hidden: true });
        }
    }
    for (let i = pieces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    return Array.from({ length: 4 }, (_, r) => pieces.slice(r * 8, r * 8 + 8));
}

export function darkMoves(board, color) {
    const moves = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece?.hidden) { moves.push({ to: { row: r, col: c } }); continue; }
        if (!piece || piece.color !== color) continue;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
            const target = board[y][x], distance = Math.abs(y-r) + Math.abs(x-c);
            if (!distance || target?.hidden || target?.color === color) continue;
            let legal = !target && distance === 1;
            if (target && piece.type === 'cannon' && (r === y || c === x)) {
                const dr = Math.sign(y-r), dc = Math.sign(x-c);
                let screens = 0;
                for (let a = r+dr, b = c+dc; a !== y || b !== x; a += dr, b += dc) if (board[a][b]) screens++;
                legal = screens === 1;
            } else if (target && piece.type !== 'cannon' && distance === 1) {
                legal = piece.type === 'soldier' ? ['soldier', 'king'].includes(target.type) :
                    !(piece.type === 'king' && target.type === 'soldier') && RANK[piece.type] >= RANK[target.type];
            }
            if (legal) moves.push({ from: { row: r, col: c }, to: { row: y, col: x } });
        }
    }
    return moves;
}

export const darkMethods = {
    _pickDark() {
        this._stopAsync();
        this._dialog = this.openDialog(FieldPickerDialog, 'cchess-dark-setup', {
            title: '休閒暗棋', width: 48,
            footer: '↑↓ 切換  ← → 選擇  Enter 開始  Esc 返回',
            fields: [
                { key: 'difficulty', label: '難度', default: this._darkDifficulty || 'medium',
                  options: [['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']] },
                { key: 'first', label: '先後手', default: this._darkFirst || 'human',
                  options: [['先手', 'human'], ['後手', 'computer']] },
            ],
            onConfirm: ({ difficulty, first }) => {
                this._dialog = null;
                this._darkDifficulty = difficulty; this._darkFirst = first;
                this._startDark();
            },
            onCancel: () => { this._dialog = null; this._pickMode(); },
        });
    },

    _startDark(restart = false) {
        this._stopAsync();
        if (!restart || !this._darkInitial) this._darkInitial = newDarkBoard();
        this._board = this._darkInitial.map(row => row.map(p => ({ ...p })));
        this._human = this._turn = null;
        this._puzzle = this._initialFen = null;
        this._completed = false;
        this._result = this._message = this._selected = this._lastMove = null;
        this._destinations = new Set();
        this._cursorR = this._cursorC = this._humanSteps = this._quietMoves = 0;
        this._log = [];
        this._render();
        if (this._darkFirst === 'computer') this._darkAITurn();
    },

    _selectDark() {
        const row = this._cursorR, col = this._cursorC, piece = this._board[row][col];
        if (piece?.hidden) { this._playDark({ to: { row, col } }); return; }
        if (piece && piece.color === this._human) {
            this._selected = this._selected?.row === row && this._selected?.col === col ? null : { row, col };
            this._destinations.clear();
            if (this._selected) for (const m of darkMoves(this._board, this._human)) {
                if (m.from?.row === row && m.from.col === col) this._destinations.add(m.to.row * 8 + m.to.col);
            }
            this._message = null;
            this._render(); return;
        }
        const move = darkMoves(this._board, this._human).find(m => m.from && this._selected &&
            m.from.row === this._selected.row && m.from.col === this._selected.col && m.to.row === row && m.to.col === col);
        if (move) this._playDark(move);
        else { this._message = '此處不能落子'; this._render(); }
    },

    _playDark(move) {
        const { from, to } = move, target = this._board[to.row][to.col];
        if (!from) {
            this._board[to.row][to.col] = { ...target, hidden: false };
            if (!this._human) {
                this._turn = target.color;
                this._human = this._darkFirst === 'computer' ? opp(target.color) : target.color;
            }
        } else {
            this._board[to.row][to.col] = this._board[from.row][from.col];
            this._board[from.row][from.col] = null;
        }
        const actor = this._turn === this._human ? '玩家' : '電腦';
        const piece = this._board[to.row][to.col];
        this._log.push(`${actor}${from ? target ? '吃子' : '移動' : '翻開'}：${CHARS[piece.color][piece.type]} (${to.row+1},${to.col+1})`);
        if (this._turn === this._human) this._humanSteps++;
        this._quietMoves = !from || target ? 0 : this._quietMoves + 1;
        this._turn = opp(this._turn);
        this._lastMove = { from: from || to, to };
        this._selected = this._message = null;
        this._destinations.clear();
        this._busy = false;
        const remaining = this._board.flat().some(p => p?.color === this._turn);
        if (!remaining || !darkMoves(this._board, this._turn).length) {
            this._completed = true;
            this._result = this._turn !== this._human ? '恭喜！你獲勝了' : '你落敗了，按 r 重試';
        } else if (this._quietMoves >= 80) {
            this._completed = true; this._result = '連續 80 步未吃子或翻棋，和局';
        }
        if (!this._completed && this._turn !== this._human) {
            this._darkAITurn();
        }
        this._render();
    },

    _darkAITurn() {
        const epoch = this._epoch;
        this._busy = true;
        this._render();
        this._darkTimer = setTimeout(async () => {
            this._darkTimer = null;
            try {
                const move = chooseDarkMove(this._board, this._turn, this._darkDifficulty || 'medium');
                if (!move) return;
                if (!await animateDarkAction(this, move) || epoch !== this._epoch) return;
                this._playDark(move);
            } catch (error) {
                if (epoch === this._epoch) this._fail(error);
            }
        }, 450);
    },
};

// Search only visible moves. Flips are an unknown-information alternative, not
// a peek at the shuffled board. Medium considers replies; Hard looks one ply further.
export function chooseDarkMove(board, color, difficulty, random = Math.random) {
    const value = p => p && !p.hidden ? RANK[p.type] * 10 : 0;
    const evaluate = b => b.flat().reduce((sum, p) => sum + (p?.color === color ? 1 : -1) * value(p), 0);
    const apply = (b, m) => {
        const next = b.map(row => row.slice());
        next[m.to.row][m.to.col] = next[m.from.row][m.from.col];
        next[m.from.row][m.from.col] = null;
        return next;
    };
    const search = (b, side, depth, alpha, beta) => {
        if (!depth) return evaluate(b);
        const actions = darkMoves(b, side);
        if (!actions.length) return side === color ? -10000 : 10000;
        let best = side === color ? -Infinity : Infinity;
        for (const m of actions) {
            const score = m.from ? search(apply(b, m), opp(side), depth-1, alpha, beta) : evaluate(b);
            if (side === color) { best = Math.max(best, score); alpha = Math.max(alpha, best); }
            else { best = Math.min(best, score); beta = Math.min(beta, best); }
            if (beta <= alpha) break;
        }
        return best;
    };
    const moves = darkMoves(board, color);
    let best = -Infinity, choices = [];
    for (const m of moves) {
        let score;
        if (difficulty === 'easy') score = !m.from ? 2 : value(board[m.to.row][m.to.col]);
        else score = !m.from ? evaluate(board) + 2 : search(apply(board, m), opp(color), difficulty === 'hard' ? 2 : 1, -Infinity, Infinity);
        if (score > best) { best = score; choices = [m]; }
        else if (score === best) choices.push(m);
    }
    return choices[Math.floor(random() * choices.length)];
}
