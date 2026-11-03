import { applyMove, fits, clone, auto, suit, rank } from './engine.js';

// Locations include a zero-based card offset when selecting a tableau suffix.
export function selectedCards(state, from) {
    if (from.zone === 'cell') return state.cells[from.index] == null ? [] : [state.cells[from.index]];
    if (from.zone === 'foundation') return state.foundations[from.index] > 0 ? [from.index * 13 + state.foundations[from.index] - 1] : [];
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
function moveError(state, from, to) {
    if (!from || !to || !['column', 'cell', 'foundation'].includes(to.zone) ||
        !Number.isInteger(to.index) || to.index < 0 || to.index >= (to.zone === 'column' ? 8 : 4)) return '無效的目的地';
    if (from.zone === to.zone && from.index === to.index) return '請選擇不同的位置';
    const cards = selectedCards(state, from);
    if (!cards.length) return '請選擇紅黑交錯、由大到小的連續牌列';
    if (cards.length === 1) {
        const card = cards[0];
        if (to.zone === 'cell' && state.cells[to.index] !== null) return '此處不能放置這張牌';
        if (to.zone === 'foundation' &&
            (suit(card) !== to.index || rank(card) !== state.foundations[to.index] + 1)) return '此處不能放置這張牌';
        if (to.zone === 'column' && !fits(card, state.columns[to.index].at(-1))) return '此處不能放置這張牌';
        return null;
    }
    if (to.zone !== 'column') return '空格與收牌區每次只能放一張牌';
    if (!fits(cards[0], state.columns[to.index].at(-1))) return '牌列須紅黑交錯、由大到小排列';
    if (cards.length > capacity(state, to)) return '空格與空欄不足，無法移動這麼多張牌';
    return null;
}
export function canMove(state, from, to) {
    return moveError(state, from, to) === null;
}
// Double-click shortcut: foundation if legal, otherwise the first empty free cell.
export function quickMoveTo(state, from) {
    const cards = selectedCards(state, from);
    if (cards.length !== 1) return null;
    const card = cards[0];
    if (rank(card) === state.foundations[suit(card)] + 1)
        return { zone: 'foundation', index: suit(card) };
    if (from.zone === 'cell') return null;
    const index = state.cells.findIndex(c => c === null);
    return index < 0 ? null : { zone: 'cell', index };
}
// Transactional: failed moves never change the input. Auto moves belong to the
// same transaction, so a single undo restores the entire previous position.
export function moveCards(state, from, to, collect = true) {
    const error = moveError(state, from, to);
    if (error) throw Error(error);
    const cards = selectedCards(state, from);
    const next = clone(state);
    if (cards.length === 1) {
        try { applyMove(next, { from, to }); } catch { throw Error('此處不能放置這張牌'); }
    } else {
        next.columns[from.index].splice(from.card);
        next.columns[to.index].push(...cards);
    }
    // The UI defers collection so each automatic move can be animated.
    if (collect) auto(next);
    return next;
}
