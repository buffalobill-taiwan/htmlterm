import { dealCard, staggerFlights } from '../animation.js';
import { slideCards } from './animation.js';
import {
    createGame, dealInitialEnemyRow, returnInitialCombatants, compactEnemyRow, refillEnemyRow,
    discardFromHand, drawToFour, capture, yieldToEnemy, sacrifice, outcome, hasSafeAction,
} from './rules.js';
import {
    CaptureView, CARD_X, ENEMY_DECK, ENEMY_CAPTURE, PERSONAL_DECK, PERSONAL_DISCARD,
    enemyPosition, handPosition, deckBottom,
} from './view.js';

const rowArea = { x: CARD_X[0], y: 4, w: CARD_X[3] - CARD_X[0] + 5, h: 3 };
const handArea = { x: CARD_X[0], y: 14, w: CARD_X[3] - CARD_X[0] + 5, h: 3 };

function copyState(state) {
    return {
        ...state,
        personalDeck: [...state.personalDeck],
        personalDiscard: [...state.personalDiscard],
        hand: [...state.hand],
        enemyDeck: [...state.enemyDeck],
        enemyRow: [...state.enemyRow],
        enemyCapture: [...state.enemyCapture],
    };
}

export class CaptureGame {
    constructor(cmd) {
        this.cmd = cmd;
        this.view = new CaptureView();
        this.state = null;
        this.visualState = null;
        this.phase = 'discard';
        this.result = null;
        this.status = '';
        this.handCursor = 0;
        this.rowCursor = 0;
        this.focus = 'row';
        this.action = 'capture';
        this.marked = new Set();
        this.selection = new Set();
        this.hiddenHand = new Set();
        this.hiddenRow = new Set();
        this.anims = new Set();
        this.cancelSlide = null;
        this.batch = 0;
        this.animating = false;
        this.disposed = false;
        this.initialHandDealt = false;
    }

    start() {
        this.stopAnimations();
        this.disposed = false;
        this.state = createGame();
        this.visualState = copyState(this.state);
        this.phase = 'discard';
        this.result = null;
        this.status = '發牌中…';
        this.handCursor = 0;
        this.rowCursor = 0;
        this.focus = 'row';
        this.action = 'capture';
        this.marked.clear();
        this.selection.clear();
        this.initialHandDealt = false;

        const next = copyState(this.state);
        const dealt = dealInitialEnemyRow(next);
        this.runFlights(dealt.map(({ card, index }) => ({
            card, index, from: ENEMY_DECK, to: enemyPosition(index),
        })), {
            onStart: () => { this.visualState.enemyDeck.pop(); },
            onLand: move => { this.visualState.enemyRow[move.index] = move.card; },
            done: () => {
                this.state = next;
                this.visualState = null;
                this.returnSetupCombatants();
            },
        });
    }

    returnSetupCombatants() {
        const next = copyState(this.state);
        const returned = returnInitialCombatants(next);
        if (!returned.length) {
            this.state = next;
            this.advanceRound();
            return;
        }

        this.visualState = copyState(this.state);
        this.hiddenRow.clear();
        this.status = '歸還首領牌…';
        const baseCount = this.visualState.enemyDeck.length;
        this.runFlights(returned.map(({ card, index }, slot) => ({
            card, index, from: enemyPosition(index),
            to: deckBottom(ENEMY_DECK, baseCount + slot + 1),
            options: { faceDown: true, duration: 220 },
        })), {
            onStart: move => { this.hiddenRow.add(move.index); },
            onLand: move => { this.visualState.enemyDeck.unshift(move.card); },
            done: () => {
                this.state = next;
                this.visualState = null;
                this.hiddenRow.clear();
                this.advanceRound();
            },
        });
    }

