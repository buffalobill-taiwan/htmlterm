import { sortHandAnimation } from './sort-animation.js';
import { dealCard, staggerFlights } from '../animation.js';
import { mulberry32, SEED_MAX } from '../../../util/random.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { RANKS, SUITS } from '../deck.js';
import {
    createGame, startKingdom, revealTopic, canPlay, playDebate, availableAbilities,
    beginAbility, commitSpades, discardCards, settleKingdom, requiredWins, legalIndices,
} from './rules.js';
import {
    EmissaryView, DECK, DISCARD, SCORING, TOPIC, kingdomPosition, allyPosition,
    handPosition, VISIBLE_HAND, ABILITY_LABEL,
} from './view.js';

const cardName = card => card ? `${SUITS[card.suit]}${RANKS[card.rank]}` : '—';

function normalizeKey(data) {
    if (typeof data !== 'string') return null;
    if (data === '\x1B') return 'Escape';
    const map = {
        '\x1B[A': 'ArrowUp', '\x1B[B': 'ArrowDown',
        '\x1B[C': 'ArrowRight', '\x1B[D': 'ArrowLeft',
        '\x1B[H': 'Home', '\x1B[F': 'End',
        '\x1B[1~': 'Home', '\x1B[4~': 'End',
        '\x1B[2~': 'Insert', '\x1B[3~': 'Delete',
        '\x1B[5~': 'PageUp', '\x1B[6~': 'PageDown',
        '\x1B[7~': 'Home', '\x1B[8~': 'End',
        '\x1B[Z': 'BackTab',
    };
    if (data.startsWith('\x1B')) return map[data] || null;
    return data;
}

export class EmissaryGame {
    constructor(cmd) {
        this.cmd = cmd;
        this.view = new EmissaryView();
        this.state = null;
        this.seed = 0;
        this.rng = Math.random;
        this.sortBySuit = false;
        this.phase = 'idle';
        this.supportCursor = 0;
        this.kingdomCursor = 0;
        this.handCursor = 0;
        this.handScroll = 0;
        this.discardMarked = new Set();
        this.swapCursor = 1;
        this.swapTargets = [];
        this.swapSource = null;
        this.dialog = null;
        this.anims = new Set();
        this.batch = 0;
        this.disposed = false;
        this.animating = false;
        this.dealing = false;
        this.hiddenHand = new Set();
        this.hiddenKingdoms = new Set();
        this.hiddenTopic = false;
        this.hiddenAlly = null;
        this.topicDisplay = null;
        this.status = '';
    }

    start(seed) {
        if (this.disposed) return;
        this.stopAnimations();
        this.sortBySuit = false;
        this.seed = seed == null ? Math.floor(Math.random() * (SEED_MAX + 1)) : seed;
        this.rng = mulberry32(this.seed);
        this.state = createGame(this.rng);
        this.phase = 'dealing';
        this.kingdomCursor = 0;
        this.handCursor = 0;
        this.handScroll = 0;
        this.discardMarked.clear();
        this.swapCursor = 1;
        this.swapTargets = [];
        this.swapSource = null;
        this.topicDisplay = null;
        this.status = '抽出 8 張牌，選擇要拜訪的王國。';
        this.dealHand(() => {
            if (this.disposed) return;
            this.phase = 'selectKingdom';
            this.ensureKingdomCursor();
            this.handCursor = 0;
            this.handScroll = 0;
            this.status = '選擇要拜訪的王國。';
            this.draw();
        });
    }

    dealHand(done) {
        if (this.disposed || !this.state) return;
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        const count = this.state.hand.length;
        this.phase = 'dealing';
        this.dealing = count > 0;
        this.handCursor = 0;
        this.handScroll = 0;
        this.hiddenHand = new Set(this.state.hand.map((_, index) => index));
        this.draw();
        if (!count) {
            this.dealing = false;
            done();
            return;
        }
        this.dealing = true;
        staggerFlights(this.anims, {
            count,
            isActive: active,
            nextAt: (_step, ratio) => ratio >= 0.35,
            start: (index, { onStep, onLand }) => dealCard(
                this.cmd, this.state.hand[index], DECK, handPosition(index, 0),
                { onStep }, () => { if (active()) onLand(); },
            ),
            land: index => {
                this.hiddenHand.delete(index);
                this.draw();
            },
            done: () => {
                if (!active()) return;
                this.dealing = false;
                this.hiddenHand.clear();
                this.draw();
                done();
            },
        });
    }

