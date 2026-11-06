import { VirtualBuffer } from '../../../util/VirtualBuffer.js';
import { term } from '../../../system/sys.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { dealCard } from '../animation.js';
import { cardBuffer } from '../cards.js';
import { createGame, preview, play, jester, value, needsRescue } from './rules.js';

const DISCARD = { x: 63, y: 5 };
const DECK = { x: 73, y: 5 };
const JESTERS = [
    { x: 47, y: 5, card: { suit: 0, rank: 0 } },
    { x: 54, y: 5, card: { suit: 1, rank: 0 } },
];
const handPosition = index => ({ x: 3 + index * 9, y: 12 });

const defenceFaces = new WeakMap();
function defenceFace(base) {
    if (!defenceFaces.has(base)) {
        const vb = new VirtualBuffer(base.width, base.height);
        for (let y = 0; y < base.height; y++) for (let x = 0; x < base.width; x++)
            vb.setCell(y, x, { ...base.getCell(y, x), bg: 8 });
        defenceFaces.set(base, vb);
    }
    return defenceFaces.get(base);
}

export class RegicideGame {
    constructor(cmd) { this.cmd = cmd; this.vb = new VirtualBuffer(80, 23); this.anims = new Set(); this.batch = 0; }
    start() {
        this.stopDeals();
        this.state = createGame(); this.selected = new Set(); this.cursor = 0;
        this.dealNewCards([]);
    }
    stopDeals() {
        this.batch++; this.recovering = false; this.presentation = null;
        for (const cancel of this.anims) cancel();
        this.anims.clear(); this.dealing = false; this.hidden = new Set(); this.pending = 0;
    }
    dealNewCards(retained, presentation = null) {
        this.stopDeals();
        this.presentation = presentation;
        const batch = this.batch;
        const indices = [];
        this.state.hand.forEach((card, i) => { if (!retained.includes(card)) indices.push(i); });
        this.hidden = new Set(indices); this.pending = indices.length; this.dealTotal = indices.length;
        this.dealing = indices.length > 0;
        this.draw();
        let next = 0, landed = 0;
        const launch = () => {
            if (this.disposed || batch !== this.batch || next >= indices.length) return;
            const index = indices[next++];
            this.pending--; this.draw();
            let launched = false;
            const advance = () => { if (!launched) { launched = true; launch(); } };
            const cancel = dealCard(this.cmd, this.state.hand[index], DECK, handPosition(index), {
                duration: 180, flipDuration: 180,
                onStep: (_step, ratio) => { if (ratio >= 0.45) advance(); },
            }, () => {
                if (this.disposed || batch !== this.batch) return;
                this.anims.delete(cancel); advance();
                this.hidden.delete(index);
                if (++landed === indices.length) { this.dealing = false; this.presentation = null; }
                this.draw();
            });
            this.anims.add(cancel);
        };
        if (!indices.length) { this.presentation = null; this.draw(); }
        launch();
    }
    recoverCards(retained, effect) {
        this.stopDeals();
        const batch = this.batch;
        this.dealing = true; this.recovering = true;
        this.hidden = new Set(this.state.hand.map((_, i) => i).filter(i => !retained.includes(this.state.hand[i])));
        this.presentation = { deckCount: effect.deckCount - effect.count,
            discardCount: effect.discard.length + effect.count, discardTop: null };
        let next = 0, landed = 0;
        const launch = () => {
            if (this.disposed || batch !== this.batch || next >= effect.count) return;
            next++; this.presentation.discardCount--; this.draw();
            let launched = false;
            const advance = () => { if (!launched) { launched = true; launch(); } };
            const cancel = dealCard(this.cmd, null, DISCARD, DECK, {
                faceDown: true, duration: 180,
                onStep: (_step, ratio) => { if (ratio >= 0.45) advance(); },
            }, () => {
                if (this.disposed || batch !== this.batch) return;
                this.anims.delete(cancel); this.presentation.deckCount++; advance();
                if (++landed === effect.count) {
                    this.dealNewCards(retained, { deckCount: effect.deckCount,
                        discardCount: effect.discard.length, discardTop: effect.discard.at(-1) });
                } else this.draw();
            });
            this.anims.add(cancel);
        };
        this.draw(); launch();
    }
    ask(message, action) {
        this.dialog = this.cmd.openDialog(SelectDialog, null, {
            title: message, options: ['取消', '確定'],
            onSelect: i => { this.dialog = null; if (i) action(); },
            onCancel: () => { this.dialog = null; }, onAbort: () => this.cmd._quit(),
        });
    }
    draw() {
        const s = this.state, vb = this.vb;
        for (let r = 0; r < 23; r++) vb.writeStr(r, 0, ' '.repeat(80));
        const text = (r, t) => vb.writeStr(r, 2, t);
        text(0, 'Regicide 弒君者 — 單人');
        text(2, '敵人 ' + '♠♥♦♣'[s.enemy.suit] + ['', '', '', '', '', '', '', '', '', '', '', 'J', 'Q', 'K'][s.enemy.rank] +
            '   生命 ' + Math.max(0, s.hp) + '   攻擊 ' + Math.max(0, value(s.enemy) - s.shield));
        text(4, '免疫：' + '♠♥♦♣'[s.enemy.suit] + '   已擊敗：' + s.defeated + '/12');
        vb.writeStr(3, 47, '小丑');
        for (let i = 0; i < s.jesters; i++) {
            const slot = JESTERS[i], face = cardBuffer(slot.card);
            for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++)
                vb.setCell(slot.y + y, slot.x + x, face.getCell(y, x));
        }
        text(8, this.recovering ? '回收中…' : this.dealing ? '發牌中…' : s.phase === 'win' ? ['銅', '銀', '金'][s.jesters] + '牌勝利！Enter 新局' :
            s.phase === 'loss' ? (s.lossReason || '挑戰失敗') + '。Enter 新局' : s.phase === 'attack' ? '選牌攻擊' : '選牌抵傷（不觸發花色能力）');
        if (!this.dealing && needsRescue(s)) text(10, '手牌不足，需使用小丑換手：按 Enter 或 J');
        const deckCount = this.presentation ?
            this.presentation.deckCount - (this.recovering ? 0 : this.dealTotal - this.pending) :
            s.deck.length + this.pending;
        const discardCount = this.presentation?.discardCount ?? s.discard.length;
        vb.writeStr(3, 61, '棄牌 ' + discardCount);
        if (discardCount) {
            const face = cardBuffer(this.recovering ? null : (this.presentation ? this.presentation.discardTop : s.discard.at(-1)));
            for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++)
                vb.setCell(DISCARD.y + y, DISCARD.x + x, face.getCell(y, x));
            for (let y = 1; y <= Math.min(3, discardCount - 1); y++)
                for (let x = 0; x < 5; x++) vb.setCell(DISCARD.y + 2 + y, DISCARD.x + x, face.getCell(2, x));
        } else vb.writeStr(DISCARD.y + 1, DISCARD.x, '[空]');
        vb.writeStr(3, 71, '牌堆 ' + deckCount);
        if (deckCount) {
            const back = cardBuffer(null);
            for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++)
                vb.setCell(DECK.y + y, DECK.x + x, back.getCell(y, x));
            for (let y = 1; y <= Math.min(3, deckCount - 1); y++)
                for (let x = 0; x < 5; x++) vb.setCell(DECK.y + 2 + y, DECK.x + x, back.getCell(2, x));
        } else vb.writeStr(DECK.y + 1, DECK.x, '[空]');
        s.hand.forEach((c, i) => {
            if (this.hidden.has(i)) return;
            const base = cardBuffer(c);
            // Rule settlement is synchronous; show defence only after all visual effects finish.
            const face = !this.dealing && s.phase === 'defend' ? defenceFace(base) : base;
            const x = handPosition(i).x;
            for (let y = 0; y < 3; y++) for (let k = 0; k < 5; k++) vb.setCell(12 + y, x + k, face.getCell(y, k));
            vb.writeStr(16, x, (i === this.cursor ? '>' : ' ') + (this.selected.has(i) ? '[X]' : '[ ]'));
        });
        const p = preview(s, [...this.selected]);
        if (p) text(18, (p.legal ? '可確認' : '選牌無效') + '   總值 ' + p.total +
            (s.phase === 'attack' ? '   傷害 ' + p.damage + '   反擊 ' + (p.damage >= s.hp ? 0 : p.incoming) +
                '   效果 ' + [...p.suits].map(i => '♠♥♦♣'[i]).join('') :
                '   尚欠 ' + Math.max(0, value(s.enemy) - s.shield - p.total)));
        text(20, '←→ 移動  Space 選牌  Enter 確認  J 小丑  H 規則');
        text(22, 'N 選單  Q/Esc 離開');
        term.writeVB(vb);
    }
    key(data) {
        if (data === '\x1b' || /^[qQ]$/.test(data)) return this.ask('離開遊戲？', () => this.cmd._quit());
        if (/^[nN]$/.test(data)) return this.ask('返回選單？', () => this.cmd._menu());
        if (this.dealing) return;
        if (/^[hH]$/.test(data)) {
            this.dialog = this.cmd.openDialog(ShowDialog, null, {
                title: 'Regicide 規則', width: 72,
                message: '擊敗四名 J、四名 Q、四名 K。\n單牌、A 配一張牌，或同點數合計不超過 10。\n♥ 回收棄牌至牌堆底；♦ 抽牌至最多八張。\n♣ 雙倍傷害；♠ 累積降低當前敵人攻擊。\n敵人免疫同花色效果。先回收，再抽牌。\n抵傷棄牌不觸發能力。精準擊殺將敵牌放牌堆頂。\nJ/Q/K 入手後值為 10/15/20。\n小丑可在出牌或抵傷前換手，共兩次，不解除免疫。\n單人不能跳過回合；沒有悔棋。',
                onExit: () => { this.dialog = null; }, onAbort: () => this.cmd._quit(),
            }); return;
        }
        if (['win', 'loss'].includes(this.state.phase)) { if (data === '\r') this.start(); return; }
        if ((/^[jJ]$/.test(data) || ((data === '\r' || data === '\n') && needsRescue(this.state))) && this.state.jesters) return this.ask('消耗小丑換手？', () => {
            jester(this.state); this.selected.clear(); this.cursor = 0; this.dealNewCards([]);
        });
        if (data === '\x1b[D') this.cursor = Math.max(0, this.cursor - 1);
        else if (data === '\x1b[C') this.cursor = Math.min(this.state.hand.length - 1, this.cursor + 1);
        else if (data === ' ' && this.state.hand[this.cursor]) {
            if (this.selected.has(this.cursor)) this.selected.delete(this.cursor); else this.selected.add(this.cursor);
        } else if (data === '\r') {
            const retained = this.state.hand.filter((_, i) => !this.selected.has(i));
            const effects = [];
            if (play(this.state, [...this.selected], effects)) {
                this.selected.clear(); this.cursor = 0;
                const recovery = effects.find(e => e.type === 'recover');
                if (recovery) this.recoverCards(retained, recovery);
                else this.dealNewCards(retained);
                return;
            }
        } else return;
        this.draw();
    }
    dispose() { this.disposed = true; this.stopDeals(); this.dialog?.close(); this.dialog = null; }
}
