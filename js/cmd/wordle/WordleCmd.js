import { term } from '../../system/sys.js';
import { CmdBase } from '../CmdBase.js';
import { CURSOR_HIDE, makeCell } from '../../util/sgr.js';
import { bufWidth } from '../../util/display-width.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { loadValidWords } from './valid-words.js';
import ANSWERS from '../../data/wordle-answers.json' with { type: 'json' };

function toFullwidth(ch) {
    if (ch.length > 1) return ch.split('').map(toFullwidth).join('');
    const code = ch.toUpperCase().charCodeAt(0);
    if (code >= 0x41 && code <= 0x5A) {
        return String.fromCharCode(0xFF21 + (code - 0x41));
    }
    return ch;
}

function evaluateGuess(guess, answer) {
    const result = new Array(5).fill('absent');
    const used = new Array(5).fill(false);

    for (let i = 0; i < 5; i++) {
        if (guess[i] === answer[i]) {
            result[i] = 'correct';
            used[i] = true;
        }
    }

    for (let i = 0; i < 5; i++) {
        if (result[i] === 'correct') continue;
        for (let j = 0; j < 5; j++) {
            if (used[j]) continue;
            if (guess[i] === answer[j]) {
                result[i] = 'present';
                used[j] = true;
                break;
            }
        }
    }

    return result;
}

const TITLE_Y = 0;
const TITLE_X = 34;
const BOARD_X = 32;
const BOARD_Y = 1;
const BOARD_W = 16;
const BOARD_H = 13;
const MSG_Y = 14;
const KEYBOARD_X = 20;
const KEYBOARD_Y = 16;
const KEYBOARD_W = 40;
const KEYBOARD_H = 6;

const KEY_ROWS = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m'],
];

const BORDER = '\x1B[90m';
const RESET = '\x1B[0m';
const TOP_BORDER = BORDER + '┌──┬──┬──┬──┬──┐' + RESET;
const SEP_BORDER = BORDER + '├──┼──┼──┼──┼──┤' + RESET;
const BOT_BORDER = BORDER + '└──┴──┴──┴──┴──┘' + RESET;
const EMPTY_ROW  = BORDER + '│　│　│　│　│　│' + RESET;

function colorCode(code) {
    return code === 'correct' ? '\x1B[97;42m' :
           code === 'present'  ? '\x1B[97;43m' :
           '\x1B[97;100m';
}

export class WordleCmd extends CmdBase {
    execute(args) {
        this.addCleanup(() => this._cancelReveal());
        this._answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
        this._guesses = [];
        this._currentGuess = '';
        this._gameOver = false;
        this._won = false;
        this._message = '';
        this._keyState = {};
        this._revealState = null;
        this._validWords = null;
        this._wordsError = false;
        loadValidWords().then((set) => { this._validWords = set; })
            .catch(() => { this._wordsError = true; });

        this.open();
        term.write(CURSOR_HIDE);
        this._initVBs();
        this._render();
    }

    _initVBs() {
        this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
        this._rootVB = new VirtualBuffer(term.cols, term.rows);
        this._boardSlot = this._rootVB.addChildSlot();
        this._boardSlot.vb = this._boardVB;
        this._boardSlot.x = BOARD_X;
        this._boardSlot.y = BOARD_Y;
        this._boardSlot.active = true;

        this._keyboardVB = new VirtualBuffer(KEYBOARD_W, KEYBOARD_H);
        this._keyboardSlot = this._rootVB.addChildSlot();
        this._keyboardSlot.vb = this._keyboardVB;
        this._keyboardSlot.x = KEYBOARD_X;
        this._keyboardSlot.y = KEYBOARD_Y;
        this._keyboardSlot.active = true;
    }

