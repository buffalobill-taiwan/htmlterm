import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { CURSOR_HIDE } from '../util/sgr.js';
import { bufWidth } from '../util/display-width.js';
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

const TITLE_ROW = 1;
const GRID_START = 2;
const MSG_ROW = 15;
const KEYBOARD_Y = 17;
const COL = 33;

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
        this._render();
    }

    _render() {
        let out = '\x1B[2J\x1B[H' +
            `\x1B[${TITLE_ROW};35H\x1B[1m\x1B[33mＷＯＲＤＬＥ${RESET}` +
            `\x1B[${GRID_START};${COL}H${TOP_BORDER}`;

        for (let i = 0; i < 6; i++) {
            const contentY = GRID_START + 1 + i * 2;

            if (i < this._guesses.length) {
                out += `\x1B[${contentY};${COL}H`;
                const guess = this._guesses[i];
                const result = evaluateGuess(guess, this._answer);
                out += BORDER + '│' + RESET;
                for (let j = 0; j < 5; j++) {
                    const fw = toFullwidth(guess[j]);
                    out += colorCode(result[j]) + fw + RESET + BORDER + '│' + RESET;
                }
            } else if (this._revealState && i === this._revealState.rowIdx) {
                out += `\x1B[${contentY};${COL}H`;
                out += BORDER + '│' + RESET;
                for (let j = 0; j < 5; j++) {
                    const fw = toFullwidth(this._revealState.guess[j]);
                    if (j < this._revealState.pos) {
                        out += colorCode(this._revealState.result[j]) + fw + RESET;
                    } else {
                        out += '\x1B[97;44m' + fw + RESET;
                    }
                    out += BORDER + '│' + RESET;
                }
            } else if (!this._gameOver && i === this._guesses.length) {
                out += `\x1B[${contentY};${COL}H`;
                out += BORDER + '│' + RESET;
                for (let j = 0; j < 5; j++) {
                    if (j < this._currentGuess.length) {
                        const fw = toFullwidth(this._currentGuess[j]);
                        out += '\x1B[97;44m' + fw + RESET;
                    } else {
                        out += BORDER + '　' + RESET;
                    }
                    out += BORDER + '│' + RESET;
                }
            } else {
                out += `\x1B[${contentY};${COL}H${EMPTY_ROW}`;
            }

            const sepY = GRID_START + 2 + i * 2;
            out += `\x1B[${sepY};${COL}H` + (i < 5 ? SEP_BORDER : BOT_BORDER);
        }

        if (this._message) {
            const mw = bufWidth(this._message);
            const cx = Math.max(1, Math.floor((80 - mw) / 2) + 1);
            out += `\x1B[${MSG_ROW};${cx}H${this._message}${RESET}\x1B[K`;
        }

        for (let ri = 0; ri < KEY_ROWS.length; ri++) {
            const row = KEY_ROWS[ri];
            const w = row.length * 2;
            const cx = Math.floor((80 - w) / 2) + 1;
            const y = KEYBOARD_Y + ri;
            out += `\x1B[${y};${cx}H`;
            for (const ch of row) {
                const s = this._keyState[ch];
                const c = s === 'correct' ? '\x1B[97;42m' :
                          s === 'present' ? '\x1B[97;43m' :
                          s === 'absent' ? '\x1B[97;100m' : '\x1B[90m';
                out += c + toFullwidth(ch) + RESET;
            }
        }

        term.write(out);
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
                this._revealState = null;
                this._guesses.push(guess);

                if (guess === this._answer) {
                    this._won = true;
                    this._gameOver = true;
                    this._message = `\x1B[92;1m恭喜！是 ${toFullwidth(this._answer)}${RESET}  ${BORDER}[n] 新遊戲  [q] 離開${RESET}`;
                    this._render();
                } else if (this._guesses.length >= 6) {
                    this._gameOver = true;
                    this._message = `\x1B[91m遊戲結束！答案是 ${toFullwidth(this._answer)}${RESET}  ${BORDER}[n] 新遊戲  [q] 離開${RESET}`;
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
            this._updateKeyState(guess, result);
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
        term.write(`\x1B[20;1H`);
        super.close();
    }

    static get commandName() { return 'wordle'; }
    static get help() { return 'Play Wordle — guess the 5-letter word'; }
    static get menu() { return 'Wordle'; }
}
