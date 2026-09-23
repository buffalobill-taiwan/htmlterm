import { term } from '../../system/sys.js';
import { CmdBase } from '../CmdBase.js';
import { CURSOR_HIDE, makeCell } from '../../util/sgr.js';
import { bufWidth } from '../../util/display-width.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { VALID_WORDS } from './valid-words.js';

const WORDS = [
    'about', 'above', 'abuse', 'acorn', 'acute', 'admit', 'adopt', 'adult', 'after',
    'again', 'agent', 'agree', 'ahead', 'aimed', 'alarm', 'album', 'alert', 'alien',
    'align', 'alive', 'alley', 'allow', 'alone', 'along', 'alter', 'among', 'ample',
    'angel', 'anger', 'angle', 'angry', 'apart', 'apple', 'apply', 'arena', 'argue',
    'arise', 'armor', 'array', 'aside', 'asset', 'avoid', 'award', 'aware', 'badly',
    'basic', 'basil', 'basin', 'basis', 'batch', 'beach', 'beast', 'begin', 'being',
    'below', 'bench', 'berry', 'bible', 'birth', 'black', 'blade', 'blame', 'blank',
    'blast', 'blaze', 'bleed', 'blend', 'bless', 'blind', 'block', 'blood', 'bloom',
    'blown', 'board', 'boast', 'bonus', 'booth', 'bound', 'brain', 'brand', 'brave',
    'bread', 'break', 'breed', 'brick', 'bride', 'brief', 'bring', 'brisk', 'broad',
    'broke', 'brown', 'brush', 'buddy', 'build', 'built', 'bunch', 'burst', 'cabin',
    'cable', 'candy', 'carry', 'catch', 'cause', 'cease', 'chain', 'chair', 'chalk',
    'chaos', 'charm', 'chart', 'chase', 'cheap', 'check', 'cheek', 'cheer', 'chess',
    'chest', 'chick', 'chief', 'child', 'chill', 'chunk', 'civic', 'civil', 'claim',
    'clash', 'class', 'clean', 'clear', 'clerk', 'click', 'climb', 'cling', 'clock',
    'close', 'cloth', 'cloud', 'clown', 'coach', 'coast', 'coral', 'couch', 'could',
    'count', 'court', 'cover', 'crack', 'craft', 'crane', 'crash', 'crawl', 'crazy',
    'cream', 'creek', 'crime', 'crisp', 'cross', 'crowd', 'crown', 'cruel', 'crush',
    'curve', 'cycle', 'daily', 'dairy', 'dance', 'death', 'decay', 'delay', 'delta',
    'dense', 'depth', 'devil', 'diary', 'dirty', 'doubt', 'dough', 'draft', 'drain',
    'drama', 'drank', 'drape', 'drawn', 'dread', 'dream', 'dress', 'dried', 'drift',
    'drill', 'drink', 'drive', 'drone', 'drove', 'drown', 'eagle', 'early', 'earth',
    'eight', 'elect', 'elite', 'email', 'empty', 'endow', 'enemy', 'enjoy', 'enter',
    'entry', 'equal', 'equip', 'error', 'essay', 'ethic', 'event', 'every', 'evict',
    'exact', 'exalt', 'exile', 'exist', 'extra', 'fable', 'facet', 'faint', 'fairy',
    'faith', 'false', 'fancy', 'fatal', 'fault', 'feast', 'fence', 'ferry', 'fetch',
    'fever', 'fiber', 'field', 'fifth', 'fifty', 'fight', 'final', 'first', 'fixed',
    'flame', 'flash', 'flesh', 'fleet', 'flick', 'flies', 'fling', 'float', 'flock',
    'flood', 'floor', 'flora', 'flour', 'fluid', 'flush', 'flute', 'focal', 'focus',
    'force', 'forge', 'forth', 'forum', 'fossil', 'found', 'frame', 'frank', 'fraud',
    'fresh', 'front', 'frost', 'fruit', 'fully', 'ghost', 'giant', 'given', 'glass',
    'gleam', 'globe', 'gloom', 'glory', 'gloss', 'glove', 'going', 'grace', 'grade',
    'grain', 'grand', 'grant', 'grape', 'graph', 'grasp', 'grass', 'grave', 'great',
    'greed', 'green', 'greet', 'grief', 'grill', 'grind', 'groan', 'groom', 'gross',
    'group', 'grove', 'growl', 'grown', 'guard', 'guess', 'guest', 'guide', 'guild',
    'guilt', 'happy', 'harsh', 'haste', 'haunt', 'haven', 'havoc', 'heart', 'heavy',
    'hedge', 'hello', 'hence', 'herbs', 'hobby', 'honey', 'horse', 'hotel', 'house',
    'hover', 'human', 'humor', 'hurry', 'ideal', 'image', 'imply', 'index', 'infer',
    'inner', 'input', 'issue', 'ivory', 'jacket', 'jelly', 'jewel', 'joint', 'joker',
    'judge', 'juice', 'karma', 'kayak', 'knock', 'label', 'labor', 'large', 'laser',
    'later', 'laugh', 'layer', 'learn', 'lease', 'least', 'leave', 'legal', 'lemon',
    'level', 'lever', 'light', 'limit', 'linen', 'liner', 'liver', 'local', 'logic',
    'loose', 'lover', 'lower', 'loyal', 'lucky', 'lunar', 'lunch', 'lyric', 'magic',
    'major', 'maker', 'manor', 'maple', 'march', 'match', 'mayor', 'media', 'mercy',
    'merge', 'merit', 'metal', 'meter', 'midst', 'might', 'minor', 'minus', 'mirth',
    'model', 'money', 'month', 'moral', 'motor', 'mount', 'mouse', 'mouth', 'movie',
    'music', 'naive', 'nerve', 'never', 'newly', 'night', 'noble', 'noise', 'north',
    'novel', 'nurse', 'occur', 'ocean', 'onset', 'opera', 'orbit', 'order', 'organ',
    'other', 'ought', 'outer', 'oxide', 'ozone', 'paint', 'panel', 'panic', 'paper',
    'party', 'paste', 'patch', 'pause', 'peace', 'peach', 'pearl', 'penny', 'phase',
    'phone', 'photo', 'piano', 'piece', 'pilot', 'pinch', 'pitch', 'pixel', 'pizza',
    'place', 'plain', 'plane', 'plant', 'plate', 'plaza', 'plead', 'pluck', 'plumb',
    'plume', 'plump', 'plus', 'poach', 'point', 'polar', 'pouch', 'pound', 'power',
    'press', 'price', 'pride', 'prime', 'print', 'prior', 'prize', 'probe', 'prone',
    'proof', 'prose', 'proud', 'prove', 'psalm', 'pulse', 'pupil', 'purse', 'quest',
    'queue', 'quick', 'quiet', 'quilt', 'quirk', 'quota', 'quote', 'radar', 'radio',
    'raise', 'rally', 'ranch', 'range', 'rapid', 'ratio', 'reach', 'react', 'ready',
    'realm', 'rebel', 'refer', 'reign', 'relax', 'relay', 'renew', 'repay', 'reply',
    'rider', 'ridge', 'rifle', 'right', 'rigid', 'rinse', 'rival', 'river', 'roast',
    'robin', 'robot', 'rocky', 'rouge', 'rough', 'round', 'route', 'rover', 'royal',
    'rugby', 'ruler', 'rural', 'sadly', 'saint', 'salad', 'sauce', 'scale', 'scare',
    'scene', 'scent', 'scope', 'score', 'scout', 'screw', 'seize', 'sense', 'serve',
    'setup', 'seven', 'shade', 'shaft', 'shake', 'shall', 'shame', 'shape', 'share',
    'shark', 'sharp', 'shave', 'shawl', 'sheer', 'sheet', 'shelf', 'shell', 'shift',
    'shine', 'shirt', 'shock', 'shore', 'short', 'shout', 'shove', 'shown', 'sight',
    'since', 'sixth', 'sixty', 'sized', 'skill', 'skull', 'slate', 'slave', 'sleep',
    'sleek', 'slice', 'slide', 'sling', 'slope', 'small', 'smart', 'smell', 'smile',
    'smith', 'smoke', 'snack', 'snake', 'solid', 'solve', 'sorry', 'sound', 'south',
    'space', 'spare', 'spark', 'speak', 'spear', 'speed', 'spell', 'spend', 'spice',
    'spike', 'spill', 'spine', 'split', 'spoke', 'spoon', 'sport', 'spray', 'squad',
    'stack', 'staff', 'stage', 'stain', 'stair', 'stake', 'stale', 'stalk', 'stall',
    'stamp', 'stand', 'stare', 'stark', 'start', 'state', 'steak', 'steal', 'steam',
    'steel', 'steep', 'steer', 'stern', 'stick', 'stiff', 'still', 'stock', 'stone',
    'stood', 'stool', 'store', 'storm', 'story', 'stove', 'stuff', 'style', 'sugar',
    'suite', 'super', 'surge', 'swamp', 'sweep', 'sweet', 'swift', 'swing', 'swirl',
    'sword', 'swore', 'sworn', 'syrup', 'table', 'taste', 'teach', 'terms', 'theme',
    'there', 'these', 'thick', 'thief', 'thing', 'think', 'third', 'thorn', 'those',
    'three', 'threw', 'throw', 'thumb', 'tiger', 'tight', 'timer', 'title', 'toast',
    'today', 'token', 'total', 'touch', 'tough', 'towel', 'tower', 'toxic', 'trace',
    'track', 'trade', 'trail', 'train', 'trait', 'trash', 'treat', 'trend', 'trial',
    'tribe', 'trick', 'tried', 'troop', 'truck', 'truly', 'trunk', 'trust', 'truth',
    'tumor', 'twin', 'twist', 'ultra', 'uncle', 'under', 'union', 'unit', 'unity',
    'until', 'upper', 'upset', 'urban', 'usage', 'usual', 'utter', 'valid', 'value',
    'valve', 'vapor', 'vault', 'venue', 'verse', 'video', 'vigor', 'viral', 'visit',
    'vista', 'vital', 'vivid', 'vocal', 'voice', 'voter', 'vowel', 'waist', 'waste',
    'watch', 'water', 'weary', 'weave', 'wedge', 'weigh', 'weird', 'whale', 'wheat',
    'wheel', 'where', 'which', 'while', 'white', 'whole', 'whose', 'widen', 'width',
    'witch', 'woman', 'world', 'worry', 'worse', 'worst', 'worth', 'would', 'wound',
    'wreck', 'write', 'wrong', 'yacht', 'yield', 'young', 'youth',
];

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
        this._answer = WORDS[Math.floor(Math.random() * WORDS.length)];
        this._guesses = [];
        this._currentGuess = '';
        this._gameOver = false;
        this._won = false;
        this._message = '';
        this._keyState = {};
        this._revealState = null;

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

    _startReveal(guess, result) {
        this._revealState = { guess, result, pos: 0, rowIdx: this._guesses.length };
        this.holdBusy();
        this._render();

        const tick = () => {
            if (this.closed) {
                if (this._revealState) this._revealState = null;
                this.releaseBusy();
                return;
            }

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

            setTimeout(tick, 100);
        };

        setTimeout(tick, 100);
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
            this.close();
            return;
        }

        if (code === 0x03) { this.close(); return; }

        if (this._gameOver) {
            if (typeof data === 'string') {
                const ch = data.toLowerCase();
                if (ch === 'q') this.close();
                if (ch === 'n') {
                    this._answer = WORDS[Math.floor(Math.random() * WORDS.length)];
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
            if (!VALID_WORDS.includes(this._currentGuess)) {
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
        this.closed = true;
        if (this._revealState) {
            this._revealState = null;
            this.releaseBusy();
        }
        this.placeShellCursor(KEYBOARD_Y + KEYBOARD_H);
        super.close();
    }

    static get commandName() { return 'wordle'; }
    static get help() { return 'Play Wordle — guess the 5-letter word'; }
    static get menu() { return 'Wordle'; }
    static get usage() { return 'wordle'; }
}
