import { term } from '../../../system/sys.js';
import { makeOverlayGetCell } from '../../../util/sgr.js';
import { buildCallEffectBuffer } from '../../../util/call-effect.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { InputDialog } from '../../../dialog/InputDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { createTable, startHand, act, advanceStreet, legalActions, observation, BUY_IN } from './rules.js';
import { evaluate, handName } from './evaluate.js';
import { HoldemView, resultText, DECK, seatName } from './view.js';
import { dealCard } from '../animation.js';
const EFFECT_BUFFERS = new Map();

export class HoldemGame {
    constructor(cmd) {
        this.cmd = cmd;
        this.state = createTable(); this.view = new HoldemView();
        this.actions = []; this.choice = 0; this.request = 0;
        this.anims = new Set(); this.dealing = false; this.revealed = null;
        this.showdownDone = false; this.showdownShown = null;
        this.showdownOrder = []; this.showdownIndex = 0;
        this.showdownRevealing = false;
        this.dealingHole = false; this.dealtHole = null;
    }
    start() { this.nextHand(); }
    nextHand() {
        if (this.disposed) return;
        this.dealing = false; this.revealed = null;
        this.showdownDone = false; this.showdownShown = null;
        this.showdownOrder = []; this.showdownIndex = 0;
        this.showdownRevealing = false;
        this.dealingHole = false; this.dealtHole = null;
        if (this.state.players[0].stack === 0) {
            this.dialog = this.cmd.openDialog(SelectDialog, 'holdem-rebuy', {
                title: '籌碼用完了', options: ['補碼 1,000', '離桌'],
                onSelect: index => {
                    this.dialog = null;
                    if (index) this.cmd._menu();
                    else { this.state.players[0].stack = BUY_IN; this.nextHand(); }
                }, onCancel: () => { this.dialog = null; this.cmd._menu(); },
                onAbort: () => this.cmd._quit(),
            });
            return;
        }
        if (startHand(this.state)) { this.status = ''; this.dealHole(); }
    }
    later(fn, ms) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; if (!this.disposed) fn(); }, ms);
    }
    pump() {
        if (this.disposed) return;
        this.choice = 0; this.actions = []; this.status = '';
        const s = this.state;
        if (s.phase === 'result') {
            // Show each live hand in turn, starting after the player, before
            // the result text appears. The player is announced last.
            if (s.showdown && !this.showdownDone) { this.startShowdown(); return; }
            this.status = s.pots.length > 1 ? '多個底池已結算；R 查看各池得主' :
                s.pots[0].awards.map(a => `${a.seat ? '電腦 ' + a.seat : '你'} +${a.amount}`).join('  ') +
                (s.showdown ? '（' + handName(s.pots[0].value) + '）' : '（其他玩家棄牌）');
            this.view.draw(this);
            if (s.pots.length > 1) this.showResult();
            return;
        }
        if (s.phase === 'between') {
            this.view.draw(this);
            this.later(() => this.dealStreet(), 650);
            return;
        }
        if (s.actor === 0) {
            const l = legalActions(s);
            this.actions = [{ label: '棄牌', type: 'fold' },
                { label: l.call ? '跟注 ' + l.call : '過牌', type: l.call ? 'call' : 'check' }];
            if (l.raise && l.max >= l.min) this.actions.push({ label: s.currentBet ? '加注' : '下注', type: 'raise' });
            if (l.allIn) this.actions.push({ label: '全下 ' + s.players[0].stack, type: 'allin' });
            this.choice = 1;
            this.status = '輪到你'; this.view.draw(this); return;
        }
        this.view.draw(this);
        this.think();
    }
    // Advance the street, then send each new board card flying from the deck.
    // The next card launches as soon as this one is two columns clear, so the
    // flop leaves the deck as a continuous stream rather than card by card.
    dealStreet() {
        if (this.disposed) return;
        const s = this.state, from = s.board.length;
        advanceStreet(s);
        if (s.phase === 'result' || s.board.length === from) { this.pump(); return; }
        const added = s.board.length - from;
        let next = from, landed = 0;
        this.dealing = true;
        this.revealed = s.board.map((_, i) => i < from);
        this.status = '發牌中…';
        this.view.draw(this);
        const launch = () => {
            if (this.disposed || next >= s.board.length) return;
            const index = next++;
            let launchedNext = false;
            const cancel = dealCard(this.cmd, s.board[index], DECK, { x: 25 + index * 6, y: 11 }, {
                onStep: step => {
                    if (!launchedNext && step >= 2) { launchedNext = true; launch(); }
                },
            }, () => {
                this.anims.delete(cancel);
                this.revealed[index] = true;
                this.view.draw(this);
                if (++landed === added) {
                    this.dealing = false; this.revealed = null;
                    this.view.draw(this);
                    this.pump();
                }
            });
            this.anims.add(cancel);
        };
        launch();
    }
    // Deal 2 hole cards to each player sequentially in standard poker order:
    // 2 rounds starting from the small blind (button + 1) to the button.
    // Opponent cards land face down; player cards land and flip open.
    dealHole() {
        if (this.disposed) return;
        const s = this.state;
        this.dealing = true;
        this.dealingHole = true;
        this.dealtHole = new Set();
        this.status = '發牌中…';
        this.view.draw(this);

        const deals = [];
        for (let round = 0; round < 2; round++) {
            for (let i = 1; i <= s.players.length; i++) {
                deals.push({ seat: (s.button + i) % s.players.length, round });
            }
        }

        let nextDeal = 0, landed = 0;
        const launch = () => {
            if (this.disposed || !this.dealingHole || nextDeal >= deals.length) return;
            const { seat, round } = deals[nextDeal++];
            const isPlayer = seat === 0;
            const card = s.players[seat].hole[round];
            const to = isPlayer ?
                { x: round === 0 ? 34 : 40, y: 16 } :
                { x: 1 + (seat - 1) * 16 + 1 + round * 6, y: 5 };
            let launchedNext = false;
            const maybeNext = ratio => {
                if (!launchedNext && (ratio >= 0.45 || nextDeal === deals.length)) {
                    launchedNext = true;
                    launch();
                }
            };
            const cancel = dealCard(this.cmd, card, DECK, to, {
                faceDown: !isPlayer,
                duration: 180,
                flipDuration: 180,
                onStep: (_step, ratio) => maybeNext(ratio),
            }, () => {
                this.anims.delete(cancel);
                if (this.disposed || !this.dealingHole) return;
                maybeNext(1);
                this.dealtHole.add(seat * 2 + round);
                this.view.draw(this);
                if (++landed === deals.length) {
                    this.dealing = false;
                    this.dealingHole = false;
                    this.dealtHole = null;
                    this.view.draw(this);
                    this.pump();
                }
            });
            this.anims.add(cancel);
        };
        launch();
    }
    finishHoleDeal() {
        if (!this.dealingHole) return;
        for (const cancel of this.anims) cancel();
        this.anims.clear();
        this.dealing = false;
        this.dealingHole = false;
        this.dealtHole = null;
        this.view.draw(this);
        this.pump();
    }
    think() {
        const id = ++this.request;
        this.failed = false;
        try {
            if (!this.worker) {
                this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
                this.worker.onerror = () => this.failAI();
                this.worker.onmessage = ({ data }) => {
                    if (this.disposed || data.id !== this.request) return;
                    clearTimeout(this.timer);
                    if (data.error) { this.failAI(); return; }
                    this.later(() => {
                        if (data.id !== this.request) return;
                        if (!this.performAction(data.action)) this.failAI();
                    }, 450);
                };
            }
            this.worker.postMessage({ id, view: observation(this.state) });
            this.later(() => this.failAI(), 15000);
        } catch { this.failAI(); }
    }
    failAI() {
        if (this.disposed) return;
        this.removeEffect();
        clearTimeout(this.timer); this.timer = null; this.worker?.terminate(); this.worker = null;
        this.request++; this.failed = true;
        this.status = '電腦計算失敗：Enter 重試，N 返回選單'; this.view.draw(this);
    }
    raiseInput(error = '') {
        const l = legalActions(this.state);
        this.dialog = this.cmd.openDialog(InputDialog, 'holdem-raise', {
            title: error || '下注／加注', width: 64,
            prompt: `本輪加注至總額（${l.min}–${l.max}）：`,
            footer: 'Enter 確認    Esc 取消',
            onConfirm: text => {
                this.dialog = null;
                const to = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
                if (!this.performAction({ type: 'raise', to })) {
                    this.raiseInput('請輸入範圍內的整數');
                }
            },
            onCancel: () => { this.dialog = null; this.view.draw(this); },
            onAbort: () => this.cmd._quit(),
        });
    }
    performAction(action) {
        if (this.disposed || this.effect || this.dealing || !action) return false;
        const seat = this.state.actor, legal = legalActions(this.state);
        const type = action.type === 'allin' && legal ?
            (legal.max <= this.state.currentBet ? 'call' : 'raise') : action.type;
        const label = { call: '跟注', raise: '加注', fold: '棄牌' }[type];
        if (!act(this.state, action)) return false;
        if (!label || (type === 'call' && !legal.call)) { this.pump(); return true; }
        this.showEffect(seat, label);
        this.later(() => { this.removeEffect(); this.pump(); }, 500);
        return true;
    }
    // Reveal each live hand in turn, starting with the seat after the player.
    // Each frame shows that seat's hand type for 500ms before the next one.
    startShowdown() {
        const s = this.state;
        this.showdownDone = true;
        this.showdownRevealing = true;
        this.showdownShown = new Set();
        this.showdownOrder = [];
        for (let id = 1; id < s.players.length; id++)
            if (!s.players[id].folded) this.showdownOrder.push(id);
        if (!s.players[0].folded) this.showdownOrder.push(0);
        this.showdownIndex = 0;
        this.revealNext();
    }
    revealNext() {
        if (this.disposed) return;
        if (this.showdownIndex >= this.showdownOrder.length) {
            this.showdownOrder = []; this.showdownIndex = 0;
            this.showdownRevealing = false;
            this.pump();
            return;
        }
        const s = this.state, seat = this.showdownOrder[this.showdownIndex++];
        const hole = s.players[seat].hole;
        this.showdownShown.add(seat);
        this.showEffect(seat, handName(evaluate([...hole, ...s.board])));
        this.later(() => { this.removeEffect(); this.revealNext(); }, 500);
    }
    // Draw the frame above the player's cards and below a computer's cards so
    // it never covers a card face. Clamp the rightmost seats inside the screen.
    showEffect(seat, text) {
        if (!EFFECT_BUFFERS.has(text)) EFFECT_BUFFERS.set(text, buildCallEffectBuffer(text));
        const buffer = EFFECT_BUFFERS.get(text), w = buffer[0].length;
        const x = Math.max(0, Math.min(seat === 0 ? 35 : 3 + (seat - 1) * 16, 80 - w));
        this.effect = {
            seat, x, y: seat === 0 ? 13 : 8, w, h: buffer.length,
            owner: this.cmd, getCell: makeOverlayGetCell(buffer, w, buffer.length),
        };
        this.actions = [];
        this.status = `${seatName(seat)}：${text}`;
        this.view.draw(this);
        term.addOverlay(this.effect);
    }
    removeEffect() {
        if (this.effect) term.removeOverlay(this.effect);
        this.effect = null;
    }
    showResult() {
        this.dialog = this.cmd.openDialog(ShowDialog, 'holdem-result', {
            title: '本手結算', width: 68, message: resultText(this.state),
            footer: 'Enter / Esc 返回牌桌    Tab 查看牌桌', peekOnTab: true,
            onExit: () => { this.dialog = null; }, onAbort: () => this.cmd._quit(),
        });
    }
    key(data) {
        if (data === '\x1B' || /^[qQ]$/.test(data)) return this.cmd._quit();
        if (/^[nN]$/.test(data)) return this.cmd._menu();
        if (this.dealingHole && (data === '\r' || data === '\n' || data === ' ')) {
            this.finishHoleDeal();
            return;
        }
        if (this.effect || this.dealing) return;
        if (this.failed) {
            if (data === '\r' || data === '\n') { this.failed = false; this.pump(); }
            return;
        }
        if (this.state.phase === 'result') {
            if (data === '\r' || data === '\n') this.nextHand();
            else if (/^[rR]$/.test(data)) this.showResult();
            return;
        }
        if (this.state.actor !== 0 || !this.actions.length) return;
        if (data === '\x1B[D' || data === '\x1B[C') {
            this.choice = (this.choice + (data === '\x1B[D' ? -1 : 1) + this.actions.length) % this.actions.length;
            this.view.draw(this);
        } else if (data === '\r' || data === '\n') {
            const action = this.actions[this.choice];
            if (action.type === 'raise') this.raiseInput();
            else this.performAction(action);
        }
    }
    dispose() {
        this.disposed = true; this.request++;
        this.removeEffect();
        for (const cancel of this.anims) cancel();
        this.anims.clear();
        this.dealing = false; this.revealed = null;
        this.dealingHole = false; this.dealtHole = null;
        this.showdownDone = false; this.showdownShown = null;
        this.showdownOrder = []; this.showdownIndex = 0;
        this.showdownRevealing = false;
        clearTimeout(this.timer); this.timer = null; this.worker?.terminate(); this.worker = null;
        this.dialog?.close(); this.dialog = null;
    }
}
