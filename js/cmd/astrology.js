import astrologyData from '../data/astrology.json' with { type: 'json' };
import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { cyan, bold, green, yellow, white, red } from '../util/sgr.js';

const { zodiac: ZODIAC, categories: CATEGORIES, descriptions: DESCRIPTIONS } = astrologyData;

function _dayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
}

function _seededRand(day, idx) {
    let s = (day << 5) + idx * 7 + 42;
    return function () {
        s |= 0; s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function _fortune(signIdx) {
    const rng = _seededRand(_dayOfYear(), signIdx);
    return CATEGORIES.map((cat) => {
        const score = Math.floor(rng() * 5);
        const pool = DESCRIPTIONS[cat][score];
        const desc = pool[Math.floor(rng() * pool.length)];
        return { cat, score: score + 1, stars: '★'.repeat(score + 1) + '☆'.repeat(4 - score), desc };
    });
}

export class AstrologyCmd extends CmdBase {
    execute(args) {
        this.print('\r\n' + bold(cyan('=== 今日星座運勢 ===')) + '\r\n');
        this._pickSign();
    }

    _pickSign() {
        this.select({
            text: yellow('請選擇你的星座（方向鍵移動，Enter 確認，Esc 取消）') + '\r\n',
            options: [ZODIAC.slice(0, 4), ZODIAC.slice(4, 8), ZODIAC.slice(8, 12)],
            onPick: (row, col, value) => {
                term.write('\r\n\r\n');
                this.showFortune(row * 4 + col);
            },
        });
    }

    showFortune(signIdx) {
        const signName = ZODIAC[signIdx];
        const items = _fortune(signIdx);
        this.print(bold(yellow('==================================================')) + '\r\n');
        this.print(bold(cyan('            ' + signName + ' 今日運勢')) + '\r\n');
        this.print(bold(yellow('==================================================')) + '\r\n');
        for (const item of items) {
            const color = item.score >= 4 ? green : item.score >= 3 ? yellow : white;
            this.print('  ' + item.cat + '  ' + color(item.stars + '  ' + item.desc) + '\r\n');
        }
        this.print(bold(yellow('==================================================')) + '\r\n\r\n');

        this.printThen('', () => {
            this.close();
        });
    }

    onCancel() {
        term.write('\r\n' + red('^C 已取消') + '\r\n');
        this.close();
    }

    static get commandName() { return 'astrology'; }
    static get help() { return 'Today\'s horoscope for your zodiac sign'; }
    static get menu() { return 'Astrology Horoscope'; }
    static get usage() { return 'astrology'; }
}