    advanceRound() {
        const before = copyState(this.state);
        const next = copyState(this.state);
        next.round++;
        const moved = compactEnemyRow(next);
        if (moved.length) {
            const slides = [];
            let toIndex = 0;
            for (let fromIndex = 0; fromIndex < before.enemyRow.length; fromIndex++) {
                const card = before.enemyRow[fromIndex];
                if (!card) continue;
                slides.push({
                    card,
                    fromX: CARD_X[3 - fromIndex] - rowArea.x,
                    toX: CARD_X[3 - toIndex] - rowArea.x,
                });
                toIndex++;
            }
            this.visualState = before;
            this.status = '整理敵方隊列…';
            this.animateSlide(slides, rowArea, () => {
                this.state = next;
                this.visualState = null;
                this.refillRow();
            });
        } else {
            this.state = next;
            this.refillRow();
        }
    }

    refillRow() {
        const next = copyState(this.state);
        const arrivals = refillEnemyRow(next);
        if (!arrivals.length) {
            this.state = next;
            this.beginPlayerTurn();
            return;
        }

        this.visualState = copyState(this.state);
        this.status = '補充敵方隊列…';
        this.runFlights(arrivals.map(({ card, index }) => ({
            card, index, from: ENEMY_DECK, to: enemyPosition(index),
        })), {
            onStart: () => { this.visualState.enemyDeck.pop(); },
            onLand: move => { this.visualState.enemyRow[move.index] = move.card; },
            done: () => {
                this.state = next;
                this.visualState = null;
                this.beginPlayerTurn();
            },
        });
    }

    beginPlayerTurn() {
        if (!this.initialHandDealt) {
            this.initialHandDealt = true;
            const afterDraw = copyState(this.state);
            const drawInfo = drawToFour(afterDraw);
            this.visualState = copyState(this.state);
            this.status = '抽取起始手牌…';
            this.runFlights(drawInfo.drawn.map((card, index) => ({
                card, index, from: PERSONAL_DECK,
                to: handPosition(index),
            })), {
                onStart: () => { this.visualState.personalDeck.pop(); },
                onLand: move => { this.visualState.hand.push(move.card); },
                done: () => {
                    this.state = afterDraw;
                    this.visualState = null;
                    this.enterDiscardPhase();
                },
            });
            return;
        }
        this.enterDiscardPhase();
    }

    enterDiscardPhase() {
        this.phase = 'discard';
        this.focus = 'hand';
        this.action = 'capture';
        this.marked.clear();
        this.selection.clear();
        this.handCursor = Math.min(this.handCursor, Math.max(0, this.state.hand.length - 1));
        this.status = '選擇要棄掉的手牌；可不棄牌。';
        this.draw();
    }

    commitDiscard() {
        const discarded = [...this.marked];
        const oldHand = [...this.state.hand];
        const afterDiscard = copyState(this.state);
        if (!discardFromHand(afterDiscard, discarded)) return;
        const afterDraw = copyState(afterDiscard);
        const drawInfo = drawToFour(afterDraw);
        this.marked.clear();
        this.focus = 'hand';

        this.visualState = copyState(this.state);
        this.hiddenHand.clear();
        if (!discarded.length) {
            this.state = afterDiscard;
            this.visualState = null;
            this.drawCards(afterDiscard, afterDraw, drawInfo);
            return;
        }

        this.status = '棄牌中…';
        this.runFlights(discarded.map(index => ({
            card: oldHand[index], index, from: handPosition(index), to: PERSONAL_DISCARD,
            options: { faceUp: true, duration: 200 },
        })), {
            onStart: move => { this.hiddenHand.add(move.index); },
            onLand: move => { this.visualState.personalDiscard.push(move.card); },
            done: () => this.compactHand(oldHand, discarded, afterDiscard, afterDraw, drawInfo),
        });
    }

    compactHand(oldHand, discarded, afterDiscard, afterDraw, drawInfo) {
        const removed = new Set(discarded);
        const slides = [];
        let toIndex = 0;
        for (let fromIndex = 0; fromIndex < oldHand.length; fromIndex++) {
            if (removed.has(fromIndex)) continue;
            slides.push({
                card: oldHand[fromIndex],
                fromX: CARD_X[fromIndex] - handArea.x,
                toX: CARD_X[toIndex] - handArea.x,
            });
            toIndex++;
        }
        if (!slides.some(move => move.fromX !== move.toX)) {
            this.state = afterDiscard;
            this.visualState = null;
            this.hiddenHand.clear();
            this.drawCards(afterDiscard, afterDraw, drawInfo);
            return;
        }

        this.status = '整理手牌…';
        this.animateSlide(slides, handArea, () => {
            this.state = afterDiscard;
            this.visualState = null;
            this.hiddenHand.clear();
            this.drawCards(afterDiscard, afterDraw, drawInfo);
        });
    }

