import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { cardFromId, RANKS, SUITS } from './deck.js';
const faces = new Map();
// Shared 5×3 card artwork. Null is a card back; rank 0 is a joker.
export function cardBuffer(card) {
    const key = card ? `${card.suit}:${card.rank}` : 'back';
    if (!faces.has(key)) {
        const vb = new VirtualBuffer(5, 3);
        const red = card && (card.suit === 1 || card.suit === 2);
        const text = !card ? '░░░' : card.rank === 0 ? ' 〠' : SUITS[card.suit] + RANKS[card.rank];
        vb.writeStr(0, 0, '\x1B[30;47m┌───┐');
        vb.writeStr(1, 0, '\x1B[30;47m│' + (red ? '\x1B[31m' : '\x1B[30m') + text + '\x1B[30m│');
        vb.writeStr(2, 0, '\x1B[30;47m└───┘');
        faces.set(key, vb);
    }
    return faces.get(key);
}

const variants = new WeakMap();
// Per-face cached recolours (muted/folded, same-suit, hit). Cells stay immutable.
export function cardBufferVariant(base, key, transform) {
    let cache = variants.get(base);
    if (!cache) variants.set(base, cache = new Map());
    if (!cache.has(key)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++)
            for (let x = 0; x < base.width; x++) vb.setCell(y, x, base.getCell(y, x));
        transform(vb);
        cache.set(key, vb);
    }
    return cache.get(key);
}

export function mutedCardBuffer(base) {
    return cardBufferVariant(base, 'muted', vb => {
        for (let y = 0; y < vb.height; y++) for (let x = 0; x < vb.width; x++)
            vb.setCell(y, x, { ...vb.getCell(y, x), bg: 8 });
    });
}

// Copy a whole card face onto another buffer at local coordinates.
export function stampCard(vb, face, x, y) {
    for (let r = 0; r < face.height; r++)
        for (let c = 0; c < face.width; c++) vb.setCell(y + r, x + c, face.getCell(r, c));
}

// Top card plus the exposed bottom borders of the cards underneath it.
export function drawCardStack(vb, face, x, y, edges = 3) {
    stampCard(vb, face, x, y);
    for (let i = 1; i <= edges; i++)
        for (let c = 0; c < face.width; c++) vb.setCell(y + 2 + i, x + c, face.getCell(2, c));
}

const flips = new Map();
// Cell-width slices let a wide rank reveal one column at a time, like Memory.
export function cardFlipFrames(card) {
    const key = `${card.suit}:${card.rank}`;
    if (!flips.has(key)) {
        const face = cardBuffer(card), back = cardBuffer(null);
        const slices = [];
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 5; c++) {
                const cell = face.getCell(r, c);
                if (cell.width === 2) {
                    slices.push({ ...cell, width: 1, clip: true, clipScale: 1, clipOffX: 0, clipOffY: 0 });
                } else if (cell.width === 0) {
                    slices.push({ ...face.getCell(r, c - 1), width: 1, clip: true, clipScale: 1, clipOffX: -1, clipOffY: 0 });
                } else slices.push(cell);
            }
        }
        flips.set(key, Array.from({ length: 6 }, (_, progress) => {
            const vb = new VirtualBuffer(5, 3);
            for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++)
                vb.setCell(r, c, c < progress ? slices[r * 5 + c] : back.getCell(r, c));
            return vb;
        }));
    }
    return flips.get(key);
}

const stacks = new Map();
// A covered card keeps its suit/rank in the top border. Cache every appearance
// so cursor movement and dragging only copy immutable cells.
export function stackCardBuffer(id, header = false, style = 0) {
    const key = `${id}:${header}:${style}`;
    if (!stacks.has(key)) {
        const card = id === null ? null : cardFromId(id);
        const base = cardBuffer(card), vb = new VirtualBuffer(5, header ? 1 : 3);
        if (header && card) {
            const color = card.suit === 1 || card.suit === 2 ? 31 : 30;
            vb.writeStr(0, 0, `\x1B[30;47m┌\x1B[${color}m${SUITS[card.suit]}${RANKS[card.rank]}\x1B[30m┐`);
        } else for (let r = 0; r < vb.height; r++) for (let c = 0; c < 5; c++) vb.setCell(r, c, base.getCell(r, c));
        if (style) for (let r = 0; r < vb.height; r++) for (let c = 0; c < 5; c++) {
            const cell = vb.getCell(r, c);
            vb.setCell(r, c, { ...cell, bg: style === 2 ? 3 : 6 });
        }
        stacks.set(key, vb);
    }
    return stacks.get(key);
}
