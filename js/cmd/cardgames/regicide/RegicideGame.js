import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { installMethods } from '../../../util/install-methods.js';
import { dealCard, staggerFlights } from '../animation.js';
import { createGame, play, jester, needsRescue } from './rules.js';
import { initView, draw as drawView, DECK, USED, DISCARD, deckBottom, handPosition, enemyName, enemyCardOrigin, flashEnemy, dissolveEnemy, walkInEnemy, handCompaction, slideHand, sortHandAnimation, attackPosition, createAttackStage } from './render.js';
import { presentationMethods, snapshotPiles } from './presentation.js';

export class RegicideGame {
    constructor(cmd) { this.cmd = cmd; initView(this); this.anims = new Set(); this.batch = 0; }
    start() {
        this.stopDeals(); this.resetPresentation();
        this.sortBySuit = false; this.cheatKeys = [];
        this.state = createGame(); this.arrivalPending = true; this.counterEffect = null; this.selected = new Set(); this.cursor = 0;
        this.dealNewCards([]);
    }
    stopDeals({ preserveStaged = false } = {}) {
        this.clearEffectPhase();
        this.displayAttack = null;
        if (!preserveStaged) this.clearStagedAttack();
        this.clearEvent();
        this.hideBanner();
        clearTimeout(this.finishTimer); this.finishTimer = null;
        clearTimeout(this.arrivalTimer); this.arrivalTimer = null; this.arrivalDelay = 0;
        this.cancelArrival?.(); this.cancelArrival = null; this.arriving = false;
        this.cancelDissolve?.(); this.cancelDissolve = null; this.dissolving = false;
        this.cancelFlash?.(); this.cancelFlash = null; this.flashing = false;
        this.cancelSort?.(); this.cancelSort = null; this.sorting = false;
        this.cancelSlide?.(); this.cancelSlide = null;
        this.discarding = false; this.discardText = null; this.handOverride = null;
        this.batch++; this.collecting = false; this.recovering = false; this.presentation = null;
        this.enemyCleared = false; this.rosterHold = false;
        for (const cancel of this.anims) cancel();
        this.anims.clear(); this.dealing = false; this.hidden = new Set(); this.pending = 0; this.dealTotal = 0;
    }
    dealNewCards(retained, presentation = null, onComplete = null) {
        // Recovery/dealing are substeps of an attack: keep its parked cards.
        if (!onComplete) this.stopDeals({ preserveStaged: true });
        // An arrival is pending: keep the enemy hidden and unhyped while dealing.
        if (this.arrivalPending) { this.rosterHold = true; this.enemyCleared = true; }
        this.presentation = presentation;
        const batch = this.batch;
        const indices = [];
        this.state.hand.forEach((card, i) => { if (!retained.includes(card)) indices.push(i); });
        this.hidden = new Set(indices); this.pending = indices.length; this.dealTotal = indices.length;
        this.dealing = !!onComplete || indices.length > 0;
        const finish = () => {
            if (onComplete) onComplete();
            else { this.dealing = false; this.finishEffects(); }
        };
        this.draw();
        if (!indices.length) { finish(); this.draw(); return; }
        staggerFlights(this.anims, {
            count: indices.length,
            isActive: () => !this.disposed && batch === this.batch,
            start: (slot, { onStep, onLand }) => {
                const index = indices[slot];
                this.pending--; this.draw();
                return dealCard(this.cmd, this.state.hand[index], DECK, handPosition(index), {
                    duration: 180, flipDuration: 180, onStep,
                }, onLand);
            },
            land: slot => {
                this.hidden.delete(indices[slot]);
                this.draw();
            },
            done: finish,
        });
    }
    recoverCards(retained, effect, onComplete = null) {
        if (!onComplete) this.stopDeals({ preserveStaged: true });
        const batch = this.batch;
        this.dealing = true; this.recovering = true;
        this.hidden = new Set(this.state.hand.map((_, i) => i).filter(i => !retained.includes(this.state.hand[i])));
        this.presentation = { deckCount: effect.deckCount - effect.count,
            discardCount: effect.discard.length + effect.count, discardTop: null };
        this.draw();
        staggerFlights(this.anims, {
            count: effect.count,
            isActive: () => !this.disposed && batch === this.batch,
            start: (_slot, { onStep, onLand }) => {
                this.presentation.discardCount--; this.draw();
                // Recovered cards go under the deck, so aim below the top card.
                const to = deckBottom(this.presentation.deckCount + 1);
                return dealCard(this.cmd, null, DISCARD, to, {
                    faceDown: true, duration: 180, onStep,
                }, onLand);
            },
            land: () => { this.presentation.deckCount++; this.draw(); },
            done: () => {
                this.recovering = false;
                this.presentation.discardTop = effect.discard.at(-1) ?? null;
                if (onComplete) { onComplete(); this.draw(); }
                else this.dealNewCards(retained, { ...this.presentation });
            },
        });
    }
    clearStagedAttack() {
        if (!this.stagedAttack) return;
        this.stagedAttack.view.close();
        this.stagedAttack = null;
        this.usedDisplay = null;
    }
    stageAttack(oldHand, indices, before, onComplete) {
        this.stopDeals();
        const batch = this.batch;
        this.displayAttack = this.attackEffect?.beforeAttack ?? null;
        const cards = indices.map(i => oldHand[i]);
        const view = createAttackStage(this.cmd, cards);
        this.stagedAttack = { cards, view };
        this.usedDisplay = before.used;
        this.presentation = before;
        this.dealing = true;
        this.handOverride = oldHand;
        this.hidden = new Set(indices);
        this.draw();
        let landed = 0;
        indices.forEach((index, slot) => {
            let cancel;
            cancel = dealCard(this.cmd, oldHand[index], handPosition(index), attackPosition(slot), {
                faceUp: true, duration: 260,
            }, () => {
                if (this.disposed || batch !== this.batch) return;
                this.anims.delete(cancel);
                view.setVisible(slot, true);
                if (++landed === cards.length) {
                    this.handOverride = null;
                    this.hidden.clear();
                    onComplete();
                }
            });
            this.anims.add(cancel);
        });
    }
    collectAttack() {
        const batch = this.batch;
        const { cards, view } = this.stagedAttack;
        this.dealing = true;
        staggerFlights(this.anims, {
            count: cards.length,
            isActive: () => !this.disposed && batch === this.batch,
            start: (slot, { onStep, onLand }) => {
                const card = cards[slot];
                view.setVisible(slot, false);
                return dealCard(this.cmd, card, attackPosition(slot), USED, {
                    faceUp: true, duration: 260, onStep,
                }, onLand);
            },
            land: slot => {
                this.usedDisplay.push(cards[slot]);
                this.draw();
            },
            done: () => {
                const used = this.usedDisplay;
                this.clearStagedAttack();
                this.usedDisplay = this.defeatEffect ? used : null;
                if (!this.defeatEffect) this.displayAttack = null;
                this.dealing = false;
                this.finishEffects();
                this.draw();
            },
        });
    }
    runAttackEffects(retained, effects) {
        const recovery = effects.find(e => e.type === 'recover');
        const draw = effects.find(e => e.type === 'draw');
        const shield = effects.find(e => e.type === 'shield');
        const reduceAttack = () => {
            if (!shield) { this.finishEffects(); return; }
            this.runEffectPhase('♠減攻' + shield.power, done => {
                this.displayAttack = shield.afterAttack;
                this.draw(); done();
            }, () => this.finishEffects());
        };
        const drawCards = () => {
            // Preserve pile snapshots even when the rules have already defeated the enemy.
            const presentation = { ...this.presentation };
            if (draw) this.runEffectPhase('♦抽牌' + draw.power,
                done => this.dealNewCards(retained, presentation, done), reduceAttack);
            else this.dealNewCards(retained, presentation, reduceAttack);
        };
        if (recovery) this.runEffectPhase('♥回收' + recovery.power,
            done => this.recoverCards(retained, recovery, done), drawCards);
        else drawCards();
    }
    finishEffects() {
        if (this.attackEffect) {
            const effect = this.attackEffect; this.attackEffect = null;
            this.counterEffect = !this.defeatEffect && effect.incoming > 0 ? effect : null;
            const batch = this.batch;
            this.runEffectPhase((effect.doubled ? '♣倍傷' : '傷害') + effect.damage, done => {
                this.flashing = true; this.displayHp = effect.afterHp;
                this.draw();
                this.cancelFlash = flashEnemy(this,
                    effect.damage <= 5 ? 1 : effect.damage <= 10 ? 2 : 3, () => {
                        if (this.disposed || batch !== this.batch) return;
                        this.cancelFlash = null; this.flashing = false;
                        done(); this.draw();
                    });
            }, () => {
                this.displayHp = null;
                if (!this.defeatEffect) this.presentation = null;
                this.finishEffects(); this.draw();
            });
            return;
        }
        if (this.stagedAttack) { this.collectAttack(); return; }
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
            this.startArrival();
        }
    }
    // Step 0: wait a beat after a defeat, then run the arrival presentation.
    startArrival() {
        const batch = this.batch;
        this.dealing = true; this.arriving = true;
        const delay = this.arrivalDelay || 0; this.arrivalDelay = 0;
        if (!delay) { this.runArrival(); return; }
        this.arrivalTimer = setTimeout(() => {
            this.arrivalTimer = null;
            if (this.disposed || batch !== this.batch) return;
            this.runArrival();
        }, delay);
    }
    runArrival() {
        const batch = this.batch;
        // Steps 1-2: banner stays while the enemy walks down into place.
        this.rosterHold = true; this.enemyCleared = true;
        this.showBanner('敵人來襲');
        this.cancelArrival = walkInEnemy(this, () => {
            if (this.disposed || batch !== this.batch) return;
            this.cancelArrival = null;
            // The enemy stays put with its stats while the banner lingers a
            // beat; only the green roster entry and input wait for it to clear.
            this.enemyCleared = false;
            this.draw();
            this.arrivalTimer = setTimeout(() => {
                this.arrivalTimer = null;
                if (this.disposed || batch !== this.batch) return;
                // Step 3: the banner clears; the green roster entry appears and
                // input is unblocked.
                this.hideBanner();
                this.rosterHold = false;
                this.arriving = false;
                this.dealing = false;
                this.draw();
            }, 800);
        });
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
            this.collecting = false; this.presentation = null;
            this.usedDisplay = null; this.displayEnemy = null; this.displayAttack = null;
            // Step 7: everything has landed; hold the banner briefly, then close.
            // Keep dealing true so input stays blocked through the hold.
            this.finishTimer = setTimeout(() => {
                this.finishTimer = null;
                if (this.disposed || batch !== this.batch) return;
                this.hideBanner();
                if (this.state.phase !== 'win') {
                    this.arrivalPending = true; this.arrivalDelay = 400;
                    this.finishEffects();
                } else this.dealing = false;
                this.draw();
            }, 200);
        };
        if (!effect.used.length) { finish(); this.draw(); return; }
        this.draw();
        staggerFlights(this.anims, {
            count: effect.used.length,
            isActive: () => !this.disposed && batch === this.batch,
            start: (slot, { onStep, onLand }) => {
                const card = effect.used[slot];
                this.usedDisplay.shift(); this.draw();
                return dealCard(this.cmd, card, USED, DISCARD, {
                    faceUp: true, duration: 180, onStep,
                }, onLand);
            },
            land: slot => {
                this.presentation.discardCount++;
                this.presentation.discardTop = effect.used[slot];
                this.draw();
            },
            done: finish,
        });
    }
    // Fly every discarded card from its hand slot to the discard pile at the
    // same time, then run the follow-up step (hand compaction or a new deal).
    discardCards(oldHand, indices, before, text, onComplete) {
        const batch = this.batch;
        this.dealing = true; this.discarding = true; this.discardText = text;
        this.handOverride = oldHand;
        this.hidden = new Set(indices);
        this.presentation = { deckCount: before.deckCount,
            discardCount: before.discardCount, discardTop: before.discardTop };
        this.draw();
        if (!indices.length) {
            this.discarding = false; this.handOverride = null; this.hidden = new Set();
            onComplete(); return;
        }
        let landed = 0;
        for (const index of indices) {
            const card = oldHand[index];
            let cancel;
            cancel = dealCard(this.cmd, card, handPosition(index), DISCARD, {
                faceUp: true, duration: 260,
            }, () => {
                if (this.disposed || batch !== this.batch) return;
                this.anims.delete(cancel);
                this.presentation.discardCount++;
                this.presentation.discardTop = card;
                if (++landed === indices.length) {
                    // The override stays until the slide overlay takes over so
                    // the gaps do not snap closed before the compaction runs.
                    this.discarding = false; this.handOverride = null; this.hidden = new Set();
                    onComplete();
                } else this.draw();
            });
            this.anims.add(cancel);
        }
    }
    startHandSlide(oldHand, selected) {
        const batch = this.batch;
        const moves = handCompaction(oldHand, selected);
        this.draw();
        if (!moves.length) { this.finishDefend(); return; }
        this.cancelSlide = slideHand(this, moves, () => {
            if (this.disposed || batch !== this.batch) return;
            this.cancelSlide = null;
            this.finishDefend();
        });
    }
    finishDefend() {
        this.cancelSlide = null;
        this.discarding = false; this.discardText = null; this.handOverride = null;
        this.hidden = new Set(); this.presentation = null; this.dealing = false;
        this.draw();
    }
    sortHand() {
        const oldHand = this.state.hand;
        const hand = [...oldHand].sort(this.sortBySuit ?
            (a, b) => a.suit - b.suit || a.rank - b.rank :
            (a, b) => a.rank - b.rank || a.suit - b.suit);
        this.sortBySuit = !this.sortBySuit;
        if (hand.every((card, i) => card === oldHand[i])) return;
        const selected = new Set([...this.selected].map(i => oldHand[i]));
        const cursorCard = oldHand[this.cursor];
        const batch = this.batch;
        this.sorting = true;
        this.draw();
        this.cancelSort = sortHandAnimation(this, hand, () => {
            if (this.disposed || batch !== this.batch) return;
            this.cancelSort = null; this.sorting = false;
            this.state.hand = hand;
            this.selected = new Set(hand.flatMap((card, i) => selected.has(card) ? [i] : []));
            this.cursor = Math.max(0, hand.indexOf(cursorCard));
            this.draw();
        });
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
        const eligible = !this.dealing && !this.sorting && !this.dialog &&
            ['attack', 'defend'].includes(this.state.phase);
        if (!eligible || !/^[cC]$/.test(data)) this.cheatKeys = [];
        if (eligible && /^[cC]$/.test(data)) {
            if (!this.state.cheatMode) {
                const now = performance.now();
                this.cheatKeys = (this.cheatKeys || []).filter(time => now - time <= 1000);
                this.cheatKeys.push(now);
                if (this.cheatKeys.length === 5) {
                    this.state.cheatMode = true;
                    this.state.jesters = 2;
                    this.cheatKeys = [];
                    this.draw();
                }
            }
            return;
        }
        if (data === '\x1b' || /^[qQ]$/.test(data)) return this.ask('離開遊戲？', () => this.cmd._quit());
        if (/^[nN]$/.test(data)) return this.ask('返回選單？', () => this.cmd._menu());
        if (this.dealing || this.sorting) return;
        if (/^[hH]$/.test(data)) {
            this.dialog = this.cmd.openDialog(ShowDialog, null, {
                title: 'Regicide 規則', width: 72,
                message: '擊敗四名 J、四名 Q、四名 K。\n單牌、A 配一張牌，或同點數合計不超過 10。\n♥ 回收棄牌至牌堆底；♦ 抽牌至最多八張。\n♣ 雙倍傷害；♠ 累積降低當前敵人攻擊。\n敵人免疫同花色效果。先回收，再抽牌。\n抵傷棄牌不觸發能力。精準擊殺將敵牌放牌堆頂。\nJ/Q/K 入手後值為 10/15/20。\n小丑可在出牌或抵傷前換手，共兩次，不解除免疫。\nS 交替排序：點數 A–K／花色 ♠♥♦♣；保留選牌。\n單人不能跳過回合；沒有悔棋。',
                onExit: () => { this.dialog = null; }, onAbort: () => this.cmd._quit(),
            }); return;
        }
        if (['win', 'loss'].includes(this.state.phase)) { if (data === '\r') this.start(); return; }
        if (/^[sS]$/.test(data)) return this.sortHand();
        if ((/^[jJ]$/.test(data) || ((data === '\r' || data === '\n') && needsRescue(this.state))) && this.state.jesters) return this.ask(this.state.cheatMode ? '使用小丑換手？' : '消耗小丑換手？', () => {
            const oldHand = [...this.state.hand];
            const indices = oldHand.map((_, i) => i);
            const before = snapshotPiles(this.state);
            jester(this.state); this.selected.clear(); this.cursor = 0;
            this.discardCards(oldHand, indices, before, '換手中…', () => this.dealNewCards([]));
        });
        if (data === '\x1b[D') this.cursor = Math.max(0, this.cursor - 1);
        else if (data === '\x1b[C') this.cursor = Math.min(this.state.hand.length - 1, this.cursor + 1);
        else if (data === ' ' && this.state.hand[this.cursor]) {
            if (this.selected.has(this.cursor)) this.selected.delete(this.cursor); else this.selected.add(this.cursor);
        } else if (data === '\r') {
            const oldHand = [...this.state.hand];
            const selectedIndices = [...this.selected].sort((a, b) => a - b);
            const retained = this.state.hand.filter((_, i) => !this.selected.has(i));
            const wasDefend = this.state.phase === 'defend';
            const before = { ...snapshotPiles(this.state), used: [...this.state.played] };
            const effects = [];
            if (play(this.state, selectedIndices, effects)) {
                this.selected.clear(); this.cursor = 0;
                // Defence discards the chosen cards and compacts the hand; it
                // has no attack/defeat effects to resolve.
                if (wasDefend) {
                    this.discardCards(oldHand, selectedIndices, before, '抵傷中…',
                        () => this.startHandSlide(oldHand, new Set(selectedIndices)));
                    return;
                }
                this.attackEffect = effects.find(e => e.type === 'attack');
                this.displayHp = this.attackEffect?.beforeHp ?? null;
                this.defeatEffect = effects.find(e => e.type === 'defeat');
                this.displayEnemy = this.defeatEffect?.enemy || null;
                this.stageAttack(oldHand, selectedIndices, before,
                    () => this.runAttackEffects(retained, effects));
                return;
            }
        } else return;
        this.draw();
    }
    dispose() { this.counterEffect = null; this.arrivalPending = false; this.resetPresentation(); this.disposed = true; this.stopDeals(); this.dialog?.close(); this.dialog = null; }
}

installMethods(RegicideGame, presentationMethods);
