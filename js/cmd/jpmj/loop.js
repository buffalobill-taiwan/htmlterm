import { term } from '../../system/sys.js';
import { makeCell, makeOverlayGetCell, OverlayZ } from '../../util/sgr.js';
import { checkTenpai } from './yaku.js';

export const loopMixin = {
    _continueGame() {
        if (!this._game || this._game.gameOver) {
            this._autoPlay = false;
            this._updateStatusBar();
            this._phase = 'gameOver';
            this._render();
            return;
        }
        if (this._game.roundOver) {
            this._autoPlay = false;
            this._updateStatusBar();
            this._game._pendingCallEffect = null;
            this._actionItems = [];
            this._phase = 'result';
            this._render();
            return;
        }
        const needHuman = this._game.advance();
        if (this._game._riichiAutoDiscard) {
            const ad = this._game._riichiAutoDiscard;
            this._game._riichiAutoDiscard = null;
            this._render();
            this._gameTimer = setTimeout(() => {
                this._game.executeDiscard(ad.playerIdx, ad.tileIdx);
                this._continueGame();
            }, 100);
            return;
        }
        if (this._game._pendingCallEffect) {
            const eff = this._game._pendingCallEffect;
            this._game._pendingCallEffect = null;
            if (this._game.roundOver) this._pendingResultPhase = true;
            this._render();
            this._showCallEffect(eff.type, eff.playerIdx);
            return;
        }
        if (this._game.roundOver) {
            this._phase = 'result';
            this._render();
            return;
        }
        if (needHuman) {
            const p = this._game.players[0];
            const hasDraw = p.lastDraw && p.hand.includes(p.lastDraw);
            const hasKanOptions = this._game.availableActions.some(a => typeof a === 'object');
            if (this._game.phase === 'call_pending' || hasKanOptions) {
                this._cursorMode = 'action';
                this._actionCursor = 0;
            } else if (hasDraw) {
                this._cursorMode = 'hand';
                this._handCursor = p.hand.length - 1;
            } else {
                this._cursorMode = 'hand';
                this._handCursor = Math.max(0, p.hand.length - 1);
            }
        } else {
            const p = this._game.players[0];
            if (p.lastDraw && p.hand.includes(p.lastDraw)) {
                this._cursorMode = 'hand';
                this._handCursor = p.hand.length - 1;
            }
        }
        const skipRender = !needHuman && this._game.currentPlayer === 0
            && this._game.phase === 'draw' && !this._game.players[0].lastDraw;
        if (!skipRender) this._render();
        if (needHuman && this._autoPlay) {
            this._processAutoPlay();
            return;
        }
        if (!needHuman) {
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
        }
    },

    _processAutoPlay() {
        if (!this._game || this._game.gameOver || this._game.roundOver) return;
        if (!this._game.waitingHuman || !this._autoPlay) return;

        const g = this._game;
        const p = g.players[0];

        // A. Discard phase
        if (g.phase === 'dealer_first_discard' || g.phase === 'discard') {
            if (g.availableActions.includes('kyuushu')) {
                if (p.ai.decideKyuushu(g, 0)) {
                    g.handleKyuushuKyuuhai(0);
                    this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    return;
                }
                g.availableActions = g.availableActions.filter(a => a !== 'kyuushu');
            }
            if (!g.availableActions.includes('discard')) return;
            if (g.handleAIKan(0)) {
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            if (!p.isRiichi && p.score >= 1000 && !p.melds.some(m => m.open) && g.wall.getRemainingCount() >= 4 && p.ai.decideRiichi(g, 0)) {
                for (let i = 0; i < p.hand.length; i++) {
                    const testHand = p.hand.filter((_, j) => j !== i);
                    if (checkTenpai(testHand, p.melds)) {
                        g.humanRiichi(i);
                        this._gameTimer = setTimeout(() => this._continueGame(), 100);
                        return;
                    }
                }
            }
            const idx = p.ai.chooseDiscard(g, 0);
            g.humanDiscard(idx);
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        // B. Call pending
        if (g.phase === 'call_pending') {
            const humanCalls = g.availableCalls.filter(c => c.playerIdx === 0);
            if (humanCalls.length === 0) {
                const passAction = g.availableActions.find(a => a.type === 'pass');
                if (passAction) g.humanCall(passAction);
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            const chosenCall = p.ai.decideCall(g, humanCalls);
            if (chosenCall) {
                g.humanCall(chosenCall);
            } else {
                const passAction = g.availableActions.find(a => a.type === 'pass');
                if (passAction) g.humanCall(passAction);
            }
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        // C. Tsumo / pass
        if (g.availableActions) {
            if (g.availableActions.includes('tsumo')) {
                g.executeWin(0, 'tsumo', p.lastDraw);
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            if (g.availableActions.includes('tsumo-no-yaku') || g.availableActions.includes('pass')) {
                g.availableActions = [];
                g.phase = 'discard';
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
        }
    },

    _showCallEffect(type, playerIdx) {
        const typeMap = {
            chi: 'チー', pon: 'ポン', kan: 'カン',
            ron: 'ロン', tsumo: 'ツモ', riichi: '立直',
        };
        const text = typeMap[type];
        if (!text) { this._gameTimer = setTimeout(() => this._continueGame(), 100); return; }
        const pos = this._getCallEffectPos(playerIdx);
        if (!pos) { this._gameTimer = setTimeout(() => this._continueGame(), 100); return; }
        const buf = this._buildCallEffectBuffer(text);
        this._callEffectOverlay = {
            x: pos.x, y: pos.y, w: 10, h: 4, z: OverlayZ.CALL_EFFECT || 5,
            owner: this,
            getCell: makeOverlayGetCell(buf, 10, 4),
        };
        term.addOverlay(this._callEffectOverlay);
        for (let r = pos.y; r < pos.y + 4; r++) term.markRowDirty(r);
        this._render();
        this._callEffectTimer = setTimeout(() => {
            this._removeCallEffect();
            if (this._pendingResultPhase) {
                this._phase = 'result';
                this._pendingResultPhase = false;
            }
            this._continueGame();
        }, 500);
    },

    _buildCallEffectBuffer(text) {
        const W = 10, H = 4;
        const buf = Array.from({ length: H }, () => Array(W).fill(null));
        const fg = 7, bg = 0;
        buf[0][0] = makeCell('╔', fg, bg, false);
        buf[0][W - 1] = makeCell('╗', fg, bg, false);
        buf[H - 1][0] = makeCell('╚', fg, bg, false);
        buf[H - 1][W - 1] = makeCell('╝', fg, bg, false);
        for (let c = 1; c < W - 1; c++) {
            buf[0][c] = makeCell('═', fg, bg, false);
            buf[H - 1][c] = makeCell('═', fg, bg, false);
        }
        for (let r = 1; r < H - 1; r++) {
            buf[r][0] = makeCell('║', fg, bg, false);
            buf[r][W - 1] = makeCell('║', fg, bg, false);
        }
        for (let ci = 0; ci < text.length; ci++) {
            const ch = text[ci];
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 4; c++) {
                    const cell = makeCell(ch, fg, bg, true, 1);
                    cell.clip = true;
                    cell.clipOffX = -c;
                    cell.clipOffY = -r;
                    buf[1 + r][1 + ci * 4 + c] = cell;
                }
            }
        }
        return buf;
    },

    _getCallEffectPos(playerIdx) {
        switch (playerIdx) {
            case 0: return { x: 19, y: 16 };
            case 1: return { x: 31, y: 7 };
            case 2: return { x: 15, y: 1 };
            case 3: return { x: 2, y: 9 };
        }
    },

    _showEffectAndContinue() {
        const eff = this._game._pendingCallEffect;
        this._game._pendingCallEffect = null;
        if (eff) {
            this._showCallEffect(eff.type, eff.playerIdx);
        } else {
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
        }
    },

    _removeCallEffect() {
        if (this._callEffectOverlay) {
            term.removeOverlay(this._callEffectOverlay);
            for (let r = this._callEffectOverlay.y; r < this._callEffectOverlay.y + 4; r++) term.markRowDirty(r);
            this._callEffectOverlay = null;
        }
        if (this._callEffectTimer) {
            clearTimeout(this._callEffectTimer);
            this._callEffectTimer = null;
            this._pendingResultPhase = false;
        }
    },

    _stopTimer() {
        if (this._gameTimer) {
            clearTimeout(this._gameTimer);
            this._gameTimer = null;
        }
        if (this._game) this._game._riichiAutoDiscard = null;
        this._removeCallEffect();
    },
};