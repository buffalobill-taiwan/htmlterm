export const SUIT_ORDER = { man: 0, pin: 1, sou: 2, honor: 3 };

const NUM_CHARS = '一二三四五六七八九';
const SUIT_CHARS = { man: '萬', pin: '筒', sou: '索' };
const HONOR_CHARS = ['東', '南', '西', '北', '白', '發', '中'];

const NAME_MAP = {
    man:   ['一萬', '二萬', '三萬', '四萬', '五萬', '六萬', '七萬', '八萬', '九萬'],
    pin:   ['一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒'],
    sou:   ['一索', '二索', '三索', '四索', '五索', '六索', '七索', '八索', '九索'],
    honor: ['東', '南', '西', '北', '白', '發', '中'],
};

export class Tile {
    constructor(suit, value) {
        this.suit = suit;
        this.value = value;
    }

    get name() {
        return NAME_MAP[this.suit][this.value - 1];
    }

    get displayTop() {
        if (this.suit === 'honor') return HONOR_CHARS[this.value - 1];
        return NUM_CHARS[this.value - 1];
    }

    get displayBottom() {
        if (this.suit === 'honor') return '　　';
        return SUIT_CHARS[this.suit];
    }

    get displayHorizontal() {
        if (this.suit === 'honor') return HONOR_CHARS[this.value - 1] + '  ';
        return NUM_CHARS[this.value - 1] + SUIT_CHARS[this.suit];
    }

    get isTerminal() {
        if (this.suit === 'honor') return true;
        return this.value === 1 || this.value === 9;
    }

    get isHonor() {
        return this.suit === 'honor';
    }

    get isSangen() {
        return this.isHonor && this.value >= 5;
    }

    get isWind() {
        return this.isHonor && this.value <= 4;
    }

    equals(other) {
        return other && this.suit === other.suit && this.value === other.value;
    }

    toString() {
        return this.suit[0] + this.value;
    }

    key() {
        return this.suit + this.value;
    }

    static fromString(str) {
        const val = parseInt(str[str.length - 1]);
        if (isNaN(val)) return null;
        const suitStr = str.slice(0, -1);
        const suit = ({ m: 'man', p: 'pin', s: 'sou', z: 'honor' })[suitStr]
                 || ({ man: 'man', pin: 'pin', sou: 'sou', honor: 'honor' })[suitStr];
        if (!suit) return null;
        if (suit === 'honor' && (val < 1 || val > 7)) return null;
        if (suit !== 'honor' && (val < 1 || val > 9)) return null;
        return new Tile(suit, val);
    }

    static allTiles() {
        const tiles = [];
        for (const suit of ['man', 'pin', 'sou']) {
            for (let v = 1; v <= 9; v++) {
                for (let c = 0; c < 4; c++) tiles.push(new Tile(suit, v));
            }
        }
        for (let v = 1; v <= 7; v++) {
            for (let c = 0; c < 4; c++) tiles.push(new Tile('honor', v));
        }
        return tiles;
    }

    static sortTiles(tiles) {
        return tiles.slice().sort((a, b) => {
            const sa = SUIT_ORDER[a.suit];
            const sb = SUIT_ORDER[b.suit];
            if (sa !== sb) return sa - sb;
            return a.value - b.value;
        });
    }

    static countMap(tiles) {
        const map = {};
        for (const t of tiles) {
            const k = t.key();
            map[k] = (map[k] || 0) + 1;
        }
        return map;
    }
}

export function tileFg(suit, value) {
    if (suit === 'honor') return value <= 4 ? 3 : 5;
    return { man: 1, pin: 6, sou: 2 }[suit];
}
