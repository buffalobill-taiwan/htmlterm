import { CmdBase } from './CmdBase.js';
import { cyan, bold, green, yellow, white, red } from '../sgr.js';

const ZODIAC = [
    '牡羊座', '金牛座', '雙子座', '巨蟹座',
    '獅子座', '處女座', '天秤座', '天蠍座',
    '射手座', '摩羯座', '水瓶座', '雙魚座',
];

const CATEGORIES = ['財運運勢', '戀愛運勢', '事業運勢', '人際運勢', '學習運勢'];

const DESCRIPTIONS = {
    '財運運勢': [
        ['財運低迷，開支較大，謹慎理財', '錢財流失較快，避免衝動消費', '財星不顯，宜守不宜攻'],
        ['財運偏弱，收支勉強平衡', '財來財去，難以積蓄', '投資時機未到，靜待佳期'],
        ['財運平穩，小有進賬', '正財穩定，偏財零星', '收支平衡，略有盈餘'],
        ['財運不錯，投資有機會獲利', '財星高照，把握良機', '正偏財皆有進展，可喜可賀'],
        ['財運亨通，正偏財皆旺', '財源廣進，收穫豐碩', '投資眼光精準，獲利可期'],
    ],
    '戀愛運勢': [
        ['感情多變，容易產生誤會', '桃花不顯，專注自我提升', '關係緊張，需要冷靜溝通'],
        ['感情平淡，需要用心經營', '桃花運一般，隨緣即可', '感情無太大波瀾，平穩度日'],
        ['感情穩定，互動良好', '與伴侶相處融洽', '單身者有機會結識新朋友'],
        ['桃花運佳，有機會遇到心動對象', '感情升溫，關係更進一步', '魅力提升，吸引他人目光'],
        ['愛情甜蜜，關係更進一步', '天賜良緣，幸福美滿', '感情如魚得水，令人羨慕'],
    ],
    '事業運勢': [
        ['事業受阻，做事容易碰壁', '工作進度遲緩，需加倍努力', '職場壓力較大，注意調適'],
        ['事業停滯，需要耐心等待', '工作量增加但回報有限', '事業運平平，按部就班即可'],
        ['事業平順，按部就班完成任務', '工作表現穩定，獲得肯定', '事業發展平穩，無大起大落'],
        ['事業上升，表現獲得肯定', '工作順遂，有望升遷', '貴人相助，事業更上一層樓'],
        ['事業高峰，貴人相助大有可為', '事業運勢強盛，一展抱負', '嶄露頭角，前程似錦'],
    ],
    '人際運勢': [
        ['人際關係緊張，容易與人發生摩擦', '溝通不順，注意言行舉止', '社交場合易有誤會'],
        ['社交運較弱，適合獨處', '人際互動平淡，不必強求', '周遭小人較多，謹言慎行'],
        ['人際和諧，與他人相處融洽', '社交場合表現得體', '朋友關係穩定，互信互助'],
        ['人氣上升，得到他人幫助', '結識新朋友，拓展人脈', '受人信賴，樂於助人'],
        ['貴人運強，備受歡迎與信賴', '人際關係圓滿，眾望所歸', '社交運極佳，左右逢源'],
    ],
    '學習運勢': [
        ['學習效率低落，難以集中注意力', '理解力下降，需要調整作息', '學習進度緩慢，勿操之過急'],
        ['學習動力不足，需要調整狀態', '學習效果普通，持之以恆', '吸收新知較慢，多加複習'],
        ['學習平穩，按計劃進行即可', '學習狀況良好，循序漸進', '理解力不錯，持續努力'],
        ['學習力強，舉一反三', '學習效率高，事半功倍', '新知識掌握迅速，表現優異'],
        ['學習運極佳，事半功倍效果顯著', '悟性極高，融會貫通', '學習成果豐碩，大有所獲'],
    ],
};

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
        this.open();
        this.print('\r\n' + bold(cyan('=== 今日星座運勢 ===')) + '\r\n');
        this._pickSign();
    }

    _pickSign() {
        this.select({
            text: yellow('請選擇你的星座（方向鍵移動，Enter 確認，Esc 取消）') + '\r\n',
            options: [
                ['牡羊座', '金牛座', '雙子座', '巨蟹座'],
                ['獅子座', '處女座', '天秤座', '天蠍座'],
                ['射手座', '摩羯座', '水瓶座', '雙魚座'],
            ],
            onPick: (row, col, value) => {
                this.term.write('\r\n\r\n');
                this.showFortune(row * 4 + col);
            },
        });
    }

    showFortune(signIdx) {
        const signName = ZODIAC[signIdx];
        const items = _fortune(signIdx);
        this.isTyping = true;

        this.print(bold(yellow('==================================================')) + '\r\n');
        this.print(bold(cyan('            ' + signName + ' 今日運勢')) + '\r\n');
        this.print(bold(yellow('==================================================')) + '\r\n');
        for (const item of items) {
            const color = item.score >= 4 ? green : item.score >= 3 ? yellow : white;
            this.print('  ' + item.cat + '  ' + color(item.stars + '  ' + item.desc) + '\r\n');
        }
        this.print(bold(yellow('==================================================')) + '\r\n\r\n');

        this.printThen('', () => {
            this.isTyping = false;
            this.close();
        });
    }

    onCancel() {
        this.term.write('\r\n' + red('^C 已取消') + '\r\n');
        this.close();
    }

    static get commandName() { return 'astrology'; }
    static get help() { return 'Today\'s horoscope for your zodiac sign'; }
    static get menu() { return 'Astrology Horoscope'; }
}