    _render() {
        const root = this._rootVB;
        for (let r = 0; r < root.height; r++)
            root.writeStr(r, 0, ' '.repeat(root.width));

        root.writeStr(TITLE_Y, TITLE_X, '\x1B[1;33mＷＯＲＤＬＥ\x1B[0m');

        const board = this._boardVB;
        for (let r = 0; r < board.height; r++)
            board.writeStr(r, 0, ' '.repeat(board.width));

        board.writeStr(0, 0, TOP_BORDER);
        for (let i = 0; i < 6; i++) {
            const contentY = 1 + i * 2;

            if (i < this._guesses.length) {
                const guess = this._guesses[i];
                const result = evaluateGuess(guess, this._answer);
                let row = BORDER + '│' + RESET;
                for (let j = 0; j < 5; j++) {
                    const fw = toFullwidth(guess[j]);
                    row += colorCode(result[j]) + fw + RESET + BORDER + '│' + RESET;
                }
                board.writeStr(contentY, 0, row);
            } else if (this._revealState && i === this._revealState.rowIdx) {
                let row = BORDER + '│' + RESET;
                for (let j = 0; j < 5; j++) {
                    const fw = toFullwidth(this._revealState.guess[j]);
                    if (j < this._revealState.pos) {
                        row += colorCode(this._revealState.result[j]) + fw + RESET;
                    } else {
                        row += '\x1B[97;44m' + fw + RESET;
                    }
                    row += BORDER + '│' + RESET;
                }
                board.writeStr(contentY, 0, row);
            } else if (!this._gameOver && i === this._guesses.length) {
                let row = BORDER + '│' + RESET;
                for (let j = 0; j < 5; j++) {
                    if (j < this._currentGuess.length) {
                        const fw = toFullwidth(this._currentGuess[j]);
                        row += '\x1B[97;44m' + fw + RESET;
                    } else {
                        row += BORDER + '　' + RESET;
                    }
                    row += BORDER + '│' + RESET;
                }
                board.writeStr(contentY, 0, row);
            } else {
                board.writeStr(contentY, 0, EMPTY_ROW);
            }

            board.writeStr(2 + i * 2, 0, i < 5 ? SEP_BORDER : BOT_BORDER);
        }

        if (this._message) {
            const mw = bufWidth(this._message);
            const cx = Math.max(0, Math.floor((root.width - mw) / 2));
            root.writeStr(MSG_Y, cx, this._message + RESET);
        }

        const kb = this._keyboardVB;
        for (let r = 0; r < kb.height; r++)
            kb.writeStr(r, 0, ' '.repeat(kb.width));
        for (let ri = 0; ri < KEY_ROWS.length; ri++) {
            const keys = KEY_ROWS[ri];
            const rowW = keys.length * 4;
            const cx = Math.max(0, Math.floor((kb.width - rowW) / 2));
            for (let k = 0; k < keys.length; k++) {
                const ch = keys[k];
                const s = this._keyState[ch];
                const fg = s === 'correct' ? 15 : s === 'present' ? 15 : s === 'absent' ? 15 : 8;
                const bg = s === 'correct' ? 2 : s === 'present' ? 3 : s === 'absent' ? 8 : 0;
                const fw = toFullwidth(ch);
                const x = cx + k * 4;
                const y = ri * 2;
                for (let rr = 0; rr < 2; rr++) {
                    for (let cc = 0; cc < 4; cc++) {
                        const cell = makeCell(fw, fg, bg, false, 1);
                        cell.clip = true;
                        cell.clipOffX = -cc;
                        cell.clipOffY = -rr;
                        kb.setCell(y + rr, x + cc, cell);
                    }
                }
            }
        }

        term.writeVB(root);
    }

    _updateKeyState(guess, result) {
        for (let i = 0; i < 5; i++) {
            const ch = guess[i];
            const s = result[i];
            const prev = this._keyState[ch];
            if (s === 'correct') this._keyState[ch] = 'correct';
            else if (s === 'present' && prev !== 'correct') this._keyState[ch] = 'present';
            else if (prev !== 'correct' && prev !== 'present') this._keyState[ch] = 'absent';
        }
    }

