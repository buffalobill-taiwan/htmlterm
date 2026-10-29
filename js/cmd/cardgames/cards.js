import { VirtualBuffer } from '../../util/VirtualBuffer.js';
const ranks = ['', 'Ａ', '２', '３', '４', '５', '６', '７', '８', '９', '10', 'Ｊ', 'Ｑ', 'Ｋ'];
const faces = new Map();
// Shared 5×3 card artwork. Null is a card back; rank 0 is a joker.
export function cardBuffer(card) {
    const key = card ? `${card.suit}:${card.rank}` : 'back';
    if (!faces.has(key)) {
        const vb = new VirtualBuffer(5, 3);
        const red = card && (card.suit === 1 || card.suit === 2);
        const text = !card ? '░░░' : card.rank === 0 ? ' 〠' : '♠♥♦♣'[card.suit] + ranks[card.rank];
        vb.writeStr(0, 0, '\x1B[30;47m┌───┐');
        vb.writeStr(1, 0, '\x1B[30;47m│' + (red ? '\x1B[31m' : '\x1B[30m') + text + '\x1B[30m│');
        vb.writeStr(2, 0, '\x1B[30;47m└───┘');
        faces.set(key, vb);
    }
    return faces.get(key);
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
