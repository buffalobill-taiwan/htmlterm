import { createDeck } from '../deck.js';
import { shuffle } from '../../../util/random.js';
import { createPersonality } from './personality.js';
import { evaluate } from './evaluate.js';
export const BUY_IN = 1000, SMALL_BLIND = 5, BIG_BLIND = 10;
export const STREETS = ['翻牌前', '翻牌', '轉牌', '河牌'];
export function deck(rng = Math.random) {
    return shuffle(createDeck(), rng);
}
export function createTable(rng = Math.random) {
    return { players: Array.from({ length: 6 }, (_, id) => ({ id, number: id, stack: BUY_IN, ...(id ? { personality: createPersonality(rng) } : {}) })),
        nextComputer: 6,
        button: Math.floor(rng() * 6), hand: 0, phase: 'idle', actor: -1 };
}
const next = (s, seat) => (seat + 1) % s.players.length;
const live = s => s.players.filter(p => !p.folded);
const able = s => live(s).filter(p => p.stack > 0);
export const potSize = s => s.players.reduce((sum, p) => sum + p.total, 0);
function pay(p, amount) {
    const chips = Math.min(p.stack, amount);
    p.stack -= chips; p.bet += chips; p.total += chips;
}
export function startHand(s, rng = Math.random) {
    if (!['idle', 'result'].includes(s.phase) || s.players[0].stack === 0) return false;
    if (s.hand) s.button = next(s, s.button);
    s.hand++; s.street = 0; s.board = []; s.burned = []; s.deck = deck(rng);
    s.phase = 'betting'; s.currentBet = BIG_BLIND; s.lastRaise = BIG_BLIND;
    s.pots = []; s.refunds = []; s.showdown = false;
    for (const p of s.players) {
        if (p.id && p.stack === 0) {
            p.stack = BUY_IN; p.personality = createPersonality(rng);
            p.number = s.nextComputer++;
        }
        Object.assign(p, { hole: [], bet: 0, total: 0, folded: false, lastAct: null, action: '', won: 0 });
    }
    for (let round = 0; round < 2; round++)
        for (let n = 1; n <= s.players.length; n++) s.players[(s.button + n) % s.players.length].hole.push(s.deck.pop());
    s.sb = next(s, s.button); s.bb = next(s, s.sb);
    pay(s.players[s.sb], SMALL_BLIND); s.players[s.sb].action = '小盲';
    pay(s.players[s.bb], BIG_BLIND); s.players[s.bb].action = '大盲';
    chooseActor(s, s.bb);
    return true;
}
export function legalActions(s, seat = s.actor) {
    const p = s.players[seat];
    if (s.phase !== 'betting' || seat !== s.actor || !p || p.folded || !p.stack) return null;
    const call = Math.min(p.stack, Math.max(0, s.currentBet - p.bet));
    const max = p.bet + p.stack;
    const reopened = p.lastAct === null || s.currentBet - p.lastAct >= s.lastRaise;
    const raise = reopened && max > s.currentBet && able(s).some(q => q.id !== seat);
    const min = s.currentBet + s.lastRaise;
    return { call, min, max, raise, allIn: max <= s.currentBet || raise };
}
// lastAct records the bet faced after acting. Cumulative short all-ins reopen
// action only once a player faces a full raise (the last full increment).
export function act(s, action) {
    const p = s.players[s.actor], legal = legalActions(s);
    if (!legal || !action) return false;
    let type = action.type, to = action.to;
    if (type === 'allin') {
        if (!legal.allIn) return false;
        type = legal.max <= s.currentBet ? 'call' : 'raise'; to = legal.max;
    }
    if (type === 'raise' && (!legal.raise || !Number.isSafeInteger(to) || to > legal.max ||
        to <= s.currentBet || (to < legal.min && to !== legal.max))) return false;
    if (type === 'check' && legal.call) return false;
    if (!['fold', 'call', 'check', 'raise'].includes(type)) return false;
    if (type === 'fold') { p.folded = true; p.action = '棄牌'; }
    else if (type === 'raise') {
        const increment = to - s.currentBet;
        pay(p, to - p.bet);
        if (increment >= s.lastRaise) s.lastRaise = increment;
        s.currentBet = to; p.action = '加注至 ' + to;
    } else {
        pay(p, legal.call); p.action = legal.call ? '跟注 ' + legal.call : '過牌';
    }
    if (!p.folded && p.stack === 0) p.action = '全下 ' + p.bet;
    p.lastAct = s.currentBet;
    chooseActor(s, p.id);
    return true;
}
function chooseActor(s, after) {
    s.actor = -1;
    if (live(s).length === 1) { settle(s); return; }
    const active = able(s);
    for (let offset = 1; offset <= s.players.length; offset++) {
        const p = s.players[(after + offset) % s.players.length];
        if (p.folded || !p.stack) continue;
        // With no opponent able to bet, only an outstanding call needs action.
        if (p.bet < s.currentBet || (active.length > 1 && p.lastAct === null)) {
            s.actor = p.id; return;
        }
    }
    s.phase = 'between';
}
export function advanceStreet(s) {
    if (s.phase !== 'between') return false;
    if (s.street === 3) { settle(s); return true; }
    s.street++; s.burned.push(s.deck.pop());
    const count = s.street === 1 ? 3 : 1;
    for (let i = 0; i < count; i++) s.board.push(s.deck.pop());
    s.currentBet = 0; s.lastRaise = BIG_BLIND;
    for (const p of s.players) { p.bet = 0; p.lastAct = null; if (!p.folded && p.stack) p.action = ''; }
    s.phase = 'betting'; chooseActor(s, s.button);
    return true;
}
export function settle(s) {
    const contenders = live(s);
    s.showdown = contenders.length > 1;
    s.pots = []; s.refunds = [];
    // Uncalled excess is not a pot, and is returned even when a hand ends by folds.
    const byTotal = s.players.slice().sort((a, b) => b.total - a.total);
    const excess = byTotal[0].total - byTotal[1].total;
    if (excess > 0) {
        const p = byTotal[0]; p.total -= excess; p.stack += excess;
        p.bet = Math.max(0, p.bet - excess);
        s.refunds.push({ seat: p.id, amount: excess });
    }
    const values = new Map(contenders.map(p => [p.id, s.showdown ? evaluate([...p.hole, ...s.board]) : 0]));
    const levels = [...new Set(s.players.map(p => p.total).filter(Boolean))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
        const contributors = s.players.filter(p => p.total >= level);
        const amount = (level - previous) * contributors.length; previous = level;
        const eligible = contenders.filter(p => p.total >= level);
        const best = Math.max(...eligible.map(p => values.get(p.id)));
        const winners = eligible.filter(p => values.get(p.id) === best)
            .sort((a, b) => (a.id - s.button - 1 + s.players.length) % s.players.length -
                (b.id - s.button - 1 + s.players.length) % s.players.length);
        const share = Math.floor(amount / winners.length), remainder = amount % winners.length;
        const awards = winners.map((p, i) => {
            const chips = share + (i < remainder ? 1 : 0);
            p.stack += chips; p.won += chips;
            return { seat: p.id, amount: chips };
        });
        s.pots.push({ amount, awards, value: best });
    }
    s.phase = 'result'; s.actor = -1;
}
// An explicit allowlist is the boundary between hidden engine state and AI.
export function observation(s) {
    const p = s.players[s.actor];
    return { hole: p.hole.map(c => ({ ...c })), board: s.board.map(c => ({ ...c })),
        opponents: live(s).length - 1, pot: potSize(s), bet: p.bet,
        personality: p.personality ? { ...p.personality } : null,
        stack: p.stack, currentBet: s.currentBet, legal: legalActions(s) };
}