    draw() {
        if (!this.disposed && this.state) this.view.draw(this);
    }

    key(data) {
        if (this.disposed) return;
        const key = normalizeKey(data);
        if (!key) return;
        if (this.dealing || this.animating) {
            if (key === 'q' || key === 'Q' || key === 'Escape') return this.cmd._confirmQuit();
            return;
        }
        if ((key === 's' || key === 'S') && !this.dialog &&
            ['selectKingdom', 'between', 'debate', 'discardTwo'].includes(this.phase)) return this.sortHand();
        if (this.phase === 'won' || this.phase === 'lost') {
            if (key === '\r' || key === '\n') return this.start(this.seed);
            if (key === 'n' || key === 'N') return this.cmd._menu();
            if (key === 'h' || key === 'H') return this.showRules();
            if (key === 'r' || key === 'R') return this.confirmRestart();
            if (key === 'q' || key === 'Q' || key === 'Escape') return this.cmd._confirmQuit();
            return;
        }
        if (key === 'q' || key === 'Q') return this.cmd._confirmQuit();
        if (key === 'Escape') {
            if (this.phase === 'swap') return this.cancelSwap();
            if (this.phase === 'discardTwo') {
                this.discardMarked.clear();
                this.status = '已取消棄牌選擇。';
                this.draw();
                return;
            }
            return this.cmd._confirmQuit();
        }
        if (key === 'h' || key === 'H') return this.showRules();
        if (key === 'n' || key === 'N') return this.cmd._menu();
        if (key === 'r' || key === 'R') return this.confirmRestart();
        if (this.phase === 'selectKingdom') return this.keySelectKingdom(key);
        if (this.phase === 'between') return this.keyBetween(key);
        if (this.phase === 'debate') return this.keyDebate(key);
        if (this.phase === 'swap') return this.keySwap(key);
        if (this.phase === 'discardTwo') return this.keyDiscardTwo(key);
    }

    keySelectKingdom(key) {
        if (key === 'ArrowLeft' || key === 'ArrowUp') return this.moveKingdom(-1);
        if (key === 'ArrowRight' || key === 'ArrowDown') return this.moveKingdom(1);
        if (key === 'Home') return this.moveKingdomToEdge(false);
        if (key === 'End') return this.moveKingdomToEdge(true);
        if (key === '\r' || key === '\n') return this.chooseKingdom();
    }

    sortHand() {
        const old = this.state.hand;
        const sorted = [...old].sort(this.sortBySuit
            ? (a, b) => a.suit - b.suit || a.rank - b.rank
            : (a, b) => a.rank - b.rank || a.suit - b.suit);
        this.sortBySuit = !this.sortBySuit;
        if (sorted.every((card, i) => card === old[i])) return;
        const cursor = Math.max(0, sorted.indexOf(old[this.handCursor]));
        const marked = new Set([...this.discardMarked].map(i => old[i]));
        let scroll = this.handScroll;
        if (['debate', 'discardTwo'].includes(this.phase))
            scroll = Math.min(cursor, Math.max(scroll, cursor - VISIBLE_HAND + 1));
        scroll = Math.max(0, Math.min(scroll, Math.max(0, sorted.length - VISIBLE_HAND)));
        const batch = this.batch;
        this.animating = true;
        this.draw();
        const cancel = sortHandAnimation(this, sorted, scroll, () => {
            if (this.disposed || batch !== this.batch) return;
            this.anims.delete(cancel);
            this.state.hand = sorted;
            this.handCursor = cursor;
            this.handScroll = scroll;
            this.discardMarked = new Set(sorted.flatMap((card, i) => marked.has(card) ? [i] : []));
            this.animating = false;
            this.draw();
        });
        this.anims.add(cancel);
    }

