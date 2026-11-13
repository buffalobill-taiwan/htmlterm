import { RegicideGame } from './regicide/RegicideGame.js';
import { CmdBase } from '../CmdBase.js';
import { defineMetaGetters } from '../meta-getters.js';
import { term } from '../../system/sys.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { GAME_META } from '../game-meta.js';
import { cardBuffer, drawCardStack, stampCard } from './cards.js';
import { flipCard, dealCard } from './animation.js';
import { score, natural, outcome, shuffledDeck } from './blackjack.js';
import { FreeCellGame } from './freecell/FreeCellGame.js';
import { HoldemGame } from './holdem/HoldemGame.js';
import { CaptureGame } from './capture/CaptureGame.js';
import { parseSeed } from '../../util/random.js';
const META = GAME_META.cardgames;
const DECK = { x: 53, y: 8 };

export class CardgamesCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args);
        if (p.hasHelp) return this.showHelp();
        const valid = !p.rest.length || (p.rest[0] === 'capture' && p.rest.length === 1) ||
            (p.rest[0] === 'regicide' && p.rest.length === 1) || (p.rest[0] === 'holdem' && p.rest.length === 1) ||
            (p.rest[0] === 'freecell' && p.rest.length <= 2 && (p.rest.length === 1 || parseSeed(p.rest[1]) !== null));
        if (args.some(a => a.startsWith('-')) || !valid) return this.error('Usage: cardgames [capture | regicide | holdem | freecell [seed]]');
        this.open();
        this._stats = { win: 0, loss: 0, draw: 0 };
        this._anims = new Set();
        this._vb = new VirtualBuffer(80, 23);
        term.write('\x1B[2J\x1B[H\x1B[?25l');
        this.addCleanup(() => {
            this._stopAnims();
            this._disposeGames();
        });
        if (p.rest[0] === 'capture') this._startCapture();
        else if (p.rest[0] === 'regicide') this._startRegicide();
        else if (p.rest[0] === 'holdem') this._startHoldem();
        else if (p.rest.length) this._startFreeCell(p.rest.length === 2 ? Number(p.rest[1]) : undefined);
        else this._menu();
    }
    _startRegicide() { this._regicide = new RegicideGame(this); this._regicide.start(); }
    _startCapture() {
        this._stopAnims();
        this._disposeGames();
        this._capture = new CaptureGame(this);
        this._capture.start();
    }
    _startHoldem() {
        this._stopAnims();
        this._disposeGames();
        this._holdem = new HoldemGame(this);
        this._holdem.start();
    }
    _startFreeCell(seed) {
        this._freecell?.dispose();
        this._freecell = new FreeCellGame(this);
        this._freecell.start(seed);
    }
    _disposeGames() {
        this._regicide?.dispose(); this._regicide = null;
        this._holdem?.dispose(); this._holdem = null;
        this._freecell?.dispose(); this._freecell = null;
        this._capture?.dispose(); this._capture = null;
    }
    handleMouse(type, info) { return this._freecell?.handleMouse(type, info) || false; }
    _menu() {
        this._disposeGames();
        term.write('\x1B[2J');
        this._stopAnims();
        this._flipping = null;
        this._phase = 'menu';
        this._draw();
        this._dialog = this.openDialog(SelectDialog, 'cardgames-menu', {
            title: 'Card Games', layout: 'list', width: 36,
            options: [
                { label: 'Blackjack', description: '二十一點' },
                { label: 'FreeCell', description: '新接龍' },
                { label: 'Texas Hold’em', description: '德州撲克' },
                { label: 'Regicide', description: '弒君者' },
                { label: 'Card Capture', description: '牌張捕獲' },
            ],
            onSelect: index => {
                this._dialog = null;
                if (index === 4) this._startCapture();
                else if (index === 3) this._startRegicide();
                else if (index === 2) this._startHoldem();
                else if (index === 1) this._startFreeCell();
                else this._deal();
            },
            onCancel: () => { this._dialog = null; this._quit(); },
        });
    }
    _stopAnims() {
        this._cancelFlip?.();
        this._cancelFlip = null;
        for (const cancel of this._anims) cancel();
        this._anims.clear();
    }
    _deal() {
        this._stopAnims();
        this._flipping = null;
        this._dealerHidden = true;
        this._deck = shuffledDeck();
        this._player = [];
        this._dealer = [];
        this._choice = 0;
        this._phase = 'dealing';
        this._draw();
        // Deal in concurrent pairs (player + dealer), the dealer's second
        // card landing face down. Natural is judged after all four land.
        const pair = (holeCard, next) => {
            let left = 2;
            const one = () => { if (--left === 0) next(); };
            this._dealCard(this._player, 13, false, one);
            this._dealCard(this._dealer, 6, holeCard, one);
        };
        pair(false, () => pair(true, () => {
            if (natural(this._player) || natural(this._dealer)) this._finish();
            else { this._phase = 'player'; this._draw(); }
        }));
    }
    _dealCard(hand, row, faceDown, done) {
        const card = this._deck.pop();
        const to = { x: 2 + hand.length * 6, y: row };
        this._phase = 'dealing';
        this._draw();
        const finish = () => {
            this._anims.delete(cancel);
            hand.push(card);
            this._draw();
            done();
        };
        const cancel = dealCard(this, card, DECK, to, { faceDown }, finish);
        this._anims.add(cancel);
    }
    _drawDeck() {
        if (!this._deck) return;
        drawCardStack(this._vb, cardBuffer(null), DECK.x, DECK.y);
        this._vb.writeStr(6, DECK.x - 1, '牌堆 ' + this._deck.length);
    }
    _flip(hand, index, row, done) {
        this._phase = 'flipping';
        this._flipping = { hand, index };
        this._draw();
        flipCard(this, hand[index], 2 + index * 6, row, () => {
            this._flipping = null;
            done();
        });
    }
    _stand() {
        if (this._dealerHidden) {
            this._flip(this._dealer, 1, 6, () => {
                this._dealerHidden = false;
                this._stand();
            });
            return;
        }
        if (score(this._dealer) < 17) this._dealCard(this._dealer, 6, false, () => this._stand());
        else this._finish();
    }
    _finish() {
        if (this._dealerHidden) {
            this._flip(this._dealer, 1, 6, () => { this._dealerHidden = false; this._finish(); });
            return;
        }
        this._result = outcome(this._player, this._dealer);
        this._stats[this._result]++;
        this._phase = 'result';
        this._draw();
    }
    _drawHand(hand, row, hidden) {
        hand.forEach((card, i) => {
            const covered = (hidden && i === 1) || (this._flipping?.hand === hand && this._flipping.index === i);
            const face = cardBuffer(covered ? null : card);
            stampCard(this._vb, face, 2 + i * 6, row);
        });
    }
    _draw() {
        const vb = this._vb;
        for (let r = 0; r < 23; r++) vb.writeStr(r, 0, ' '.repeat(80));
        vb.centerRow(0, '\x1B[1;36mCard Games — Blackjack\x1B[0m');
        vb.centerRow(2, `勝 ${this._stats.win}  負 ${this._stats.loss}  和 ${this._stats.draw}`);
        if (this._phase !== 'menu') {
            this._drawDeck();
            const hidden = this._dealerHidden;
            vb.writeStr(4, 2, '莊家：' + (hidden || this._flipping?.hand === this._dealer ? '?' : score(this._dealer)));
            this._drawHand(this._dealer, 6, hidden);
            vb.writeStr(11, 2, '玩家：' + (this._player.length ? score(this._player) : '?'));
            this._drawHand(this._player, 13, false);
            if (this._phase === 'flipping') {
                vb.centerRow(18, '翻牌中…');
            } else if (this._phase === 'dealing') {
                vb.centerRow(18, '發牌中…');
            } else if (this._phase === 'player') {
                vb.centerRow(18, (this._choice === 0 ? '\x1B[7m' : '') + ' 要牌 \x1B[0m    ' +
                    (this._choice === 1 ? '\x1B[7m' : '') + ' 停牌 \x1B[0m');
                vb.centerRow(20, '←→ 選擇  Enter 確認');
            } else {
                const label = { win: '你贏了！', loss: '莊家獲勝', draw: '平手' }[this._result];
                vb.centerRow(18, label + (natural(this._player) ? '  Blackjack!' : score(this._player) > 21 ? '  爆牌' : ''));
                vb.centerRow(20, 'Enter 下一局（重新洗牌）');
            }
        }
        vb.centerRow(22, 'Q / Esc 離開（可選回選單）   莊家 17 點停牌（含軟 17）');
        term.writeVB(vb);
    }
    _onKey(data) {
        if (this._capture) return this._capture.key(data);
        if (this._regicide) return this._regicide.key(data);
        if (this._holdem) return this._holdem.key(data);
        if (this._freecell) return this._freecell.key(data);
        if (data === '\x1B' || /^[qQ]$/.test(data)) return this._confirmQuit();
        if (this._phase === 'result') {
            if (data === '\r' || data === '\n') this._deal();
            return;
        }
        if (this._phase !== 'player') return;
        if (['\x1B[A', '\x1B[B', '\x1B[C', '\x1B[D'].includes(data)) {
            this._choice = 1 - this._choice; this._draw();
        } else if (data === '\r' || data === '\n') {
            if (this._choice === 1) return this._stand();
            this._dealCard(this._player, 13, false, () => {
                if (score(this._player) > 21) this._finish();
                else if (score(this._player) === 21) this._stand();
                else { this._phase = 'player'; this._draw(); }
            });
        }
    }
    _quit() {
        this._disposeGames();
        this._stopAnims();
        this._flipping = null;
        if (this._dialog) { this._dialog.close(); this._dialog = null; }
        this.placeShellCursor(24);
        this.close();
    }
    _confirmQuit() {
        if (this._dialog) return;
        this._dialog = this.openDialog(SelectDialog, 'cardgames-quit-confirm', {
            title: '離開遊戲？',
            options: ['繼續遊戲', '回選單', '離開遊戲'],
            selectedIndex: 0,
            onSelect: index => {
                this._dialog = null;
                if (index === 1) this._menu();
                else if (index === 2) this._quit();
            },
            onCancel: () => { this._dialog = null; },
            onAbort: () => this._quit(),
        });
    }
    onCancel() { this._quit(); super.onCancel(); }
}

defineMetaGetters(CardgamesCmd, META);