    drawCards(afterDiscard, afterDraw, drawInfo) {
        if (drawInfo.recycled.length) {
            this.visualState = copyState(afterDiscard);
            this.status = '洗回棄牌堆…';
            this.runFlights(drawInfo.recycled.map((card, index) => ({
                card, index, from: PERSONAL_DISCARD,
                to: deckBottom(PERSONAL_DECK, drawInfo.recycled.length),
                options: { faceDown: true, duration: 220 },
            })), {
                onStart: () => { this.visualState.personalDiscard.pop(); },
                onLand: move => { this.visualState.personalDeck.push(move.card); },
                done: () => {
                    this.visualState.personalDeck = [...drawInfo.recycledDeck];
                    this.visualState.personalDiscard = [];
                    this.drawNewCards(afterDraw, drawInfo);
                },
            });
            return;
        }
        this.visualState = copyState(afterDiscard);
        this.drawNewCards(afterDraw, drawInfo);
    }

    drawNewCards(afterDraw, drawInfo) {
        if (!drawInfo.drawn.length) {
            this.finishDraw(afterDraw);
            return;
        }

        this.status = '抽牌中…';
        this.runFlights(drawInfo.drawn.map((card, index) => ({
            card, index, from: PERSONAL_DECK,
            to: handPosition(afterDraw.hand.length - drawInfo.drawn.length + index),
        })), {
            onStart: () => { this.visualState.personalDeck.pop(); },
            onLand: move => { this.visualState.hand.push(move.card); },
            done: () => this.finishDraw(afterDraw),
        });
    }

    finishDraw(state) {
        this.state = state;
        this.visualState = null;
        this.hiddenHand.clear();
        this.hiddenRow.clear();
        this.phase = 'capture';
        this.action = 'capture';
        this.focus = 'row';
        this.selection.clear();
        this.handCursor = Math.min(this.handCursor, Math.max(0, state.hand.length - 1));
        if (!hasSafeAction(state)) {
            this.result = 'loss';
            this.phase = 'result';
            this.status = '沒有安全行動，遊戲結束。';
        } else {
            this.status = '選擇捕捉、犧牲，或投降。';
        }
        this.draw();
    }

    performCapture() {
        const indices = [...this.selection].sort((a, b) => a - b);
        const next = copyState(this.state);
        const target = next.enemyRow[this.rowCursor];
        if (!target || !capture(next, this.rowCursor, indices)) {
            this.status = '所選手牌必須同花色且點數足夠。';
            this.draw();
            return;
        }
        const targetCard = this.state.enemyRow[this.rowCursor];
        const moves = [{
            card: targetCard, index: this.rowCursor,
            from: enemyPosition(this.rowCursor), to: PERSONAL_DISCARD,
        }, ...indices.map(index => ({
            card: this.state.hand[index], index,
            from: handPosition(index), to: PERSONAL_DISCARD,
            options: { faceUp: true },
        }))];
        this.visualState = copyState(this.state);
        this.hiddenHand.clear();
        this.hiddenRow.clear();
        this.status = '捕捉牌移動中…';
        this.runFlights(moves, {
            onStart: move => {
                if (move.from.y === 4) this.hiddenRow.add(move.index);
                else this.hiddenHand.add(move.index);
            },
            onLand: move => { this.visualState.personalDiscard.push(move.card); },
            done: () => this.finishAction(next),
        });
    }

