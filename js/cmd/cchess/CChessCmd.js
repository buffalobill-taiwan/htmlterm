import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { CURSOR_HIDE } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { VerticalSelectDialog } from '../../dialog/VerticalSelectDialog.js';
import { parseFen, moveToNotation } from './engine/notation.js';
import { generateLegalMoves } from './engine/rules.js';
import { applyBoardCopy } from './engine/board.js';
import { opp, movesEqual } from './engine/helpers.js';
import { INITIAL_FEN } from './constants.js';
import { boardKey, positionKey, hasLost, responseMove } from './endgames.js';
import { animateMove } from './animation.js';
import { ConfirmDialog } from '../../dialog/ConfirmDialog.js';
import { renderMethods } from './render.js';

export class CChessCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args);
        if (p.hasHelp) return this.showHelp();
        if (p.rest.length) { this.error('Usage: cchess'); return; }
        this._stopAsync();
        this._cache = new Map();
        this._index = null;
        this._board = null;
        this._mode = null;
        this._puzzle = null;
        this._log = [];
        this._difficulty = null;
        this._human = 'red';
        this._completed = false;
        this._result = this._message = null;
        this.open();
        this.addCleanup(() => this._stopAsync());
        term.write('\x1B[2J\x1B[H' + CURSOR_HIDE);
        this._initVBs();
        this._render();
        this._pickMode();
    }

    _pickMode() {
        this._stopAsync();
        this._choice('選擇模式', ['人機對弈', '殘局遊戲'], i => {
            this._mode = i === 0 ? 'ai' : 'endgame';
            if (i === 0) this._pickAI(); else this._pickEndgame();
        });
    }

    _choice(message, options, onSelect, vertical = false, onBack = null) {
        if (this._dialog) { this._dialog.close(); this._dialog = null; }
        this._dialog = this.openDialog(vertical ? VerticalSelectDialog : SelectDialog, 'cchess-select', {
            title: '中國象棋', message, options, width: 48, cols: 1,
            footer: `${vertical ? '↑ ↓' : '← →'} 選擇  Enter 確認  Esc ${onBack ? '返回' : '退出'}`,
            onSelect: i => { this._dialog = null; onSelect(i); },
            onCancel: () => {
                this._dialog = null;
                if (onBack) onBack();
                else this._confirmQuit(() => this._choice(message, options, onSelect, vertical));
            },
        });
    }

    _pickAI() {
        this._stopAsync();
        this._choice('選擇難度', ['Easy', 'Medium', 'Hard'], i => {
            this._difficulty = ['easy', 'medium', 'hard'][i];
            this._choice('選擇先後手', ['先手（紅方）', '後手（黑方）'], side => {
                this._human = side === 0 ? 'red' : 'black';
                this._puzzle = null;
                this._start(INITIAL_FEN);
            }, false, () => this._pickAI());
        }, false, () => this._pickMode());
    }

    async _fetchJSON(file, signal) {
        const response = await fetch(new URL(`../../data/cchess/${file}`, import.meta.url), { signal });
        if (!response.ok) throw new Error(`載入失敗：${response.status}`);
        return response.json();
    }

    async _pickEndgame() {
        this._stopAsync();
        const epoch = this._epoch;
        this._load = new AbortController();
        this._busy = true; this._message = '載入題目列表…'; this._render();
        try {
            const list = this._index ?? await this._fetchJSON('index.json', this._load.signal);
            if (epoch !== this._epoch) return;
            if (!Array.isArray(list) || !list.length) throw new Error('尚無殘局題目');
            list.sort((a, b) => a.step - b.step);
            this._index = list;
            this._busy = false; this._message = null;
            this._choice('選擇殘局', list.map(p => `${p.name}（${p.step} 步）`), i => this._loadEndgame(list[i]), true, () => this._pickMode());
        } catch (error) {
            if (epoch === this._epoch) this._fail(error);
        }
    }

    async _loadEndgame(entry) {
        this._stopAsync();
        const epoch = this._epoch;
        this._load = new AbortController();
        this._busy = true; this._message = '載入殘局…'; this._render();
        try {
            if (!/^[a-z0-9-]+\.json$/.test(entry.file)) throw new Error('題目檔名錯誤');
            const puzzle = this._cache.get(entry.id) ?? await this._fetchJSON(entry.file, this._load.signal);
            if (epoch !== this._epoch) return;
            if (!puzzle.meta || puzzle.meta.name !== entry.name || puzzle.meta.step !== entry.step || !puzzle.table) {
                throw new Error('題目索引與內容不符');
            }
            parseFen(puzzle.meta.init, { allowMissingKings: false });
            this._cache.set(entry.id, puzzle);
            this._puzzle = puzzle; this._human = 'red';
            this._start(puzzle.meta.init);
        } catch (error) {
            if (epoch === this._epoch) this._fail(error);
        }
    }

    _start(fen) {
        this._stopAsync();
        this._initialFen = fen;
        this._board = parseFen(fen, { allowMissingKings: false }).board;
        this._turn = 'red';
        this._completed = false;
        this._result = this._message = null;
        this._selected = null; this._destinations = new Set();
        this._lastMove = null;
        this._cursorR = this._human === 'red' ? 9 : 0;
        this._cursorC = 4;
        this._humanSteps = 0; this._log = [];
        this._history = [positionKey(this._board, this._turn)];
        this._render();
        if (this._human !== this._turn) this._aiTurn();
    }

    _select() {
        if (this._busy || this._completed || !this._board || this._turn !== this._human) return;
        const r = this._cursorR, c = this._cursorC;
        const piece = this._board[r][c];
        if (piece?.color === this._human) {
            if (this._selected?.row === r && this._selected?.col === c) this._selected = null;
            else this._selected = { row: r, col: c };
            this._destinations.clear();
            if (this._selected) for (const move of generateLegalMoves(this._board, this._turn)) {
                if (move.from.row === r && move.from.col === c) this._destinations.add(move.to.row*9+move.to.col);
            }
            this._message = null; this._render(); return;
        }
        if (!this._selected) return;
        const move = generateLegalMoves(this._board, this._turn).find(m =>
            m.from.row === this._selected.row && m.from.col === this._selected.col && m.to.row === r && m.to.col === c);
        if (!move) { this._message = '此處不能落子'; this._render(); return; }
        this._play(move);
    }

    async _play(move) {
        const epoch = this._epoch, color = this._turn;
        try {
            if (!generateLegalMoves(this._board, color).some(m => movesEqual(m, move))) throw new Error('非法走法');
            const piece = this._board[move.from.row][move.from.col];
            const notation = moveToNotation(this._board, move, color);
            this._busy = true; this._selected = null; this._destinations.clear();
            this._message = '棋子移動中…'; this._render();
            if (!await animateMove(this, piece, move) || epoch !== this._epoch) return;
            this._board = applyBoardCopy(this._board, move);
            this._lastMove = move;
            this._turn = opp(color);
            this._history.push(positionKey(this._board, this._turn));
            if (color === 'red') this._log.push(`${this._log.length+1}. ${notation}`);
            else this._log[this._log.length-1] += `  ${notation}`;
            if (color === this._human) this._humanSteps++;
            this._busy = false; this._message = null;
            if (hasLost(this._board, this._turn)) {
                this._completed = true;
                this._result = color === this._human ? '恭喜！你獲勝了' : '你落敗了，按 r 重試';
                this._render(); return;
            }
            this._render();
            if (this._turn !== this._human) {
                if (this._mode === 'endgame') {
                    const key = boardKey(this._board);
                    if (!Object.hasOwn(this._puzzle.table, key)) throw new Error('題目缺少此走法的應手');
                    const target = this._puzzle.table[key];
                    const reply = typeof target === 'string' ? responseMove(this._board, target) : null;
                    if (!reply) throw new Error('題目黑方應手不合法');
                    await this._play(reply);
                } else await this._aiTurn();
            }
        } catch (error) {
            if (epoch === this._epoch) this._fail(error);
        }
    }

    async _aiTurn() {
        const epoch = this._epoch;
        this._busy = true; this._message = null; this._render();
        try {
            const response = await new Promise((resolve, reject) => {
                const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
                this._worker = worker;
                this._cancelWorker = () => {
                    worker.onmessage = worker.onerror = null;
                    worker.terminate(); resolve(null);
                };
                worker.onmessage = ({ data }) => {
                    worker.terminate();
                    this._worker = null; this._cancelWorker = null;
                    if (data.error) reject(new Error(data.error)); else resolve(data.move);
                };
                worker.onerror = () => {
                    worker.terminate(); this._worker = null; this._cancelWorker = null;
                    reject(new Error('電腦搜尋失敗'));
                };
                worker.postMessage({ board: this._board, color: this._turn, difficulty: this._difficulty, history: this._history });
            });
            if (epoch !== this._epoch) return;
            if (!response) throw new Error('電腦未產生合法走法');
            await this._play(response);
        } catch (error) {
            if (epoch === this._epoch) this._fail(error);
        }
    }

    _fail(error) {
        this._stopAsync();
        this._completed = true;
        this._result = error.message;
        this._render();
    }

    _stopAsync() {
        this._epoch = (this._epoch ?? 0) + 1;
        this._cancelAnimation?.(); this._cancelAnimation = null;
        this._cancelWorker?.(); this._cancelWorker = null; this._worker = null;
        this._load?.abort(); this._load = null;
        this._busy = false;
    }

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        if (data === '\x1B' || data === 27 || data === 'q' || data === 'Q') { this._confirmQuit(); return; }
        if (code === 3) { this._quit(); return; }
        if (data === 'n' || data === 'N') {
            if (this._mode === 'endgame') this._pickEndgame(); else this._pickAI();
            return;
        }
        if (data === 'r' || data === 'R') { if (this._initialFen) this._start(this._initialFen); return; }
        if (this._busy || this._completed || !this._board) return;
        const arrows = { '\x1B[A': [-1,0], '\x1B[B': [1,0], '\x1B[C': [0,1], '\x1B[D': [0,-1] };
        if (arrows[data]) {
            const [dr, dc] = arrows[data];
            this._cursorR = Math.max(0, Math.min(9, this._cursorR+dr));
            this._cursorC = Math.max(0, Math.min(8, this._cursorC+dc));
            this._render(); return;
        }
        // All other escape sequences, including editing/navigation keys, are ignored.
        if (code === 27) return;
        if (data === ' ') {
            this._selected = null; this._destinations.clear(); this._message = null;
            this._render(); return;
        }
        if (code === 13 || code === 10) this._select();
    }

    _confirmQuit(onContinue = () => this._render()) {
        if (this._dialog) return;
        this._dialog = this.openDialog(ConfirmDialog, 'cchess-quit', {
            title: '退出中國象棋', message: '確定要退出目前的遊戲嗎？',
            confirmLabel: '退出', cancelLabel: '繼續遊戲', selectedIndex: 1,
            onConfirm: () => { this._dialog = null; this._quit(); },
            onCancel: () => { this._dialog = null; onContinue(); },
        });
    }

    _quit() {
        this._stopAsync();
        if (this._dialog) { this._dialog.close(); this._dialog = null; }
        this._cache?.clear();
        this.placeShellCursor(24);
        this.close();
    }
    onCancel() { this._quit(); }
    static get commandName() { return 'cchess'; }
    static get help() { return 'Play Chinese chess or endgame puzzles'; }
    static get menu() { return '中國象棋'; }
    static get usage() { return 'cchess'; }
}

for (const [name, value] of Object.entries(renderMethods)) {
    Object.defineProperty(CChessCmd.prototype, name, { value, writable: true, configurable: true });
}
