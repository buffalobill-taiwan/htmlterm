import { term } from '../../../system/sys.js';
import { VirtualBuffer, _blankCell } from '../../../util/VirtualBuffer.js';
import { stackCardBuffer } from '../cards.js';

const xAt = i => 4 + 9 * i;
function paste(vb, face, x, y, bottom = 25) {
    for (let r = 0; r < face.height && y + r < bottom; r++) for (let c = 0; c < 5; c++) vb.setCell(y + r, x + c, face.getCell(r, c));
}
function style(game, zone, index, card = 0) {
    const selected = game.selected, cursor = game.cursor;
    if (selected?.zone === zone && selected.index === index && (zone !== 'column' || card >= selected.card)) return 2;
    return cursor.zone === zone && cursor.index === index && (zone !== 'column' || card === cursor.card) ? 1 : 0;
}
function empty(vb, x, y, label, focused) {
    const color = focused ? '\x1B[36m' : '\x1B[90m';
    vb.writeStr(y, x, color + '┌───┐\x1B[0m');
    vb.writeStr(y + 1, x, color + '│' + label + '│\x1B[0m');
    vb.writeStr(y + 2, x, color + '└───┘\x1B[0m');
}
export function drawBoard(game) {
    const vb = game.vb, state = game.state;
    for (let r = 0; r < 25; r++) for (let c = 0; c < 80; c++) vb.setCell(r, c, _blankCell);
    vb.centerRow(0, `\x1B[1;36mFreeCell 新接龍  #${game.seed}  步數 ${game.history.length}  收牌 ${state ? state.foundations.reduce((a,b)=>a+b,0) : 0}/52\x1B[0m`);
    if (state) {
        for (let i = 0; i < 8; i++) {
            const zone = i < 4 ? 'cell' : 'foundation', index = i % 4;
            const card = i < 4 ? state.cells[i] : state.foundations[index] ? index * 13 + state.foundations[index] - 1 : null;
            vb.writeStr(1, xAt(i), i < 4 ? '空格' : '收牌');
            if (card === null) empty(vb, xAt(i), 2, i < 4 ? ' · ' : ' ' + '♠♥♦♣'[index] + ' ', style(game, zone, index));
            else paste(vb, stackCardBuffer(card, false, style(game, zone, index)), xAt(i), 2);
            const col = state.columns[i];
            game.scroll[i] = Math.max(0, Math.min(game.scroll[i], Math.max(0, col.length - 14)));
            const start = game.scroll[i];
            vb.writeStr(5, xAt(i) + 2, String(i + 1));
            if (!col.length) empty(vb, xAt(i), 6, '   ', style(game, 'column', i));
            for (let j = start; j < col.length && 6 + j - start < 22; j++)
                paste(vb, stackCardBuffer(col[j], j < col.length - 1, style(game, 'column', i, j)), xAt(i), 6 + j - start, 22);
            if (start) vb.writeStr(6, xAt(i) + 6, '↑');
            if (col.length - start + 2 > 16) vb.writeStr(21, xAt(i) + 6, '↓');
        }
    }
    vb.centerRow(22, game.status);
    vb.centerRow(23, '方向鍵 移動  Enter 選牌/放牌  Space 取消  U 悔棋  Home/End 首末牌');
    vb.centerRow(24, '滑鼠 拖曳  PgUp/PgDn 翻頁  R 重玩  N 新局  M 選單  Q/Esc 離開');
    // Keep main-screen updates local to changed rows (drag ghost is independent).
    game.rows ??= Array.from({ length: 25 }, () => new VirtualBuffer(80, 1));
    for (let r = 0; r < 25; r++) {
        const row = game.rows[r]; let changed = false;
        for (let c = 0; c < 80; c++) {
            const next = vb.getCell(r, c), old = row.getCell(0, c);
            if (!old || next.ch !== old.ch || next.fg !== old.fg || next.bg !== old.bg || next.bold !== old.bold || next.width !== old.width) changed = true;
            row.setCell(0, c, next);
        }
        if (changed) term.writeVB(row, 0, r);
    }
}
export function hitTest(game, x, y) {
    if (x < 0 || x >= 80 || y < 2 || y >= 22) return null;
    for (let i = 0; i < 8; i++) {
        if (x === xAt(i) + 6 && (y === 6 || y === 21)) return { zone: 'column', index: i, scroll: y === 6 ? -1 : 1 };
        if (x < xAt(i) || x >= xAt(i) + 5) continue;
        if (y <= 4) return { zone: i < 4 ? 'cell' : 'foundation', index: i % 4, card: 0 };
        if (y < 6) return null;
        const col = game.state.columns[i];
        // Blank space below a pile remains a useful drop target.
        return { zone: 'column', index: i, card: Math.max(0, Math.min(col.length - 1, game.scroll[i] + y - 6)), emptyArea: y >= 6 + Math.max(3, col.length - game.scroll[i] + 2) };
    }
    return null;
}
export function drawGhost(cards) {
    const vb = new VirtualBuffer(5, cards.length + 2);
    cards.forEach((c, i) => paste(vb, stackCardBuffer(c, i < cards.length - 1, 2), 0, i));
    return vb;
}