    performYield() {
        const handIndex = this.selection.size ? [...this.selection][0] : this.handCursor;
        const next = copyState(this.state);
        if (!yieldToEnemy(next, handIndex)) {
            this.status = '投降需要位置 1 的敵牌與一張手牌。';
            this.draw();
            return;
        }
        const target = this.state.enemyRow[0];
        const payment = this.state.hand[handIndex];
        this.visualState = copyState(this.state);
        this.hiddenHand.clear();
        this.hiddenRow.clear();
        this.status = '投降牌移動中…';
        this.runFlights([
            { card: target, index: 0, from: enemyPosition(0), to: ENEMY_CAPTURE },
            { card: payment, index: handIndex, from: handPosition(handIndex), to: ENEMY_CAPTURE, options: { faceUp: true } },
        ], {
            onStart: move => {
                if (move.from.y === 4) this.hiddenRow.add(move.index);
                else this.hiddenHand.add(move.index);
            },
            onLand: move => { this.visualState.enemyCapture.push(move.card); },
            done: () => this.finishAction(next),
        });
    }

    performSacrifice() {
        const indices = [...this.selection].sort((a, b) => a - b);
        const target = this.state.enemyRow[this.rowCursor];
        const next = copyState(this.state);
        if (!target || !sacrifice(next, this.rowCursor, indices)) {
            this.status = '犧牲需要兩張非人頭牌手牌。';
            this.draw();
            return;
        }
        this.visualState = copyState(this.state);
        this.hiddenHand.clear();
        this.hiddenRow.clear();
        this.status = '犧牲牌移動中…';
        const moves = [
            ...indices.map(index => ({
                card: this.state.hand[index], index,
                from: handPosition(index), to: ENEMY_CAPTURE, options: { faceUp: true },
            })),
            {
                card: target, index: this.rowCursor,
                from: enemyPosition(this.rowCursor),
                to: deckBottom(ENEMY_DECK, this.state.enemyDeck.length + 1),
                options: { faceDown: true },
            },
        ];
        this.runFlights(moves, {
            onStart: move => {
                if (move.from.y === 4) this.hiddenRow.add(move.index);
                else this.hiddenHand.add(move.index);
            },
            onLand: move => {
                if (move.from.y === 4) this.visualState.enemyDeck.unshift(move.card);
                else this.visualState.enemyCapture.push(move.card);
            },
            done: () => this.finishAction(next),
        });
    }

    finishAction(state) {
        this.state = state;
        this.visualState = null;
        this.hiddenHand.clear();
        this.hiddenRow.clear();
        this.selection.clear();
        const result = outcome(state);
        if (result) {
            this.result = result;
            this.phase = 'result';
            this.status = result === 'win' ? '敵方牌堆與隊列已清空！' : '人頭牌進入敵方移除堆，遊戲結束。';
            this.draw();
            return;
        }
        this.advanceRound();
    }

    runFlights(moves, { onStart = () => {}, onLand = () => {}, done = () => {} }) {
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        this.animating = moves.length > 0;
        this.draw();
        if (!moves.length) {
            done();
            return;
        }

        staggerFlights(this.anims, {
            count: moves.length,
            isActive: active,
            start: (index, { onStep, onLand: landed }) => {
                const move = moves[index];
                onStart(move, index);
                this.draw();
                const cancel = dealCard(
                    this.cmd, move.card, move.from, typeof move.to === 'function' ? move.to(index) : move.to,
                    { ...move.options, onStep },
                    () => { if (active()) landed(); },
                );
                return cancel;
            },
            land: index => {
                if (!active()) return;
                onLand(moves[index], index);
                this.draw();
            },
            done: () => {
                if (!active()) return;
                this.animating = false;
                this.draw();
                done();
            },
        });
    }

    animateSlide(moves, area, done) {
        if (!moves.length) {
            done();
            return;
        }
        const batch = this.batch;
        this.animating = true;
        this.draw();
        this.cancelSlide = slideCards(this.cmd, moves, area, () => {
            if (this.disposed || batch !== this.batch) return;
            this.cancelSlide = null;
            this.animating = false;
            this.draw();
            done();
        });
    }

    stopAnimations() {
        this.batch++;
        for (const cancel of this.anims) cancel();
        this.anims.clear();
        this.cancelSlide?.();
        this.cancelSlide = null;
        this.animating = false;
        this.visualState = null;
        this.hiddenHand.clear();
        this.hiddenRow.clear();
    }

