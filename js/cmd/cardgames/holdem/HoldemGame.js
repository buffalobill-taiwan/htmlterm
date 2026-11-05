import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { InputDialog } from '../../../dialog/InputDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { createTable, startHand, act, advanceStreet, legalActions, observation, BUY_IN } from './rules.js';
import { handName } from './evaluate.js';
import { HoldemView, resultText } from './view.js';
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
                        if (!act(this.state, data.action)) { this.failAI(); return; }
                        this.pump();
                    }, 450);
                };
            }
            this.worker.postMessage({ id, view: observation(this.state) });
            this.later(() => this.failAI(), 15000);
        } catch { this.failAI(); }
    }
    failAI() {
        if (this.disposed) return;
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
                if (!act(this.state, { type: 'raise', to })) {
                    this.raiseInput('請輸入範圍內的整數'); return;
                }
                this.pump();
            },
            onCancel: () => { this.dialog = null; this.view.draw(this); },
            onAbort: () => this.cmd._quit(),
        });
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
            else if (act(this.state, action)) this.pump();
        }
    }
    dispose() {
        this.disposed = true; this.request++;
        clearTimeout(this.timer); this.timer = null; this.worker?.terminate(); this.worker = null;
        this.dialog?.close(); this.dialog = null;
    }
}
