import { CmdBase } from '../CmdBase.js';
import { term } from '../../system/sys.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { GAME_META } from '../game-meta.js';
import { cardBuffer } from './cards.js';
import { flipCard } from './animation.js';
import { score, natural, outcome, shuffledDeck } from './blackjack.js';
import { FreeCellGame } from './freecell/FreeCellGame.js';
import { parseSeed } from '../../util/random.js';
const META = GAME_META.cardgames;

export class CardgamesCmd extends CmdBase {
    static get commandName() { return META.commandName; }
    static get help() { return META.help; }
    static get usage() { return META.usage; }
    static get menu() { return META.menu; }
    execute(args) {
        const p = this.parseArgs(args);
        if (p.hasHelp) return this.showHelp();
        if (args.some(a => a.startsWith('-'))) return this.error('Usage: cardgames [freecell [seed]]');
        if (p.rest.length && (p.rest[0] !== 'freecell' || p.rest.length > 2 || (p.rest.length === 2 && parseSeed(p.rest[1]) === null))) return this.error('Usage: cardgames [freecell [seed]]');
        this.open();
        this._stats = { win: 0, loss: 0, draw: 0 };
        this._vb = new VirtualBuffer(80, 23);
        term.write('\x1B[2J\x1B[H\x1B[?25l');
        this.addCleanup(() => { this._freecell?.dispose(); this._freecell = null; });
        if (p.rest.length) this._startFreeCell(p.rest.length === 2 ? Number(p.rest[1]) : undefined);
        else this._menu();
    }
    _startFreeCell(seed) {
        this._freecell?.dispose();
        this._freecell = new FreeCellGame(this);
        this._freecell.start(seed);
    }
    handleMouse(type, info) { return this._freecell?.handleMouse(type, info) || false; }
    _menu() {
        this._freecell?.dispose();
        this._freecell = null;
        term.write('\x1B[2J');
        this._cancelFlip?.();
        this._flipping = null;
        this._phase = 'menu';
        this._draw();
        this._dialog = this.openDialog(SelectDialog, 'cardgames-menu', {
            title: 'Card Games', layout: 'list', width: 36,
            options: ['Blackjack 二十一點', 'FreeCell 新接龍'],
            onSelect: index => { this._dialog = null; if (index === 1) this._startFreeCell(); else this._deal(); },
            onCancel: () => { this._dialog = null; this._quit(); },
        });
    }
    _deal() {
        this._cancelFlip?.();
        this._flipping = null;
        this._dealerHidden = true;
        this._deck = shuffledDeck();
        this._player = [this._deck.pop()]; this._dealer = [this._deck.pop()];
        this._player.push(this._deck.pop()); this._dealer.push(this._deck.pop());
        this._phase = 'player'; this._choice = 0;
        if (natural(this._player) || natural(this._dealer)) this._finish();
        else this._draw();
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
        if (score(this._dealer) < 17) {
            this._dealer.push(this._deck.pop());
            this._flip(this._dealer, this._dealer.length - 1, 6, () => this._stand());
        } else this._finish();
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
            for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++)
                this._vb.setCell(row + r, 2 + i * 6 + c, face.getCell(r, c));
        });
    }
    _draw() {
        const vb = this._vb;
        for (let r = 0; r < 23; r++) vb.writeStr(r, 0, ' '.repeat(80));
        vb.centerRow(0, '\x1B[1;36mCard Games — Blackjack\x1B[0m');
        vb.centerRow(2, `勝 ${this._stats.win}  負 ${this._stats.loss}  和 ${this._stats.draw}`);
        if (this._phase !== 'menu') {
            const hidden = this._dealerHidden;
            vb.writeStr(4, 2, '莊家：' + (hidden || this._flipping?.hand === this._dealer ? '?' : score(this._dealer)));
            this._drawHand(this._dealer, 6, hidden);
            vb.writeStr(11, 2, '玩家：' + (this._flipping?.hand === this._player ? '?' : score(this._player)));
            this._drawHand(this._player, 13, false);
            if (this._phase === 'flipping') {
                vb.centerRow(18, '翻牌中…');
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
        vb.centerRow(22, 'N 遊戲選單   Q / Esc 離開   莊家 17 點停牌（含軟 17）');
        term.writeVB(vb);
    }
    _onKey(data) {
        if (this._freecell) return this._freecell.key(data);
        if (data === '\x1B' || /^[qQ]$/.test(data)) return this._quit();
        if (/^[nN]$/.test(data)) return this._menu();
        if (this._phase === 'result') {
            if (data === '\r' || data === '\n') this._deal();
            return;
        }
        if (this._phase !== 'player') return;
        if (['\x1B[A', '\x1B[B', '\x1B[C', '\x1B[D'].includes(data)) {
            this._choice = 1 - this._choice; this._draw();
        } else if (data === '\r' || data === '\n') {
            if (this._choice === 1) return this._stand();
            this._player.push(this._deck.pop());
            this._flip(this._player, this._player.length - 1, 13, () => {
                if (score(this._player) > 21) this._finish();
                else if (score(this._player) === 21) this._stand();
                else { this._phase = 'player'; this._draw(); }
            });
        }
    }
    _quit() {
        this._freecell?.dispose();
        this._freecell = null;
        this._cancelFlip?.();
        this._flipping = null;
        if (this._dialog) { this._dialog.close(); this._dialog = null; }
        this.placeShellCursor(24);
        this.close();
    }
    onCancel() { this._quit(); super.onCancel(); }
}