    keyBetween(key) {
        if (key === 'a' || key === 'A') return this.openAbilities();
        const choices = [{ slot: 0 }, ...availableAbilities(this.state).map(entry => ({
            slot: entry.type === 'advisor' ? entry.index + 1 : entry.index + 5, entry,
        }))].sort((a, b) => a.slot - b.slot);
        let index = Math.max(0, choices.findIndex(choice => choice.slot === this.supportCursor));
        if (['ArrowLeft', 'ArrowUp'].includes(key)) index = (index + choices.length - 1) % choices.length;
        else if (['ArrowRight', 'ArrowDown'].includes(key)) index = (index + 1) % choices.length;
        else if (key === 'Home') index = 0;
        else if (key === 'End') index = choices.length - 1;
        else if (key === 'PageUp' || key === 'PageDown') {
            this.handScroll = Math.max(0, Math.min(Math.max(0, this.state.hand.length - VISIBLE_HAND),
                this.handScroll + (key === 'PageUp' ? -VISIBLE_HAND : VISIBLE_HAND)));
            this.draw();
            return;
        } else if (key === '\r' || key === '\n') {
            const choice = choices[index];
            return choice.entry ? this.useAbility(choice.entry) : this.revealTopicCard();
        } else return;
        this.supportCursor = choices[index].slot;
        this.draw();
    }

    keyDebate(key) {
        const legal = new Set(legalIndices(this.state));
        if (key === 'Home') return this.moveHandToEdge(false, legal);
        if (key === 'End') return this.moveHandToEdge(true, legal);
        if (key === 'ArrowLeft' || key === 'ArrowUp') return this.moveLegalHand(-1, legal);
        if (key === 'ArrowRight' || key === 'ArrowDown') return this.moveLegalHand(1, legal);
        if (key === '\r' || key === '\n') return this.playSelected();
    }

    keySwap(key) {
        if (!this.swapTargets.length) return this.cancelSwap();
        if (key === 'ArrowLeft' || key === 'ArrowUp') return this.moveSwap(-1);
        if (key === 'ArrowRight' || key === 'ArrowDown') return this.moveSwap(1);
        if (key === 'Home') return this.setSwapEdge(false);
        if (key === 'End') return this.setSwapEdge(true);
        if (key === '\r' || key === '\n') return this.commitSwap();
    }

    keyDiscardTwo(key) {
        if (key === ' ') {
            if (!this.state.hand.length) return;
            if (this.discardMarked.has(this.handCursor)) {
                this.discardMarked.delete(this.handCursor);
            } else {
                if (this.discardMarked.size >= Math.min(2, this.state.hand.length)) {
                    this.status = '最多標記 2 張。';
                    this.draw();
                    return;
                }
                this.discardMarked.add(this.handCursor);
            }
            this.draw();
            return;
        }
        if (key === 'ArrowLeft' || key === 'ArrowUp') return this.moveHand(-1);
        if (key === 'ArrowRight' || key === 'ArrowDown') return this.moveHand(1);
        if (key === 'Home') return this.moveHandToEdge(false);
        if (key === 'End') return this.moveHandToEdge(true);
        if (key === '\r' || key === '\n') return this.commitDiscard();
    }

    moveKingdom(direction) {
        const count = this.state.kingdoms.length;
        for (let step = 1; step <= count; step++) {
            const index = ((this.kingdomCursor + direction * step) % count + count) % count;
            if (!this.state.kingdoms[index].visited) {
                this.kingdomCursor = index;
                this.draw();
                return;
            }
        }
    }

    moveKingdomToEdge(last) {
        const indexes = this.state.kingdoms
            .map((kingdom, index) => ({ kingdom, index }))
            .filter(entry => !entry.kingdom.visited)
            .map(entry => entry.index);
        if (!indexes.length) return;
        this.kingdomCursor = last ? indexes[indexes.length - 1] : indexes[0];
        this.draw();
    }

