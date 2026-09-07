import { system, term } from '../../system/sys.js';
import { makeOverlayGetCell } from '../../util/sgr.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { VerticalSelectDialog } from '../../dialog/VerticalSelectDialog.js';
import { displayWidth } from '../../util/display-width.js';
import { getWaitingTiles, checkTenpai } from './yaku.js';

export const inputMixin = {
    _buildActionItems() {
        const items = [];
        const actions = this._game.availableActions;
        const ankans = [];
        const kakans = [];
        for (const a of actions) {
            if (a === 'discard' || a === 'pass' || a === 'tsumo-no-yaku' || a === 'ron-no-yaku' || a === 'ron-furiten') continue;
            if (a === 'pass') { items.push({ label: '過', action: 'pass' }); continue; }
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

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (this._phase === 'gameOver') {
            if (code === 0x6E || code === 0x4E || code === 0x0D || code === 0x0A) {
                term.write('\x1B[2J\x1B[1;1H');
                this._phase = 'settings';
                this._game = null;
                this._render();
                this._showSettings();
                return;
            }
            if (code === 0x71 || code === 0x51) {
                this._showQuitConfirm();
                return;
            }
            if (code === 0x03) {
                this.close();
                return;
            }
            return;
        }

        if (this._phase === 'result') {
            if (code === 0x0D || code === 0x0A) {
                this._game.commitRoundEnd();
                if (this._game.gameOver) {
                    this._phase = 'gameOver';
                    this._render();
                } else {
                    this._game.startNewRound();
                    this._phase = 'playing';
                    this._handCursor = 0;
                    this._actionCursor = 0;
                    this._cursorMode = 'hand';
                    this._continueGame();
                }
                return;
            }
            if (code === 0x71 || code === 0x51) {
                this._showQuitConfirm();
                return;
            }
            if (code === 0x03) {
                this.close();
                return;
            }
            return;
        }

        if (this._phase === 'playing' && this._autoPlay) {
            if (code === 0x61 || code === 0x41) {
                this._autoPlay = false;
                this._tenpaiCache = { handStr: '', info: null };
                this._updateStatusBar();
                this._render();
                return;
            }
            if (code === 0x70 || code === 0x50) {
                this._phase = 'paused';
                this._render();
                this._drawPauseOverlay();
                return;
            }
            if (code === 0x71 || code === 0x51) {
                this._showQuitConfirm();
                return;
            }
            if (code === 0x03) {
                this.close();
                return;
            }
            return;
        }

        if (this._phase === 'paused') {
            if (this._pausedIsAuto) {
                if (code === 0x70 || code === 0x50) {
                    this._phase = 'playing';
                    this._autoPlay = true;
                    this._updateStatusBar();
                    this._removePauseOverlay();
                    this._render();
                    this._continueGame();
                    return;
                }
            } else {
                if (code === 0x70 || code === 0x50) {
                    this._phase = 'playing';
                    this._removePauseOverlay();
                    this._render();
                    return;
                }
            }
            if (code === 0x71 || code === 0x51) {
                this._showQuitConfirm();
                return;
            }
            if (code === 0x03) {
                this.close();
                return;
            }
            if (code === 0x1B) {
                const s = typeof data === 'string' ? data : '';
                if (s === '\x1B' || s.length === 1) {
                    this._phase = 'playing';
                    this._removePauseOverlay();
                    this._render();
                    return;
                }
            }
            return;
        }

        if (!this._game || !this._game.waitingHuman) return;
        if (code === 0x71 || code === 0x51) {
            this._showQuitConfirm();
            return;
        }
        if (code === 0x03) {
            this.close();
            return;
        }
        if (code === 0x61 || code === 0x41) {
            this._autoPlay = true;
            this._updateStatusBar();
            this._render();
            this._processAutoPlay();
            return;
        }
        if (code === 0x70 || code === 0x50) {
            this._pausedIsAuto = this._autoPlay;
            this._phase = 'paused';
            this._render();
            this._drawPauseOverlay();
            return;
        }

        if (this._cursorMode === 'chiSelect') {
            this._handleChiSelectKey(data);
            return;
        }
        if (this._cursorMode === 'kanSelect') {
            this._handleKanSelectKey(data);
            return;
        }

        if (this._cursorMode === 'action') {
            this._handleActionBarKey(data);
            return;
        }

        if (this._cursorMode === 'hand') {
            this._handleHandKey(data);
            return;
        }
    },

    _handleActionBarKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        const items = this._actionItems;
        if (items.length === 0) return;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[C') {
                this._actionCursor = (this._actionCursor + 1) % items.length;
                this._render();
                return;
            }
            if (s === '\x1B[D') {
                this._actionCursor = (this._actionCursor - 1 + items.length) % items.length;
                this._render();
                return;
            }
            if (s === '\x1B[B') {
                if (this._game.phase !== 'call_pending') {
                    this._cursorMode = 'hand';
                    const p = this._game.players[0];
                    this._handCursor = Math.max(0, p.hand.length - 1);
                    this._render();
                }
                return;
            }
            if (s === '\x1B[A') {
                return;
            }
            if (s === '\x1B[3~' || s === '\x1B[2~' || s === '\x1B[H' || s === '\x1B[F' || s === '\x1B[5~' || s === '\x1B[6~') return;
            this._showQuitConfirm();
            return;
        }
        if (code === 0x0D || code === 0x0A) {
            this._executeAction(items[this._actionCursor]);
            return;
        }
    },

    _handleHandKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const hasDraw = !!p.lastDraw;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[C') {
                this._handCursor = (this._handCursor + 1) % hand.length;
                this._render();
                return;
            }
            if (s === '\x1B[D') {
                this._handCursor = (this._handCursor - 1 + hand.length) % hand.length;
                this._render();
                return;
            }
            if (s === '\x1B[A') {
                if (this._actionItems.length > 0) {
                    this._cursorMode = 'action';
                    this._actionCursor = 0;
                    this._render();
                }
                return;
            }
            if (s === '\x1B[B') {
                return;
            }
            if (s === '\x1B[3~' || s === '\x1B[2~' || s === '\x1B[H' || s === '\x1B[F' || s === '\x1B[5~' || s === '\x1B[6~') return;
            this._showQuitConfirm();
            return;
        }

        if (code === 0x0D || code === 0x0A) {
            const hasKanOptions = g.availableActions.some(a => typeof a === 'object');
            if (hasKanOptions) {
                this._cursorMode = 'action';
                this._actionCursor = 0;
                this._render();
                return;
            }
            if (this._actionItems.length > 0 && this._actionItems.length === 1 && this._actionItems[0].action === 'discard') {
                this._doDiscard(this._handCursor);
                return;
            }
            if (g.availableActions.includes('discard') && this._actionItems.length === 0) {
                this._doDiscard(this._handCursor);
                return;
            }
            this._doDiscard(this._handCursor);
            return;
        }
    },

    _handleChiSelectKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        const opts = this._chiOptions;
        if (opts.length === 0) return;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[C' || s === '\x1B[D') {
                this._subMenuCursor = (this._subMenuCursor + (s === '\x1B[C' ? 1 : -1) + opts.length) % opts.length;
                this._render();
                return;
            }
            if (s === '\x1B[B' || s === '\x1B[A') return;
            this._cursorMode = 'hand';
            this._render();
            return;
        }

        if (code === 0x0D || code === 0x0A) {
            const call = this._chiOptions[this._subMenuCursor];
            this._cursorMode = 'hand';
            this._game.humanCall(call);
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }
    },

    _handleKanSelectKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        const opts = this._kanOptions;
        if (opts.length === 0) return;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[C' || s === '\x1B[D') {
                this._subMenuCursor = (this._subMenuCursor + (s === '\x1B[C' ? 1 : -1) + opts.length) % opts.length;
                this._render();
                return;
            }
            if (s === '\x1B[B' || s === '\x1B[A') return;
            this._cursorMode = 'hand';
            this._render();
            return;
        }

        if (code === 0x0D || code === 0x0A) {
            const kanOption = this._kanOptions[this._subMenuCursor];
            this._cursorMode = 'hand';
            this._game.executeKan(kanOption);
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }
    },

    _executeAction(item) {
        const g = this._game;
        const action = item.action;
        const stackDepth = system.cmdStack.length;

        if (action === 'pass') {
            if (g.phase === 'draw') {
                g.phase = 'discard';
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
            const labels = options.map(o =>
                '捨' + o.tile.name + '→聽' + o.waits.map(w => w.name).join('')
            );
            const maxLen = Math.max(...labels.map(l => displayWidth(l)));
            const stackDepth = system.cmdStack.length;
            const removeHook = system.addFramePopHook(() => {
                if (system.cmdStack.length === stackDepth) {
                    removeHook();
                    this._showEffectAndContinue();
                }
            });
            system.createDialog(VerticalSelectDialog, 'jpmj-riichi', {
                title: '立直',
                message: 'どの牌を捨てますか？',
                options: labels,
                width: maxLen + 6,
                cols: 1,
                onSelect: (idx) => {
                    this._game.humanRiichi(options[idx].handIdx);
                    this._cursorMode = 'hand';
                    this._handCursor = 0;
                    return 'close';
                },
                onCancel: () => {
                    return 'close';
                },
            });
            return;
        }

        if (action && typeof action === 'object') {
            if (action.type === 'chi' && action.chiSets && action.chiSets.length > 1) {
                const chiLabels = action.chiSets.map(set => set.map(t => t.name).join(' '));
                const removeHook = system.addFramePopHook(() => {
                    if (system.cmdStack.length === stackDepth) {
                        removeHook();
                        this._showEffectAndContinue();
                    }
                });
                system.createDialog(SelectDialog, 'jpmj-chi', {
                    title: 'チー選択',
                    message: 'どの組み合わせでチーしますか？',
                    options: chiLabels,
                    width: 40,
                    onSelect: (idx) => {
                        const call = { ...action, chosenChiSet: idx };
                        g.humanCall(call);
                        return 'close';
                    },
                    onCancel: () => {
                        return 'close';
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
                const labels = opts.map(o => o.desc);
                const maxLen = Math.max(...labels.map(l => displayWidth(l)));
                const key = action.type === 'ankans' ? 'jpmj-ankans' : 'jpmj-kakans';
                const stackDepth = system.cmdStack.length;
                const removeHook = system.addFramePopHook(() => {
                    if (system.cmdStack.length === stackDepth) {
                        removeHook();
                        this._showEffectAndContinue();
                    }
                });
                system.createDialog(VerticalSelectDialog, key, {
                    title: action.type === 'ankans' ? '暗槓選択' : '加槓選択',
                    options: labels,
                    width: maxLen + 6,
                    cols: 1,
                    onSelect: (idx) => {
                        g.executeKan(opts[idx]);
                        this._cursorMode = 'hand';
                        this._handCursor = 0;
                        return 'close';
                    },
                    onCancel: () => {
                        return 'close';
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
        const tileIdx = this._visualToHandIdx(visualPos);
        if (tileIdx < 0 || tileIdx >= p.hand.length) return;

        g.humanDiscard(tileIdx);
        this._cursorMode = 'hand';
        this._handCursor = 0;
        this._gameTimer = setTimeout(() => this._continueGame(), 100);
    },

    _getCursorPos() {
        if (this._cursorMode === 'hand') {
            return this._getHandCursorPos(this._handCursor);
        }
        if (this._cursorMode === 'action') {
            return this._getActionBarCursorPos();
        }
        if (this._cursorMode === 'chiSelect' || this._cursorMode === 'kanSelect') {
            return null;
        }
        return null;
    },

    _handIdxToVisual(handIdx) {
        const p = this._game.players[0];
        const drawTile = p.lastDraw;
        if (!drawTile) return handIdx;
        const drawIdx = p.hand.indexOf(drawTile);
        if (drawIdx < 0) return handIdx;
        if (handIdx === drawIdx) return p.hand.length - 1;
        return handIdx < drawIdx ? handIdx : handIdx - 1;
    },

    _visualToHandIdx(visualPos) {
        const p = this._game.players[0];
        const drawTile = p.lastDraw;
        if (!drawTile) return visualPos;
        const drawIdx = p.hand.indexOf(drawTile);
        if (drawIdx < 0) return visualPos;
        const handCount = p.hand.length - 1;
        if (visualPos === handCount) return drawIdx;
        return visualPos < drawIdx ? visualPos : visualPos + 1;
    },

    _getHandCursorPos(index) {
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const drawTile = p.lastDraw;
        const melds = p.melds;

        const meldTiles = [];
        for (const m of melds) {
            for (const t of m.tiles) meldTiles.push(t);
        }

        const handCount = hand.length - 1;
        const handCols = handCount * 2;
        const gapBeforeDraw = 1;
        const drawCols = 2;
        const gapBeforeMeld = melds.length > 0 ? 1 : 0;
        const meldCols = meldTiles.length * 2;
        const totalCols = handCols + gapBeforeDraw + drawCols + gapBeforeMeld + meldCols;
        const startCol = 4 + Math.floor((40 - totalCols) / 2);

        if (index === hand.length - 1) {
            return { row: 20, col: startCol + handCols + gapBeforeDraw };
        }
        return { row: 20, col: startCol + index * 2 };
    },

    _getActionBarCursorPos() {
        const items = this._actionItems;
        if (items.length === 0) return null;
        let x = 4;
        const plain = items.map(i => i.label).join(' ');
        const pad = Math.max(0, 40 - plain.length);
        x += Math.floor(pad / 2);
        for (let i = 0; i < this._actionCursor && i < items.length; i++) {
            x += items[i].label.length + 1;
        }
        return { row: 19, col: x };
    },

    _drawPauseOverlay() {
        const vb = this._pauseVB;
        const buf = vb._buffer;
        const ow = 36, oh = 15;
        const bc = this._blankCell;
        const by = this._cellBorderY;

        for (let r = 0; r < oh; r++) {
            const row = buf[r];
            for (let c = 0; c < ow; c++) row[c] = bc;
        }

        vb.writeStr(0, 0, '\x1B[1;33m┌' + '─'.repeat(ow - 2) + '┐\x1B[0m');
        for (let r = 1; r < oh - 1; r++) { buf[r][0] = by; buf[r][ow - 1] = by; }
        vb.writeStr(oh - 1, 0, '\x1B[1;33m└' + '─'.repeat(ow - 2) + '┘\x1B[0m');

        vb.writeStr(3, 2, '\x1B[1;33m' + ' '.repeat(8) + '暫停中' + ' '.repeat(8) + '\x1B[0m');
        vb.writeStr(7, 2, '  P 取消暫停    Q 退出');

        this._pauseVBBuffer = vb.render();
        if (!this._pauseOverlay) {
            this._pauseOverlay = {
                x: 4, y: 2, w: ow, h: oh,
                z: 5,
                owner: this,
                getCell: makeOverlayGetCell(() => this._pauseVBBuffer, ow, oh),
            };
            term.addOverlay(this._pauseOverlay);
        }
        for (let r = 2; r < 2 + oh; r++) term.markRowDirty(r);
    },

    _removePauseOverlay() {
        if (this._pauseOverlay) {
            term.removeOverlay(this._pauseOverlay);
            this._pauseOverlay = null;
            for (let r = 2; r < 17; r++) term.markRowDirty(r);
        }
    },
};