    _cancelReveal() {
        clearTimeout(this._revealTimer);
        this._revealTimer = null;
        this._revealState = null;
    }

    _startReveal(guess, result) {
        this._revealState = { guess, result, pos: 0, rowIdx: this._guesses.length };
        this.holdBusy();
        this._render();

        const tick = () => {
            this._revealTimer = null;

            this._revealState.pos++;
            this._render();

            if (this._revealState.pos >= 5) {
                const guess = this._revealState.guess;
                const result = this._revealState.result;
                this._revealState = null;
                this._guesses.push(guess);
                this._updateKeyState(guess, result);

                if (guess === this._answer) {
                    this._won = true;
                    this._gameOver = true;
                    this._message = `\x1B[92;1m恭喜！是 ${toFullwidth(this._answer)}${RESET}  ${BORDER}[n] 新遊戲  [q] 離開${RESET}`;
                    this._render();
                } else if (this._guesses.length >= 6) {
                    this._gameOver = true;
                    this._message = `\x1B[91m遊戲結束！答案是 ${toFullwidth(this._answer)}${RESET}  ${BORDER}[n] 新遊戲  [q] 離開${RESET}`;
                    this._render();
                } else {
                    this._render();
                }

                this.releaseBusy();
                return;
            }

            this._revealTimer = setTimeout(tick, 100);
        };

        this._revealTimer = setTimeout(tick, 100);
    }

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A' || s === '\x1B[B') return;
            if (s === '\x1B[C' || s === '\x1B[D') return;
            if (s === '\x1B[3~' || s === '\x1B[2~') return;
            if (s === '\x1B[H' || s === '\x1B[F') return;
            if (s === '\x1B[5~' || s === '\x1B[6~') return;
            if (s === '\x1B' || data === 0x1B) this.close();
            return;
        }

        if (code === 0x03) { this.close(); return; }

        if (this._gameOver) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') this.close();
                if (ch === 'n') {
                    this._answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
                    this._guesses = [];
                    this._currentGuess = '';
                    this._gameOver = false;
                    this._won = false;
                    this._message = '';
                    this._keyState = {};
                    this._revealState = null;
                    this._render();
                }
            }
            return;
        }

        if (this._revealState) return;

        if (code === 0x08 || code === 0x7F) {
            if (this._currentGuess.length > 0) {
                this._currentGuess = this._currentGuess.slice(0, -1);
                this._message = '';
                this._render();
            }
            return;
        }

        if (code === 0x0D) {
            if (this._currentGuess.length !== 5) {
                this._message = '\x1B[91m少於 5 個字母';
                this._render();
                return;
            }
            if (!this._validWords) {
                this._message = this._wordsError ? '\x1B[91m字庫載入失敗' : '\x1B[91m字庫載入中…';
                this._render();
                return;
            }
            if (!this._validWords.has(this._currentGuess)) {
                this._message = '\x1B[91m不在字庫中';
                this._render();
                return;
            }

            const guess = this._currentGuess;
            const result = evaluateGuess(guess, this._answer);
            this._currentGuess = '';
            this._message = '';

            this._startReveal(guess, result);
            return;
        }

        if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
            if (this._currentGuess.length < 5) {
                this._currentGuess += String.fromCharCode(code).toLowerCase();
                this._message = '';
                this._render();
            }
            return;
        }
    }

    close() {
        if (this.closed) return;
        const revealing = !!this._revealState;
        this._cancelReveal();
        if (revealing) this.releaseBusy();
        this.placeShellCursor(KEYBOARD_Y + KEYBOARD_H);
        super.close();
    }

    static get commandName() { return 'wordle'; }
    static get help() { return 'Play Wordle — guess the 5-letter word'; }
    static get menu() { return 'Wordle'; }
    static get usage() { return 'wordle'; }
}