    ensureKingdomCursor() {
        if (this.state.kingdoms[this.kingdomCursor] && !this.state.kingdoms[this.kingdomCursor].visited) return;
        const index = this.state.kingdoms.findIndex(kingdom => !kingdom.visited);
        this.kingdomCursor = index >= 0 ? index : 0;
    }

    chooseKingdom() {
        const kingdom = this.state.kingdoms[this.kingdomCursor];
        if (!kingdom || kingdom.visited) return;
        if (!startKingdom(this.state, kingdom.slot)) return;
        this.phase = 'between';
        this.supportCursor = 0;
        this.handCursor = 0;
        this.handScroll = 0;
        this.discardMarked.clear();
        this.topicDisplay = null;
        this.status = `王國 ${kingdom.slot}：需剛好贏 ${kingdom.slot} 場辯論。`;
        this.ensureHandBounds();
        this.draw();
    }

    moveHand(direction) {
        if (!this.state.hand.length) return;
        this.handCursor = Math.max(0, Math.min(this.state.hand.length - 1, this.handCursor + direction));
        this.ensureHandScroll();
        this.draw();
    }

    moveHandToEdge(last, allowed = null) {
        if (!this.state.hand.length) return;
        if (!allowed) {
            this.handCursor = last ? this.state.hand.length - 1 : 0;
        } else {
            const indexes = this.state.hand
                .map((_, index) => index)
                .filter(index => allowed.has(index));
            if (!indexes.length) return;
            this.handCursor = last ? indexes[indexes.length - 1] : indexes[0];
        }
        this.ensureHandScroll();
        this.draw();
    }

    moveLegalHand(direction, legal) {
        if (!this.state.hand.length) return;
        let next = this.handCursor + direction;
        while (next >= 0 && next < this.state.hand.length && !legal.has(next)) next += direction;
        if (next < 0 || next >= this.state.hand.length) return;
        this.handCursor = next;
        this.ensureHandScroll();
        this.draw();
    }

    moveSwap(direction) {
        const index = this.swapTargets.indexOf(this.swapCursor);
        if (index < 0) return;
        const next = (index + direction + this.swapTargets.length) % this.swapTargets.length;
        this.swapCursor = this.swapTargets[next];
        this.draw();
    }

    setSwapEdge(last) {
        if (!this.swapTargets.length) return;
        this.swapCursor = last ? this.swapTargets[this.swapTargets.length - 1] : this.swapTargets[0];
        this.draw();
    }

    ensureHandScroll() {
        const count = this.state.hand.length;
        const maxScroll = Math.max(0, count - VISIBLE_HAND);
        this.handScroll = Math.max(0, Math.min(maxScroll, this.handScroll));
        if (this.handCursor < this.handScroll) this.handScroll = this.handCursor;
        else if (this.handCursor >= this.handScroll + VISIBLE_HAND)
            this.handScroll = this.handCursor - VISIBLE_HAND + 1;
        this.handScroll = Math.max(0, Math.min(maxScroll, this.handScroll));
    }

    ensureHandBounds() {
        const count = this.state.hand.length;
        this.handCursor = count ? Math.max(0, Math.min(count - 1, this.handCursor)) : 0;
        this.ensureHandScroll();
    }

    revealTopicCard() {
        if (!this.state.topic) {
            const card = revealTopic(this.state, this.rng);
            if (!card) {
                this.status = '牌堆與棄牌堆已無牌，直接結算本國。';
                this.draw();
                this.settle();
                return;
            }
            this.phase = 'transition';
            this.animating = true;
            this.hiddenTopic = true;
            this.topicDisplay = null;
            this.status = '統治者提出話題…';
            this.draw();
            this.flyCard(card, DECK, TOPIC, { faceUp: true }, () => {
                this.animating = false;
                this.hiddenTopic = false;
                this.topicDisplay = card;
                this.phase = 'debate';
                const legal = legalIndices(this.state);
                if (legal.length) this.handCursor = legal[0];
                this.ensureHandScroll();
                this.status = '';
                this.draw();
            });
        }
    }