    key(data) {
        if (this.disposed) return;
        const key = data === '\x1B' ? 'Escape' :
            data === '\x1B[A' ? 'ArrowUp' : data === '\x1B[B' ? 'ArrowDown' :
                data === '\x1B[C' ? 'ArrowRight' : data === '\x1B[D' ? 'ArrowLeft' : data;
        if (key.toLowerCase() === 'q') return this.cmd._quit();
        if (key.toLowerCase() === 'n') return this.cmd._menu();
        if (key === 'Escape') {
            if (this.animating) {
                this.cmd._quit();
            } else if (this.phase === 'discard' && this.marked.size) {
                this.marked.clear();
                this.status = '已取消棄牌選擇。';
                this.draw();
            } else if (this.phase === 'capture' && (this.selection.size || this.action !== 'capture')) {
                this.selection.clear();
                this.action = 'capture';
                this.focus = 'row';
                this.status = '已取消目前選擇。';
                this.draw();
            } else this.cmd._quit();
            return;
        }
        if (this.animating || this.phase === 'result') return;
        if (key.toLowerCase() === 'r') return this.start();

        if (this.phase === 'discard') {
            if (key === '\r' || key === '\n') return this.commitDiscard();
            if (key === ' ' && this.state.hand.length) {
                if (this.marked.has(this.handCursor)) this.marked.delete(this.handCursor);
                else this.marked.add(this.handCursor);
                this.draw();
                return;
            }
            this.moveHand(key);
            return;
        }

        if (key.toLowerCase() === 'c') {
            this.action = 'capture';
            this.focus = 'hand';
            this.draw();
            return;
        }
        if (key.toLowerCase() === 's') {
            this.action = 'sacrifice';
            this.focus = 'hand';
            this.selection.clear();
            this.draw();
            return;
        }
        if (key.toLowerCase() === 'y') return this.performYield();
        if (key === '\t') {
            this.focus = this.focus === 'row' ? 'hand' : 'row';
            this.draw();
            return;
        }
        if (key === ' ' && this.focus === 'row') {
            this.focus = 'hand';
            this.draw();
            return;
        }
        if (key === ' ' && this.focus === 'hand' && this.state.hand.length) {
            if (this.selection.has(this.handCursor)) this.selection.delete(this.handCursor);
            else this.selection.add(this.handCursor);
            this.draw();
            return;
        }
        if (key === '\r' || key === '\n') {
            if (this.focus === 'row') {
                this.focus = 'hand';
                this.draw();
            } else if (this.action === 'capture') this.performCapture();
            else this.performSacrifice();
            return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            this.focus = this.focus === 'row' ? 'hand' : 'row';
            this.draw();
            return;
        }
        if (this.focus === 'row') this.moveRow(key);
        else this.moveHand(key);
    }

    moveHand(key) {
        if (!this.state.hand.length) return;
        if (key === 'ArrowLeft' || key === 'h') this.handCursor = Math.max(0, this.handCursor - 1);
        else if (key === 'ArrowRight' || key === 'l') this.handCursor = Math.min(this.state.hand.length - 1, this.handCursor + 1);
        else return;
        this.draw();
    }

    moveRow(key) {
        if (key === 'ArrowLeft' || key === 'h') this.rowCursor = (this.rowCursor + 1) % 4;
        else if (key === 'ArrowRight' || key === 'l') this.rowCursor = (this.rowCursor + 3) % 4;
        else return;
        this.draw();
    }

    instructions() {
        if (this.animating) return '卡牌移動中…';
        if (this.phase === 'result') return 'R 重玩　N 回選單　Q 離開';
        if (this.phase === 'discard') return '方向鍵選牌　Space 標記棄牌　Enter 確認（可不棄牌）';
        const action = this.action === 'capture' ? '捕捉' : '犧牲';
        return `${this.focus === 'row' ? '選敵牌' : '選手牌'}｜${action}：Space 標記，Enter 執行　C 捕捉　S 犧牲　Y 投降`;
    }

    draw() {
        if (this.state) this.view.draw(this);
    }

    dispose() {
        if (this.disposed) return;
        this.stopAnimations();
        this.disposed = true;
        this.state = null;
        this.cmd = null;
    }
}
