import { dealCard, staggerFlights } from '../animation.js';
import { slideCards } from './animation.js';
import { startBufferAnimation } from '../../../system/RAFAnimationHelper.js';
import { term } from '../../../system/sys.js';
import { VirtualBuffer, _blankCell } from '../../../util/VirtualBuffer.js';
import { markDirtyRows } from '../../../util/drag.js';
import {
    createGame, dealInitialEnemyRow, returnInitialCombatants, compactEnemyRow, refillEnemyRow,
    discardFromHand, drawToFour, capture, yieldToEnemy, sacrifice, outcome, actionAvailability,
} from './rules.js';
import {
    CaptureView, CARD_X, ENEMY_DECK, ENEMY_CAPTURE, PERSONAL_DECK, PERSONAL_DISCARD,
    ACTION_OPTIONS, ACTION_OPTION_LAYOUT, targetCardKey,
    enemyPosition, handPosition, deckBottom, drawBanner,
} from './view.js';

const rowArea = { x: CARD_X[0], y: 4, w: CARD_X[3] - CARD_X[0] + 5, h: 3 };
const handArea = { x: CARD_X[0], y: 14, w: CARD_X[3] - CARD_X[0] + 5, h: 3 };
const BANNER_Y = 9;
const BANNER_HEIGHT = 2;
const BANNER_DURATION = 500;
const BANNER_HOLD = 500;
const BANNER_CENTER_X = 32;
const BANNER_TRAVEL = 48;
const GAME_OVER_HOLD = 800;
const GAME_OVER_DURATION = 2000;
const BLACK_CELL = Object.freeze({
    ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false,
    underline: false, blink: false, inverse: false, conceal: false,
    crossedOut: false, width: 1,
});

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
        this.actionCounts = { captures: 0, sacrifices: 0, yields: 0 };
        this.capturedTargets = new Set();
        this.status = '';
        this.handCursor = 0;
        this.rowCursor = 0;
        this.focus = 'row';
        this.action = 'capture';
        this.actionCursor = 0;
        this.actionAvailability = { capture: false, sacrifice: false, yield: false };
        this.marked = new Set();
        this.selection = new Set();
        this.hiddenHand = new Set();
        this.hiddenRow = new Set();
        this.anims = new Set();
        this.cancelSlide = null;
        this.batch = 0;
        this.animating = false;
        this.bannerText = '';
        this.cancelBanner = null;
        this.cancelGameOver = null;
        this.disposed = false;
        this.initialHandDealt = false;
    }

    start() {
        this.stopAnimations();
        this.disposed = false;
        this.state = createGame();
        this.visualState = copyState(this.state);
        this.phase = 'transition';
        this.result = null;
        this.actionCounts = { captures: 0, sacrifices: 0, yields: 0 };
        this.capturedTargets.clear();
        this.status = '';
        this.bannerText = '遊戲開始';
        this.handCursor = 0;
        this.rowCursor = 0;
        this.focus = 'row';
        this.action = 'capture';
        this.actionCursor = 0;
        this.marked.clear();
        this.selection.clear();
        this.initialHandDealt = false;

        this.animateBanner('敵方階段', () => this.startEnemyPhase(true), BANNER_HOLD);
    }

    startEnemyPhase(initial = false) {
        this.phase = 'enemy';
        this.status = '敵方階段…';
        if (!initial) {
            this.advanceRound();
            return;
        }
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

    animateBanner(nextText, done, holdMs = 0) {
        const fromText = this.bannerText;
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        const scratch = new VirtualBuffer(80, BANNER_HEIGHT);
        let start = null, complete = false;
        const render = (progress, holding = false) => {
            scratch.fill(_blankCell);
            if (holding) {
                drawBanner(scratch, fromText, BANNER_CENTER_X, 0);
            } else {
                const shift = Math.round(BANNER_TRAVEL * progress);
                drawBanner(scratch, fromText, BANNER_CENTER_X - shift, 0);
                drawBanner(scratch, nextText, 80 - shift, 0);
            }
            markDirtyRows(term, BANNER_Y, BANNER_HEIGHT);
        };
        render(0, holdMs > 0);

        this.phase = 'transition';
        this.animating = true;
        this.status = '';
        this.draw();
        const manager = startBufferAnimation(this.cmd,
            (row, col) => scratch.getCell(row, col) || _blankCell,
            ts => {
                if (start === null) start = ts;
                const elapsed = ts - start;
                if (elapsed < holdMs) {
                    render(0, true);
                    return false;
                }
                const progress = Math.min(1, (elapsed - holdMs) / BANNER_DURATION);
                render(progress);
                if (progress >= 1) {
                    complete = true;
                    return true;
                }
                return false;
            }, {
                x: 0, y: BANNER_Y, w: 80, h: BANNER_HEIGHT,
                hideCursor: false, holdBusy: false,
                onCleanup: () => {
                    if (this.cancelBanner === cancel) this.cancelBanner = null;
                    if (!complete || !active()) return;
                    this.bannerText = nextText;
                    this.animating = false;
                    this.draw();
                    done();
                },
            });
        const cancel = () => manager.stop();
        this.cancelBanner = cancel;
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
            this.enterDiscardStage();
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
                this.enterDiscardStage();
            },
        });
    }

    enterDiscardStage() {
        this.animateBanner('棄牌階段', () => this.beginPlayerTurn());
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
        this.animateBanner('行動階段', () => this.enterActionPhase(state));
    }

    enterActionPhase(state) {
        this.actionAvailability = actionAvailability(state);
        const firstAvailable = ACTION_OPTIONS.findIndex(option => this.actionAvailability[option.action]);
        if (firstAvailable < 0) {
            this.startGameOverEffect();
            return;
        }
        this.phase = 'actionOptions';
        this.action = 'capture';
        this.actionCursor = firstAvailable;
        this.focus = 'row';
        this.selection.clear();
        this.handCursor = Math.min(this.handCursor, Math.max(0, state.hand.length - 1));
        this.status = '';
        this.draw();
    }

    selectAction() {
        const selected = ACTION_OPTIONS[this.actionCursor];
        if (!selected || !this.actionAvailability[selected.action]) return;
        this.action = selected.action;
        this.phase = 'capture';
        this.focus = this.action === 'yield' ? 'hand' : 'row';
        this.selection.clear();
        this.status = '';
        this.draw();
    }

    startGameOverEffect() {
        this.phase = 'gameOver';
        this.result = 'loss';
        this.animating = true;
        this.status = '';
        this.draw();

        const { x: positions, y, width, height } = ACTION_OPTION_LAYOUT;
        const cells = [];
        for (const x of positions)
            for (let row = y; row < y + height; row++)
                for (let col = x; col < x + width; col++) cells.push({ row, col });
        for (let i = cells.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cells[i], cells[j]] = [cells[j], cells[i]];
        }

        const scratch = new VirtualBuffer(80, 24);
        const rowChanged = new Uint8Array(height);
        const batch = this.batch;
        const active = () => !this.disposed && batch === this.batch;
        let start = null, blackened = 0, complete = false;
        const manager = startBufferAnimation(this.cmd,
            (row, col) => scratch.getCell(row, col),
            timestamp => {
                if (start === null) start = timestamp;
                const elapsed = timestamp - start;
                if (elapsed < GAME_OVER_HOLD) return false;

                const progress = Math.min(1, (elapsed - GAME_OVER_HOLD) / GAME_OVER_DURATION);
                const nextCount = Math.floor(progress * cells.length);
                rowChanged.fill(0);
                while (blackened < nextCount) {
                    const cell = cells[blackened++];
                    scratch.setCell(cell.row, cell.col, BLACK_CELL);
                    rowChanged[cell.row - y] = 1;
                }
                for (let row = 0; row < height; row++)
                    if (rowChanged[row]) markDirtyRows(term, y + row, 1);

                if (progress >= 1) {
                    complete = true;
                    return true;
                }
                return false;
            }, {
                x: 0, y: 0, w: 80, h: 24,
                hideCursor: false, holdBusy: false,
                onCleanup: () => {
                    if (this.cancelGameOver === cancel) this.cancelGameOver = null;
                    if (!complete || !active()) return;
                    this.animating = false;
                    this.phase = 'gameOverPrompt';
                    this.draw();
                },
            });
        const cancel = () => manager.stop();
        this.cancelGameOver = cancel;
    }

    moveActionCursor(direction) {
        let next = this.actionCursor;
        while (true) {
            next += direction;
            if (next < 0 || next >= ACTION_OPTIONS.length) return;
            if (this.actionAvailability[ACTION_OPTIONS[next].action]) {
                this.actionCursor = next;
                this.draw();
                return;
            }
        }
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
        if (targetCard.rank === 1 || targetCard.rank >= 11)
            this.capturedTargets.add(targetCardKey(targetCard));
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
        if (this.action === 'capture') this.actionCounts.captures++;
        else if (this.action === 'sacrifice') this.actionCounts.sacrifices++;
        else if (this.action === 'yield') this.actionCounts.yields++;
        const result = outcome(state);
        if (result) {
            this.result = result;
            this.phase = result === 'win' ? 'winSummary' : 'result';
            this.status = result === 'win' ? '敵方牌堆與隊列已清空！' : '人頭牌進入敵方移除堆，遊戲結束。';
            this.draw();
            return;
        }
        this.animateBanner('敵方階段', () => this.startEnemyPhase());
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
        this.cancelBanner?.();
        this.cancelBanner = null;
        this.cancelGameOver?.();
        this.cancelGameOver = null;
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
        if (this.phase === 'winSummary') {
            if (key === '\r' || key === '\n') this.start();
            else if (key.toLowerCase() === 'n') this.cmd._menu();
            else if (key.toLowerCase() === 'q' || key === 'Escape') this.cmd._quit();
            return;
        }
        if (this.phase === 'gameOver') return;
        if (this.phase === 'gameOverPrompt') {
            if (key === '\r' || key === '\n') this.start();
            else if (key.toLowerCase() === 'n') this.cmd._menu();
            else if (key.toLowerCase() === 'q' || key === 'Escape') this.cmd._quit();
            return;
        }
        if (key.toLowerCase() === 'q') return this.cmd._quit();
        if (key.toLowerCase() === 'n') return this.cmd._menu();
        if (key === 'Escape') {
            if (this.animating) {
                this.cmd._quit();
            } else if (this.phase === 'discard' && this.marked.size) {
                this.marked.clear();
                this.status = '已取消棄牌選擇。';
                this.draw();
            } else if (this.phase === 'capture') {
                this.selection.clear();
                this.phase = 'actionOptions';
                this.focus = 'row';
                this.status = '';
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

        if (this.phase === 'actionOptions') {
            if (key === 'ArrowLeft') this.moveActionCursor(-1);
            else if (key === 'ArrowRight') this.moveActionCursor(1);
            else if (key === '\r' || key === '\n') this.selectAction();
            return;
        }

        if (this.action === 'yield') {
            if (key === '\t' || key === 'ArrowUp' || key === 'ArrowDown') return;
            if (key === ' ' && this.state.hand.length) {
                if (this.selection.has(this.handCursor)) this.selection.clear();
                else {
                    this.selection.clear();
                    this.selection.add(this.handCursor);
                }
                this.draw();
                return;
            }
            if (key === '\r' || key === '\n') return this.performYield();
            this.moveHand(key);
            return;
        }

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
            else if (this.action === 'sacrifice') this.performSacrifice();
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
        if (this.phase === 'gameOver') return '遊戲結束中…';
        if (this.phase === 'gameOverPrompt') return '按 Enter 開始新遊戲';
        if (this.animating) return '卡牌移動中…';
        if (this.phase === 'result') return 'R 重玩　N 回選單　Q 離開';
        if (this.phase === 'discard') return '方向鍵選牌　Space 標記棄牌　Enter 確認（可不棄牌）';
        if (this.phase === 'actionOptions') return '←→ 選擇行動　Enter 確認';
        if (this.action === 'yield') return '選手牌｜Space 標記，Enter 投降　Esc 返回行動選擇';
        const action = this.action === 'capture' ? '捕獲' : '犧牲';
        const selection = this.focus === 'row' ? '選敵牌' : '選手牌';
        const confirmation = this.focus === 'row' ? 'Enter 選手牌' : 'Enter 執行';
        return `${selection}｜${action}：Space 標記，${confirmation}　Esc 返回行動選擇`;
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
