import { buildCallEffectBuffer } from '../../../util/call-effect.js';
import { makeOverlayGetCell } from '../../../util/sgr.js';
import { term } from '../../../system/sys.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { dealCard } from '../animation.js';
import { createGame, play, jester, needsRescue } from './rules.js';
import { initView, draw as drawView, DECK, USED, DISCARD, deckBottom, handPosition, enemyName, enemyCardOrigin, flashEnemy, dissolveEnemy } from './render.js';

const EVENT_BUFFERS = new Map();

export class RegicideGame {
    constructor(cmd) { this.cmd = cmd; initView(this); this.anims = new Set(); this.batch = 0; }
    start() {
        this.stopDeals(); this.attackEffect = null; this.displayHp = null; this.defeatEffect = null; this.usedDisplay = null; this.displayEnemy = null;
        this.enemyCleared = false; this.rosterHold = false;
        this.state = createGame(); this.arrivalPending = true; this.counterEffect = null; this.selected = new Set(); this.cursor = 0;
        this.dealNewCards([]);
    }
    stopDeals() {
        this.clearEvent();
        this.hideBanner();
        clearTimeout(this.finishTimer); this.finishTimer = null;
        this.cancelDissolve?.(); this.cancelDissolve = null; this.dissolving = false;
        this.cancelFlash?.(); this.cancelFlash = null; this.flashing = false;
        this.batch++; this.collecting = false; this.recovering = false; this.presentation = null;
        this.enemyCleared = false; this.rosterHold = false;
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
                if (++landed === indices.length) { this.dealing = false; this.finishEffects(); }
                this.draw();
            });
            this.anims.add(cancel);
        };
        if (!indices.length) { this.finishEffects(); this.draw(); }
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
            // Recovered cards go under the deck, so aim below the top card.
            const to = deckBottom(this.presentation.deckCount + 1);
            const cancel = dealCard(this.cmd, null, DISCARD, to, {
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
    clearEvent() {
        clearTimeout(this.eventTimer); this.eventTimer = null;
        if (this.eventOverlay) term.removeOverlay(this.eventOverlay);
        this.eventOverlay = null;
        this.eventCleanup?.(); this.eventCleanup = null;
    }
    showEvent(text, done) {
        this.clearEvent();
        const batch = this.batch, active = this.cmd.executionGuard();
        if (!EVENT_BUFFERS.has(text)) EVENT_BUFFERS.set(text, buildCallEffectBuffer(text));
        const buffer = EVENT_BUFFERS.get(text), w = buffer[0].length, h = buffer.length;
        this.dealing = true;
        this.eventOverlay = {x: Math.floor((80 - w) / 2), y: Math.floor((25 - h) / 2),
            w, h, owner: this.cmd, getCell: makeOverlayGetCell(buffer, w, h)};
        term.addOverlay(this.eventOverlay);
        this.eventCleanup = this.cmd.addCleanup(() => this.clearEvent());
        this.eventTimer = setTimeout(() => {
            this.clearEvent();
            if (this.disposed || batch !== this.batch || !active()) return;
            this.dealing = false; done(); this.draw();
        }, 800);
        this.draw();
    }
    // Persistent call-effect box used across a whole defeat sequence.
    showBanner(text) {
        this.hideBanner();
        if (!EVENT_BUFFERS.has(text)) EVENT_BUFFERS.set(text, buildCallEffectBuffer(text));
        const buffer = EVENT_BUFFERS.get(text), w = buffer[0].length, h = buffer.length;
        this.bannerOverlay = {x: Math.floor((80 - w) / 2), y: Math.floor((25 - h) / 2),
            w, h, owner: this.cmd, getCell: makeOverlayGetCell(buffer, w, h)};
        term.addOverlay(this.bannerOverlay);
        this.bannerCleanup = this.cmd.addCleanup(() => this.hideBanner());
        this.draw();
    }
    hideBanner() {
        if (this.bannerOverlay) term.removeOverlay(this.bannerOverlay);
        this.bannerOverlay = null;
        this.bannerCleanup?.(); this.bannerCleanup = null;
    }
    finishEffects() {
        if (this.attackEffect) {
            const effect = this.attackEffect; this.attackEffect = null;
            this.counterEffect = !this.defeatEffect && effect.incoming > 0 ? effect : null;
            const batch = this.batch;
            this.dealing = true; this.flashing = true; this.displayHp = effect.afterHp;
            this.draw();
            this.cancelFlash = flashEnemy(this,
                effect.damage <= 5 ? 1 : effect.damage <= 10 ? 2 : 3, () => {
                    if (this.disposed || batch !== this.batch) return;
                    this.cancelFlash = null; this.flashing = false; this.dealing = false;
                    this.displayHp = null; if (!this.defeatEffect) this.presentation = null; this.finishEffects(); this.draw();
                });
            return;
        }
        if (this.defeatEffect) {
            const effect = this.defeatEffect; this.defeatEffect = null;
            const batch = this.batch;
            // Step 1: the defeated roster entry turns grey and the next enemy is
            // not highlighted until it arrives. Step 2: banner, then dissolve.
            this.rosterHold = true;
            this.dealing = true; this.dissolving = true;
            this.showBanner(enemyName(effect.enemy) + '被擊倒');
            this.cancelDissolve = dissolveEnemy(this, () => {
                if (this.disposed || batch !== this.batch) return;
                this.cancelDissolve = null; this.dissolving = false;
                // Step 3: the fully black grid clears, then the 1x card flies out.
                this.enemyCleared = true;
                this.flyDefeatedCard(effect);
            });
            return;
        }
        if (this.counterEffect) {
            const effect = this.counterEffect; this.counterEffect = null;
            this.showEvent(enemyName(effect.enemy) + '的攻擊', () => {});
            return;
        }
        if (this.arrivalPending) {
            this.arrivalPending = false;
            // The next enemy only appears and gets its green roster entry now.
            this.rosterHold = false; this.enemyCleared = false;
            this.showEvent(enemyName(this.state.enemy) + '來襲！', () => {});
        }
    }
    flyDefeatedCard(effect) {
        const batch = this.batch;
        const from = enemyCardOrigin(effect.enemy);
        const to = effect.exact ? DECK : DISCARD;
        this.collecting = true; this.dealing = true;
        this.displayEnemy = effect.enemy;
        this.usedDisplay = [...effect.used];
        // Presentation starts before the enemy reaches its pile; the counters
        // advance only when the card lands.
        const beforeDiscard = effect.discard.slice(0,
            effect.discard.length - effect.used.length - (effect.exact ? 0 : 1));
        this.presentation = { deckCount: effect.deckCount - (effect.exact ? 1 : 0),
            discardCount: beforeDiscard.length, discardTop: beforeDiscard.at(-1) ?? null };
        this.draw();
        const cancel = dealCard(this.cmd, effect.enemy, from, to, {
            faceUp: true, duration: 400,
        }, () => {
            if (this.disposed || batch !== this.batch) return;
            this.anims.delete(cancel);
            if (effect.exact) this.presentation.deckCount++;
            else { this.presentation.discardCount++; this.presentation.discardTop = effect.enemy; }
            this.draw();
            this.collectUsed(effect);
        });
        this.anims.add(cancel);
    }
    collectUsed(effect) {
        const batch = this.batch;
        this.collecting = true; this.dealing = true;
        this.usedDisplay = [...effect.used];
        const finish = () => {
            this.collecting = false; this.dealing = false; this.presentation = null;
            this.usedDisplay = null; this.displayEnemy = null;
            // Step 7: everything has landed; hold the banner briefly, then close.
            this.finishTimer = setTimeout(() => {
                this.finishTimer = null;
                if (this.disposed || batch !== this.batch) return;
                this.hideBanner();
                if (this.state.phase !== 'win') {
                    this.arrivalPending = true; this.finishEffects();
                }
                this.draw();
            }, 200);
        };
        if (!effect.used.length) { finish(); this.draw(); return; }
        let next = 0, landed = 0;
        const launch = () => {
            if (this.disposed || batch !== this.batch || next >= effect.used.length) return;
            const card = effect.used[next++];
            this.usedDisplay.shift(); this.draw();
            let launched = false;
            const advance = () => { if (!launched) { launched = true; launch(); } };
            const cancel = dealCard(this.cmd, card, USED, DISCARD, {
                faceUp: true, duration: 180,
                onStep: (_step, ratio) => { if (ratio >= 0.45) advance(); },
            }, () => {
                if (this.disposed || batch !== this.batch) return;
                this.anims.delete(cancel);
                this.presentation.discardCount++; this.presentation.discardTop = card;
                advance();
                if (++landed === effect.used.length) finish();
                this.draw();
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
    draw() { drawView(this); }
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
                this.attackEffect = effects.find(e => e.type === 'attack');
                this.displayHp = this.attackEffect?.beforeHp ?? null;
                this.defeatEffect = effects.find(e => e.type === 'defeat');
                this.usedDisplay = this.defeatEffect?.used || null;
                this.displayEnemy = this.defeatEffect?.enemy || null;
                const recovery = effects.find(e => e.type === 'recover');
                if (recovery) this.recoverCards(retained, recovery);
                else {
                    const defeat = this.defeatEffect;
                    const beforeDiscard = defeat ? defeat.discard.slice(0,
                        defeat.discard.length - defeat.used.length - (defeat.exact ? 0 : 1)) : null;
                    this.dealNewCards(retained, defeat ? {
                        deckCount: defeat.deckCount - (defeat.exact ? 1 : 0) +
                            (effects.find(e => e.type === 'draw')?.count || 0),
                        discardCount: beforeDiscard.length, discardTop: beforeDiscard.at(-1),
                    } : null);
                }
                return;
            }
        } else return;
        this.draw();
    }
    dispose() { this.counterEffect = null; this.arrivalPending = false; this.attackEffect = null; this.displayHp = null; this.defeatEffect = null; this.usedDisplay = null; this.displayEnemy = null; this.disposed = true; this.stopDeals(); this.dialog?.close(); this.dialog = null; }
}