    playSelected() {
        if (!this.state.topic || !this.state.hand.length) return;
        if (!canPlay(this.state, this.handCursor)) {
            this.status = '必須跟隨話題花色。';
            this.draw();
            return;
        }
        const card = this.state.hand[this.handCursor];
        const from = handPosition(this.handCursor, this.handScroll);
        const result = playDebate(this.state, this.handCursor);
        if (!result) return;
        const required = requiredWins(this.state);
        this.phase = 'transition';
        this.animating = true;
        this.topicDisplay = result.topic;
        this.status = result.win
            ? `贏得辯論！目前 ${this.state.wins} / ${required} 勝。`
            : `輸掉辯論。目前 ${this.state.wins} / ${required} 勝。`;
        this.ensureHandBounds();
        this.draw();
        this.flyCard(card, from, result.win ? SCORING : DISCARD, { faceUp: true }, () => {
            this.animating = false;
            this.topicDisplay = null;
            if (!this.state.hand.length) {
                this.settle();
                return;
            }
            this.phase = 'between';
        this.supportCursor = 0;
            this.ensureHandBounds();
            this.status = result.win
                ? `贏得辯論！目前 ${this.state.wins} / ${required} 勝。`
                : `輸掉辯論。目前 ${this.state.wins} / ${required} 勝。`;
            this.draw();
        });
    }

    settle() {
        if (!this.state) return;
        const kingdomIndex = this.state.current - 1;
        const from = kingdomIndex >= 0 ? kingdomPosition(kingdomIndex) : null;
        const result = settleKingdom(this.state, this.rng);
        if (!result) return;
        this.phase = 'transition';
        this.animating = true;
        this.topicDisplay = null;
        this.hiddenTopic = false;
        this.hiddenHand = new Set(this.state.hand.map((_, index) => index));
        const allyIndex = result.result === 'lost' ? -1 : this.state.allies.length - 1;
        this.hiddenAlly = allyIndex >= 0 ? allyIndex : null;
        this.status = result.result === 'lost' ? '未達必要勝場…' : '王國已征服！';
        this.draw();

        const finish = () => {
            this.animating = false;
            this.hiddenAlly = null;
            if (result.result === 'lost') {
                this.phase = 'lost';
                this.status = '';
                this.draw();
                this.showResult(result);
                return;
            }
            if (result.result === 'won') {
                this.phase = 'won';
                this.status = '';
                this.draw();
                this.showResult(result);
                return;
            }
            this.phase = 'between';
        this.supportCursor = 0;
            this.draw();
            this.showKingdomResult(result);
        };

        if (result.result === 'lost' || !result.ruler || !from) {
            finish();
            return;
        }
        this.flyCard(result.ruler, from, allyPosition(allyIndex), { faceUp: true }, finish);
    }

    flyCard(card, from, to, options, done) {
        const batch = this.batch;
        let cancel;
        cancel = dealCard(this.cmd, card, from, to, options, () => {
            if (this.disposed || batch !== this.batch) return;
            this.anims.delete(cancel);
            done();
        });
        this.anims.add(cancel);
        return cancel;
    }

