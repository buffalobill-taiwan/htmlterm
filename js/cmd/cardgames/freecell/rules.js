import { applyMove, fits, clone, auto } from './engine.js';

// Locations include a zero-based card offset when selecting a tableau suffix.
export function selectedCards(state, from) {
    if (from.zone === 'cell') return state.cells[from.index] == null ? [] : [state.cells[from.index]];
    if (from.zone !== 'column') return [];
    const col = state.columns[from.index];
    if (!col || !Number.isInteger(from.card) || from.card < 0 || from.card >= col.length) return [];
    const cards = col.slice(from.card);
    return cards.every((c, i) => !i || fits(c, cards[i - 1])) ? cards : [];
}
export function capacity(state, to) {
    const empty = state.columns.filter((c, i) => !c.length && !(to.zone === 'column' && to.index === i)).length;
    return (state.cells.filter(c => c === null).length + 1) * 2 ** empty;
}
// Transactional: failed moves never change the input. Auto moves belong to the
// same transaction, so a single undo restores the entire previous position.
export function moveCards(state, from, to) {
    if (!to || !['column', 'cell', 'foundation'].includes(to.zone) || !Number.isInteger(to.index) || to.index < 0 || to.index >= (to.zone === 'column' ? 8 : 4)) throw Error('無效的目的地');
    if (from.zone === to.zone && from.index === to.index) throw Error('請選擇不同的位置');
    const cards = selectedCards(state, from);
    if (!cards.length) throw Error('請選擇紅黑交錯、由大到小的連續牌列');
    const next = clone(state);
    if (cards.length === 1) {
        try { applyMove(next, { from, to }); } catch { throw Error('此處不能放置這張牌'); }
    } else {
        if (to.zone !== 'column') throw Error('空格與收牌區每次只能放一張牌');
        if (!fits(cards[0], next.columns[to.index].at(-1))) throw Error('牌列須紅黑交錯、由大到小排列');
        if (cards.length > capacity(state, to)) throw Error('空格與空欄不足，無法移動這麼多張牌');
        next.columns[from.index].splice(from.card);
        next.columns[to.index].push(...cards);
    }
    auto(next);
    return next;
}
