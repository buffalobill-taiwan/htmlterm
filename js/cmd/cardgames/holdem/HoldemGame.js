import { term } from '../../../system/sys.js';
import { makeOverlayGetCell } from '../../../util/sgr.js';
import { buildCallEffectBuffer } from '../../../util/call-effect.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { InputDialog } from '../../../dialog/InputDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { createTable, startHand, act, advanceStreet, legalActions, observation, BUY_IN } from './rules.js';
import { handName } from './evaluate.js';
import { HoldemView, resultText } from './view.js';
const ACTION_EFFECTS = new Map();

export class HoldemGame {
    constructor(cmd) {
        this.cmd = cmd;
        this.state = createTable(); this.view = new HoldemView();
        this.actions = []; this.choice = 0; this.request = 0;
    }
    start() { this.nextHand(); }
    nextHand() {
        if (this.disposed) return;
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
        if (startHand(this.state)) { this.status = ''; this.pump(); }
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
            this.status = s.pots.length > 1 ? '多個底池已結算；R 查看各池得主' :
                s.pots[0].awards.map(a => `${a.seat ? '電腦 ' + a.seat : '你'} +${a.amount}`).join('  ') +
                (s.showdown ? '（' + handName(s.pots[0].value) + '）' : '（其他玩家棄牌）');
            this.view.draw(this);
            if (s.pots.length > 1) this.showResult();
            return;
        }
        if (s.phase === 'between') {
            this.view.draw(this);
            this.later(() => { advanceStreet(s); this.pump(); }, 650);
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
        if (this.disposed || this.effect || !action) return false;
        const seat = this.state.actor, legal = legalActions(this.state);
        const type = action.type === 'allin' && legal ?
            (legal.max <= this.state.currentBet ? 'call' : 'raise') : action.type;
        const label = { call: '跟注', raise: '加注', fold: '棄牌' }[type];
        if (!act(this.state, action)) return false;
        if (!label || (type === 'call' && !legal.call)) { this.pump(); return true; }
        if (!ACTION_EFFECTS.has(label)) ACTION_EFFECTS.set(label, buildCallEffectBuffer(label));
        const buffer = ACTION_EFFECTS.get(label);
        this.effect = {
            seat, x: seat === 0 ? 35 : 3 + (seat - 1) * 16,
            y: seat === 0 ? 16 : 5, w: buffer[0].length, h: buffer.length,
            owner: this.cmd, getCell: makeOverlayGetCell(buffer, buffer[0].length, buffer.length),
        };
        this.actions = [];
        this.status = `${seat === 0 ? '你' : '電腦 ' + seat}：${label}`;
        this.view.draw(this);
        term.addOverlay(this.effect);
        this.later(() => { this.removeEffect(); this.pump(); }, 500);
        return true;
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
        if (this.effect) return;
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
        clearTimeout(this.timer); this.timer = null; this.worker?.terminate(); this.worker = null;
        this.dialog?.close(); this.dialog = null;
    }
}