    openAbilities() {
        if (this.phase !== 'between' || this.state.topic) return;
        const list = availableAbilities(this.state);
        if (!list.length) {
            this.status = '本國已無可用的顧問或盟友能力。';
            this.draw();
            return;
        }
        const options = list.map(entry => ({
            label: `${cardName(entry.card)} ${ABILITY_LABEL[entry.ability]}`,
            description: entry.type === 'advisor' ? '顧問' : '盟友',
        }));
        this.dialog = this.cmd.openDialog(SelectDialog, 'emissary-abilities', {
            title: '使用能力',
            layout: 'list',
            width: 46,
            options,
            onSelect: index => {
                this.dialog = null;
                this.useAbility(list[index]);
            },
            onCancel: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    useAbility(entry) {
        if (!entry || this.phase !== 'between' || this.state.topic) return;
        const source = { type: entry.type, index: entry.index };
        const beforeScroll = this.handScroll;
        const result = beginAbility(this.state, source, this.rng);
        if (!result) {
            this.status = '這個能力目前無法使用。';
            this.draw();
            return;
        }
        if (result.needsTarget) {
            if (!result.targets.length) {
                const committed = commitSpades(this.state, source, null);
                if (!committed) return;
                this.status = '政治：最後一個王國沒有可交換的統治者（能力已消耗）。';
                this.phase = 'between';
        this.supportCursor = 0;
                this.draw();
                return;
            }
            this.swapSource = source;
            this.swapTargets = result.targets;
            this.swapCursor = result.targets[0];
            this.phase = 'swap';
            this.status = '政治：選擇要交換統治者的未訪問王國。';
            this.draw();
            return;
        }
        this.finishAbility(result, beforeScroll);
    }

    finishAbility(result, beforeScroll) {
        if (this.disposed) return;
        const moves = [];
        if (result.ability === 'hearts') {
            for (const entry of result.discarded)
                moves.push({
                    card: entry.card,
                    from: handPosition(entry.index, beforeScroll),
                    to: DISCARD,
                    options: { faceUp: true },
                });
        } else if (result.drawn.length) {
            this.handScroll = Math.max(0, this.state.hand.length - VISIBLE_HAND);
            result.drawn.forEach((card, index) => {
                const handIndex = result.indices[index];
                this.hiddenHand.add(handIndex);
                moves.push({
                    card,
                    from: DECK,
                    to: handPosition(handIndex, this.handScroll),
                    options: { faceUp: false },
                    onLand: () => this.hiddenHand.delete(handIndex),
                });
            });
        }
        this.phase = 'transition';
        this.runFlights(moves, {
            done: () => {
                if (this.disposed) return;
                this.hiddenHand.clear();
                if (!this.state.hand.length) {
                    this.settle();
                    return;
                }
                if (result.ability === 'diamonds') {
                    this.discardMarked.clear();
                    this.ensureHandBounds();
                    this.phase = 'discardTwo';
                    const need = Math.min(2, this.state.hand.length);
                    this.status = `抽了 ${result.drawn.length} 張；請選 ${need} 張棄掉。`;
                    this.draw();
                    return;
                }
                this.phase = 'between';
        this.supportCursor = 0;
                this.ensureHandBounds();
                if (result.ability === 'hearts') {
                    this.status = result.discarded.length
                        ? `棄掉 ${result.discarded.length} 張王牌。`
                        : '手牌中沒有王牌。';
                } else {
                    this.status = `抽了 ${result.drawn.length} 張牌。`;
                }
                this.draw();
            },
        });
    }

    cancelSwap() {
        this.swapSource = null;
        this.swapTargets = [];
        this.phase = 'between';
        this.supportCursor = 0;
        this.status = '已取消交換，能力沒有消耗。';
        this.draw();
    }

    commitSwap() {
        const source = this.swapSource;
        if (!source) return;
        const fromIndex = this.state.current - 1, toIndex = this.swapCursor - 1;
        const fromRuler = this.state.kingdoms[fromIndex]?.ruler;
        const toRuler = this.state.kingdoms[toIndex]?.ruler;
        const result = commitSpades(this.state, source, this.swapCursor);
        if (!result) {
            this.status = '無法交換這個王國。';
            this.draw();
            return;
        }
        this.swapSource = null;
        this.swapTargets = [];
        if (!result.swapped || !fromRuler || !toRuler) {
            this.phase = 'between';
        this.supportCursor = 0;
            this.status = '政治：沒有交換任何統治者。';
            this.draw();
            return;
        }
        this.hiddenKingdoms.add(fromIndex);
        this.hiddenKingdoms.add(toIndex);
        this.phase = 'transition';
        this.runFlights([
            {
                card: fromRuler, from: kingdomPosition(fromIndex), to: kingdomPosition(toIndex),
                options: { faceUp: true },
            },
            {
                card: toRuler, from: kingdomPosition(toIndex), to: kingdomPosition(fromIndex),
                options: { faceUp: true },
            },
        ], {
            simultaneous: true,
            done: () => {
                if (this.disposed) return;
                this.hiddenKingdoms.delete(fromIndex);
                this.hiddenKingdoms.delete(toIndex);
                this.phase = 'between';
        this.supportCursor = 0;
                this.status = '政治：兩國交換了統治者，王牌花色也隨之改變。';
                this.draw();
            },
        });
    }

    commitDiscard() {
        const need = Math.min(2, this.state.hand.length);
        if (this.discardMarked.size !== need) {
            this.status = `請標記 ${need} 張要棄掉的牌。`;
            this.draw();
            return;
        }
        const beforeScroll = this.handScroll;
        const discarded = discardCards(this.state, [...this.discardMarked]);
        if (!discarded) return;
        this.discardMarked.clear();
        const moves = discarded.map(entry => ({
            card: entry.card,
            from: handPosition(entry.index, beforeScroll),
            to: DISCARD,
            options: { faceUp: true },
        }));
        this.phase = 'transition';
        this.runFlights(moves, {
            done: () => {
                if (this.disposed) return;
                if (!this.state.hand.length) {
                    this.settle();
                    return;
                }
                this.phase = 'between';
        this.supportCursor = 0;
                this.ensureHandBounds();
                this.status = `已棄掉 ${discarded.length} 張牌。`;
                this.draw();
            },
        });
    }

    runFlights(moves, { done = () => {}, simultaneous = false } = {}) {
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        this.animating = moves.length > 0;
        this.draw();
        if (!moves.length) {
            this.animating = false;
            done();
            return;
        }
        const finish = () => {
            if (!active()) return;
            this.animating = false;
            this.draw();
            done();
        };
        if (simultaneous) {
            let landed = 0;
            for (const move of moves) {
                let cancel;
                cancel = dealCard(
                    this.cmd, move.card, move.from, move.to, { ...move.options },
                    () => {
                        if (!active()) return;
                        this.anims.delete(cancel);
                        move.onLand?.();
                        this.draw();
                        if (++landed === moves.length) finish();
                    },
                );
                this.anims.add(cancel);
            }
            return;
        }
        staggerFlights(this.anims, {
            count: moves.length,
            isActive: active,
            start: (index, { onStep, onLand }) => dealCard(
                this.cmd, moves[index].card, moves[index].from, moves[index].to,
                { ...moves[index].options, onStep },
                () => { if (active()) onLand(); },
            ),
            land: index => {
                moves[index].onLand?.();
                this.draw();
            },
            done: finish,
        });
    }

    showRules() {
        const message = [
            '你是年輕使節，走訪八個王國，透過辯論爭取統治者的支持。',
            '',
            '王國底色：原色＝未拜訪、藍＝目前、綠＝已征服、紅＝拜訪失敗。',
            '・王國由左至右編號 1–8；每個王國必須「剛好」贏得等於編號的辯論次數。',
            '・統治者的花色是該王國的王牌。A 最小，K 最大；必須跟隨話題花色，除非手上沒有。',
            '・同花色較大者勝；話題不是王牌時，出王牌也勝。贏牌進得分堆，輸牌與話題進棄牌堆。',
            '・手牌用完時立刻結算：勝場不等於王國編號就失敗。',
            '',
            '顧問（J）每王國可用一次；♥ 棄掉所有王牌、♣ 每張梅花抽 1 張、♠ 與未訪問王國交換統治者、♦ 抽 2 棄 2。',
            '征服王國後，該統治者成為盟友（K/Q），之後可各使用一次能力；已使用的盟友不再計分。',
            '八國全部征服即勝利。得分 = 征服王國數 + 未使用的盟友數，最高 16。',
            '',
            '翻話題前：方向鍵選翻牌／顧問／盟友，Enter 執行；A 開能力選單。',
            'S 排序：交替依點數／花色排序，保留選取與棄牌標記。',
            '手牌超過一排時，可用 PgUp/PgDn 瀏覽；翻話題後才選出牌。',
            '牌堆耗盡時會洗回棄牌堆；能力只能在翻開下一張話題牌之前使用。',
            '',
            '規則來源：Wil Su《Isaludo》Beta 1.11，The Emissary（p.47–52）。',
        ].join('\n');
        this.dialog = this.cmd.openDialog(ShowDialog, 'emissary-rules', {
            title: '使節 The Emissary — 規則',
            width: 72,
            message,
            footer: 'PgUp/PgDn 捲動　Enter / Esc 返回',
            onExit: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    confirmRestart() {
        this.dialog = this.cmd.openDialog(SelectDialog, 'emissary-restart', {
            title: '選擇重玩方式',
            width: 40,
            options: ['相同種子', '新隨機種子', '取消'],
            selectedIndex: 0,
            onSelect: index => {
                this.dialog = null;
                if (index === 0) this.start(this.seed);
                else if (index === 1) this.start();
                else this.draw();
            },
            onCancel: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    showKingdomResult(result) {
        const remaining = this.state.kingdoms
            .filter(kingdom => !kingdom.visited)
            .map(kingdom => kingdom.slot);
        const message = [
            `必要勝場：${result.required}　實際勝場：${result.wins}`,
            `獲得統治者 ${cardName(result.ruler)}，之後可以一次性使用其能力。`,
            '',
            remaining.length
                ? `下一個王國的手牌已抽好；剩餘王國：${remaining.join('、')}。`
                : '所有王國都已訪問。',
            '',
            'Enter / Esc 繼續。',
        ].join('\n');
        this.dialog = this.cmd.openDialog(ShowDialog, 'emissary-kingdom', {
            title: `王國 ${result.slot} 已征服`,
            width: 62,
            message,
            footer: 'Enter / Esc 繼續',
            onExit: () => {
                this.dialog = null;
                this.startNextKingdom();
            },
            onAbort: () => this.cmd._quit(),
        });
    }

    showResult(result) {
        const state = this.state;
        const conquered = state.kingdoms.filter(kingdom => kingdom.conquered).length;
        const unused = state.allies.filter(ally => !ally.spent).length;
        const message = [
            result.result === 'won'
                ? '八個王國都接受了你的使節。'
                : `王國 ${result.slot} 只贏了 ${result.wins} 場，需要 ${result.required} 場。`,
            '',
            `得分：${state.score} / 16`,
            `征服王國：${conquered} / 8　未用盟友：${unused}`,
            `種子：${this.seed}`,
            '',
            'Enter / Esc 關閉；之後可按 Enter 以同一個種子重玩。',
        ].join('\n');
        this.dialog = this.cmd.openDialog(ShowDialog, 'emissary-result', {
            title: result.result === 'won' ? '勝利 — 八國歸心' : '外交失敗',
            width: 60,
            message,
            footer: 'Enter / Esc 關閉',
            onExit: () => { this.dialog = null; this.draw(); },
            onAbort: () => this.cmd._quit(),
        });
    }

    startNextKingdom() {
        if (this.disposed) return;
        this.phase = 'dealing';
        this.status = '抽出 8 張牌，選擇下一個王國。';
        this.topicDisplay = null;
        this.discardMarked.clear();
        this.swapSource = null;
        this.swapTargets = [];
        this.hiddenTopic = false;
        this.hiddenAlly = null;
        this.dealHand(() => {
            if (this.disposed) return;
            this.phase = 'selectKingdom';
            this.ensureKingdomCursor();
            this.handCursor = 0;
            this.handScroll = 0;
            this.status = '選擇下一個要拜訪的王國。';
            this.draw();
        });
    }

    stopAnimations() {
        this.batch++;
        for (const cancel of this.anims) cancel();
        this.anims.clear();
        this.animating = false;
        this.dealing = false;
        this.hiddenHand.clear();
        this.hiddenKingdoms.clear();
        this.hiddenTopic = false;
        this.hiddenAlly = null;
        this.topicDisplay = null;
    }

    dispose() {
        if (this.disposed) return;
        this.stopAnimations();
        this.disposed = true;
        if (this.dialog) {
            this.dialog.close();
            this.dialog = null;
        }
        this.state = null;
        this.cmd = null;
    }
}
