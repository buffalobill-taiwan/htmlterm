import { checkTenpai, getWaitingTiles } from '../yaku/index.js';
import { system } from '../../../system/sys.js';
import { VerticalSelectDialog } from '../../../dialog/VerticalSelectDialog.js';
import { displayWidth } from '../../../util/display-width.js';

const actionsMethods = {
    _buildActionItems() {
        const items = [];
        const actions = this._game.availableActions;
        const ankans = [];
        const kakans = [];
        for (const a of actions) {
            if (a === 'discard' || a === 'pass' || a === 'tsumo-no-yaku' || a === 'ron-no-yaku' || a === 'ron-furiten') continue;
            if (a === 'tsumo') { items.push({ label: 'ツモ', action: 'tsumo' }); continue; }
            if (a === 'ron') { items.push({ label: 'ロン', action: 'ron' }); continue; }
            if (a === 'kyuushu') { items.push({ label: '九種', action: 'kyuushu' }); continue; }
            if (a === 'riichi') { items.push({ label: '立直', action: 'riichi' }); continue; }
            if (a && typeof a === 'object') {
                if (a.type === 'pon') items.push({ label: 'ポン', action: a });
                else if (a.type === 'chi') items.push({ label: 'チー', action: a });
                else if (a.type === 'kan') items.push({ label: '槓', action: a });
                else if (a.type === 'ankan') ankans.push(a);
                else if (a.type === 'kakan') kakans.push(a);
                else if (a.type === 'ron') items.push({ label: 'ロン', action: a });
                else if (a.type === 'pass') items.push({ label: '過', action: { type: 'pass' } });
            }
        }
        if (ankans.length === 1) items.push({ label: '暗槓', action: ankans[0] });
        else if (ankans.length > 1) items.push({ label: '暗槓', action: { type: 'ankans', options: ankans } });
        if (kakans.length === 1) items.push({ label: '加槓', action: kakans[0] });
        else if (kakans.length > 1) items.push({ label: '加槓', action: { type: 'kakans', options: kakans } });
        if (this._canDeclareRiichi() && !items.find(i => i.action === 'riichi')) {
            const passIdx = items.findIndex(i => i.action === 'pass' || (i.action && i.action.type === 'pass'));
            if (passIdx >= 0) items.splice(passIdx, 0, { label: '立直', action: 'riichi' });
            else items.unshift({ label: '立直', action: 'riichi' });
        }
        const hasPass = items.some(i => i.action === 'pass' || (i.action && i.action.type === 'pass'));
        if (!hasPass && items.length > 0 && this._game.phase === 'call_pending') {
            items.push({ label: '過', action: 'pass' });
        }
        return items;
    },

    _canDeclareRiichi() {
        if (!this._game || this._game.gameOver || this._game.roundOver) return false;
        if (this._phase !== 'playing') return false;
        const g = this._game;
        if (g.currentPlayer !== 0) return false;
        if (g.phase !== 'discard' && g.phase !== 'dealer_first_discard') return false;
        const p = g.players[0];
        if (p.isRiichi) return false;
        if (p.melds.some(m => m.open)) return false;
        if (p.score < 1000) return false;
        if (g.wall.getRemainingCount() < 4) return false;
        return p.hand.some((_, i) => {
            const testHand = p.hand.filter((__, j) => j !== i);
            return checkTenpai(testHand, p.melds);
        });
    },

    _getDiscardableIndices() {
        if (!this._game) return [];
        const p = this._game.players[0];
        const hand = p.hand;
        const drawTile = p.lastDraw;
        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;
        if (p.isRiichi) {
            if (drawTile && drawIdx >= 0) {
                return [hand.length - 1];
            }
            return [];
        }
        const indices = [];
        for (let i = 0; i < hand.length; i++) {
            indices.push(this._handIdxToVisual(i));
        }
        return indices.sort((a, b) => a - b);
    },

    _executeAction(item) {
        const g = this._game;
        const action = item.action;

        if (action === 'pass') {
            if (g.phase === 'draw' || g.phase === 'rinshan') {
                if (!g.passDraw()) return;
            } else {
                g.humanCall({ type: 'pass' });
            }
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        if (action === 'tsumo') {
            const p = g.players[0];
            g.executeWin(0, 'tsumo', p.lastDraw);
            this._showEffectAndContinue();
            return;
        }

        if (action === 'ron') {
            const ronCalls = g.availableCalls.filter(c => c.type === 'ron');
            if (ronCalls.length > 0) {
                g.humanCall(ronCalls[0]);
            } else {
                g.humanCall({ type: 'pass' });
            }
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._showEffectAndContinue();
            return;
        }

        if (action === 'kyuushu') {
            g.handleKyuushuKyuuhai(0);
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        if (action === 'riichi') {
            const p = g.players[0];
            const hand = p.hand;
            const options = [];
            const seenKeys = new Set();
            for (let i = 0; i < hand.length; i++) {
                const key = hand[i].key();
                if (seenKeys.has(key)) continue;
                const testHand = hand.filter((_, j) => j !== i);
                const waits = getWaitingTiles(testHand, p.melds);
                if (waits.length > 0) {
                    seenKeys.add(key);
                    options.push({ handIdx: i, tile: hand[i], waits });
                }
            }
            if (options.length === 0) return;
            if (options.length === 1) {
                this._game.humanRiichi(options[0].handIdx);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._showEffectAndContinue();
                return;
            }
            const maxW = 3 + Math.max(...options.map(o => o.waits.length)) * 2;
            system.createDialog(VerticalSelectDialog, 'jpmj-riichi', {
                title: '立直',
                message: 'どの牌を捨てますか？',
                options,
                width: Math.max(displayWidth('どの牌を捨てますか？') + 4, maxW + 10),
                cols: 1,
                cellHeight: 2,
                renderOption: (idx, o, sel) => this._buildRiichiStripVB(o, sel),
                onSelect: (idx) => {
                    this._game.humanRiichi(options[idx].handIdx);
                    this._cursorMode = 'hand';
                    this._handCursor = 0;
                    this._showEffectAndContinue();
                },
                onCancel: () => {
                    this._showEffectAndContinue();
                },
            });
            return;
        }

        if (action && typeof action === 'object') {
            if (action.type === 'chi' && action.chiSets && action.chiSets.length > 1) {
                system.createDialog(VerticalSelectDialog, 'jpmj-chi', {
                    title: 'チー選択',
                    message: 'どの組み合わせでチーしますか？',
                    options: action.chiSets,
                    width: displayWidth('どの組み合わせでチーしますか？') + 6,
                    cols: 1,
                    cellHeight: 2,
                    renderOption: (idx, set, sel) => this._buildTileStripVB(set, sel),
                    onSelect: (idx) => {
                        const call = { ...action, chosenChiSet: idx };
                        g.humanCall(call);
                        this._showEffectAndContinue();
                    },
                    onCancel: () => {
                        this._showEffectAndContinue();
                    },
                });
                return;
            }
            if (action.type === 'kan') {
                const kans = g.buildAvailableKans();
                if (kans.length > 1) {
                    this._cursorMode = 'kanSelect';
                    this._subMenuCursor = 0;
                    this._kanOptions = kans;
                    this._render();
                    return;
                }
                g.humanCall(action);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._showEffectAndContinue();
                return;
            }
            if (action.type === 'ankans' || action.type === 'kakans') {
                const opts = action.options;
                if (opts.length === 1) {
                    g.executeKan(opts[0]);
                    this._cursorMode = 'hand';
                    this._handCursor = 0;
                    this._showEffectAndContinue();
                    return;
                }
                const key = action.type === 'ankans' ? 'jpmj-ankans' : 'jpmj-kakans';
                const kanLabel = action.type === 'ankans' ? '暗槓' : '加槓';
                system.createDialog(VerticalSelectDialog, key, {
                    title: action.type === 'ankans' ? '暗槓選択' : '加槓選択',
                    options: opts,
                    width: Math.max(displayWidth(action.type === 'ankans' ? '暗槓選択' : '加槓選択') + 6, 2 + 1 + displayWidth(kanLabel) + 10),
                    cols: 1,
                    cellHeight: 2,
                    renderOption: (idx, o, sel) => this._buildTileStripVB([o.tile], sel, kanLabel),
                    onSelect: (idx) => {
                        g.executeKan(opts[idx]);
                        this._cursorMode = 'hand';
                        this._handCursor = 0;
                        this._showEffectAndContinue();
                    },
                    onCancel: () => {
                        this._showEffectAndContinue();
                    },
                });
                return;
            }
            if (action.type === 'ankan' || action.type === 'kakan') {
                g.executeKan(action);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._showEffectAndContinue();
                return;
            }
            g.humanCall(action);
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._showEffectAndContinue();
            return;
        }
    },

    _doDiscard(visualPos) {
        const g = this._game;
        const p = g.players[0];
        if (g.phase === 'draw' || g.phase === 'rinshan') {
            if (!g.passDraw()) return;
        }
        if (!this._getDiscardableIndices().includes(visualPos)) return;
        const tileIdx = this._visualToHandIdx(visualPos);
        if (tileIdx < 0 || tileIdx >= p.hand.length) return;

        g.humanDiscard(tileIdx);
        this._cursorMode = 'hand';
        this._handCursor = 0;
        this._gameTimer = setTimeout(() => this._continueGame(), 100);
    },
};

export { actionsMethods };
