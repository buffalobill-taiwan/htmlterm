import { FieldPickerDialog } from '../../../dialog/FieldPickerDialog.js';
import { SelectDialog } from '../../../dialog/SelectDialog.js';
import { ConfirmDialog } from '../../../dialog/ConfirmDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { term } from '../../../system/sys.js';
import { callEffectOverlay } from '../../../util/call-effect.js';
import { CHARS } from '../engine/constants.js';
import { WINDS, createRound, actor, legalActions, applyAction, publicView } from './rules.js';
import { chooseAction } from './ai.js';
import { startRecycleAnimation, startShuffleAnimation, startTileFlight } from './animation.js';
import { BACK, BACK_CONT, dealOrder, discardPosition, handPosition, tilePositions, wallPosition } from './layout.js';

const RULES = [
    '32 子四人玩法：莊家五張，其餘四張，摸一張、打一張。',
    '胡牌＝一組面子＋一對。莊家起手即可自摸。',
    '順子：同色帥仕相、將士象、俥傌炮、車馬砲。',
    '刻子：三兵或三卒。對子：同色同字，帥將也可配對。',
    '只吃上家，不碰不槓；吃後打牌，不摸牌，面子不可拆。',
    '胡優先於吃；多人能胡，由出牌者下家起先接受者胡。',
    '不用宣告聽牌，過後仍可胡；無牌可摸時流局。',
    '放槍付 1 分；自摸其餘三家各付 1 分；流局不計分。',
    '莊家胡或流局連莊，否則輪下家；連莊不加分。',
    '← → 選牌，Enter 出牌；吃胡視窗按 Esc 表示過。',
    '結算後 Enter 下一局；r 重玩本局，恢復局前積分。',
    'n 重新設定並清零積分；q 退出；Ctrl+C 立即退出。',
].join('\n');

export const mahjongMethods = {
    _applyMahjongAction(action) {
        const state = this._mahjong, seat = actor(state);
        const tile = action.type === 'draw' ? state.wall[state.wall.length - 1]
            : action.type === 'discard' ? state.players[seat].hand.find(item => item.id === action.id) : null;
        const from = action.type === 'draw' && tile ? wallPosition(state.wall.length - 1)
            : action.type === 'discard' && tile ? handPosition(state, seat, tile.id) : null;
        const text = action.type === 'chi' ? '吃牌'
            : action.type === 'win' ? state.phase === 'self' ? '自摸' : '胡牌' : null;
        applyAction(state, action);
        if (tile && from) {
            const to = action.type === 'draw' ? handPosition(state, seat, tile.id)
                : discardPosition(state.discards.length - 1);
            if (action.type === 'draw' && seat === state.human) {
                this._mahjongCursor = Math.max(0, state.players[state.human].hand.length - 1);
            } else if (action.type === 'discard' && seat === state.human) this._mahjongCursor = 0;
            this._animateMahjongFlight(state, tile, from, to, action.type === 'draw');
            return;
        }
        if (text) {
            this._render();
            const relative = (seat - state.human + 4) % 4;
            const overlay = callEffectOverlay(text, {
                x: relative < 2 ? 35 : 9, y: relative === 0 || relative === 3 ? 17 : 2,
                owner: this,
            });
            this._mahjongCallOverlay = overlay;
            term.addOverlay(overlay);
            const epoch = this._epoch;
            this._mahjongTimer = setTimeout(() => {
                this._mahjongTimer = null;
                this._removeMahjongCallEffect();
                if (epoch === this._epoch && this._mahjong === state) this._mahjongPump();
            }, 500);
        }
        this._mahjongPump();
    },

    _animateMahjongFlight(state, tile, from, to, isDraw) {
        this._mahjongAnimating = true;
        this._mahjongFlight = { tileId: tile.id };
        this._render();
        const cells = isDraw ? [BACK, BACK_CONT] : this._pieceCells.get(`${tile.color}:${tile.type}:0`);
        const epoch = this._epoch;
        this._cancelAnimation = startTileFlight(this, cells, from, to, () => {
            this._cancelAnimation = null;
            if (epoch !== this._epoch || this._mahjong !== state) return;
            this._mahjongFlight = null;
            this._mahjongAnimating = false;
            this._render();
            this._mahjongPump();
        });
    },

    _removeMahjongCallEffect() {
        const overlay = this._mahjongCallOverlay;
        if (!overlay) return;
        term.removeOverlay(overlay);
        this._mahjongCallOverlay = null;
    },

    _showMahjongRules() {
        if (!this._mahjong || this._dialog) return;
        this._stopAsync();
        const state = this._mahjong, epoch = this._epoch;
        this._dialog = this.openDialog(ShowDialog, 'cchess-mahjong-rules', {
            title: '象棋麻將規則', width: 72, message: RULES,
            footer: 'Enter / Esc 返回遊戲  Ctrl+C 退出',
            onExit: () => {
                this._dialog = null;
                if (this._mahjong === state && this._epoch === epoch) this._mahjongPump();
            },
            onAbort: () => { this._dialog = null; this._quit(); },
        });
    },

    _pickMahjong() {
        this._stopAsync();
        this._mahjong = this._mahjongInitial = null;
        this._mahjongError = null;
        this._render();
        this._dialog = this.openDialog(FieldPickerDialog, 'cchess-mahjong-setup', {
            title: '象棋麻將', width: 56,
            footer: '↑↓ 切換  ← → 選擇  Enter 開始  Esc 返回',
            fields: [
                { key: 'difficulty', label: '電腦強度', default: this._mahjongDifficulty || 'medium',
                  options: [['Easy', 'easy'], ['Medium', 'medium'], ['Hard', 'hard']] },
                { key: 'seat', label: '座位', default: this._mahjongSeat || 'random',
                  options: [['隨機', 'random'], ...WINDS.map((wind, seat) => [wind, String(seat)])] },
            ],
            onConfirm: ({ difficulty, seat }) => {
                this._dialog = null;
                this._mahjongDifficulty = difficulty; this._mahjongSeat = seat;
                const human = seat === 'random' ? Math.floor(Math.random() * 4) : Number(seat);
                this._startMahjongRound(createRound({ human }));
            },
            onCancel: () => { this._dialog = null; this._pickMode(); },
            onAbort: () => { this._dialog = null; this._quit(); },
        });
    },

    _startMahjongRound(state) {
        this._stopAsync();
        this._mahjong = state;
        this._mahjongInitial = structuredClone(state);
        this._mahjongCursor = 0;
        this._mahjongError = null;
        this._completed = false;
        this._beginMahjongDeal();
    },

    _beginMahjongDeal() {
        const state = this._mahjong, queue = dealOrder(state);
        this._mahjongDeal = { wallCount: 32, landedIds: new Set() };
        this._mahjongAnimating = true;
        this._render();
        this._dealMahjongTile(queue, 0);
    },

    _dealMahjongTile(queue, index) {
        if (index >= queue.length) {
            this._mahjongDeal = null;
            this._mahjongAnimating = false;
            this._render();
            this._mahjongPump();
            return;
        }
        const state = this._mahjong, deal = this._mahjongDeal;
        const { seat, tile } = queue[index];
        const from = wallPosition(deal.wallCount - 1);
        deal.wallCount--;
        const to = handPosition(state, seat, tile.id);
        this._render();
        const epoch = this._epoch;
        this._cancelAnimation = startTileFlight(this, [BACK, BACK_CONT], from, to, () => {
            this._cancelAnimation = null;
            if (epoch !== this._epoch || this._mahjong !== state) return;
            deal.landedIds.add(tile.id);
            this._render();
            this._dealMahjongTile(queue, index + 1);
        });
    },

    _startNextMahjongRound() {
        const previous = this._mahjong;
        const next = createRound({
            dealer: previous.result.nextDealer, human: previous.human,
            scores: previous.scores, round: previous.round + 1,
        });
        this._stopAsync();
        this._mahjongTransition = { mode: 'recycle' };
        this._mahjongAnimating = true;
        this._render();
        const pieces = tilePositions(previous);
        if (pieces.length !== 32) {
            this._mahjongFail(new Error('象棋麻將：回收棋子數量錯誤'));
            return;
        }
        const epoch = this._epoch;
        this._cancelAnimation = startRecycleAnimation(this, pieces, () => {
            this._cancelAnimation = null;
            if (epoch !== this._epoch || this._mahjong !== previous) return;
            this._mahjongTransition = { mode: 'shuffle' };
            this._render();
            this._cancelAnimation = startShuffleAnimation(this, () => {
                this._cancelAnimation = null;
                if (epoch !== this._epoch || this._mahjong !== previous) return;
                this._mahjong = next;
                this._mahjongInitial = structuredClone(next);
                this._mahjongCursor = 0;
                this._mahjongError = null;
                this._completed = false;
                this._mahjongTransition = null;
                this._beginMahjongDeal();
            });
        });
    },

    _mahjongPump() {
        if (!this._mahjong || this._dialog || this._mahjongTimer || this._mahjongError || this._mahjongAnimating) return;
        try {
            const state = this._mahjong;
            // Non-decisions do not need a prompt or a computer delay.
            if (state.phase === 'self' && legalActions(state).length === 1) applyAction(state, { type: 'pass' });
            if (state.phase === 'draw' && state.turn === state.human) {
                this._applyMahjongAction({ type: 'draw' });
                return;
            }
            this._completed = state.phase === 'done';
            this._render();
            if (this._completed) return;
            const seat = actor(state), actions = legalActions(state);
            if (seat === state.human) {
                if (state.phase === 'discard') return;
                this._mahjongPrompt(actions); return;
            }
            const epoch = this._epoch;
            this._mahjongTimer = setTimeout(() => {
                this._mahjongTimer = null;
                if (epoch !== this._epoch || this._mahjong !== state || this._dialog) return;
                try {
                    const action = chooseAction(publicView(state, seat), actions);
                    this._applyMahjongAction(action);
                } catch (error) { this._mahjongFail(error); }
            }, 450);
        } catch (error) { this._mahjongFail(error); }
    },

    _mahjongPrompt(actions) {
        const state = this._mahjong, epoch = this._epoch;
        const select = index => {
            this._dialog = null;
            if (epoch !== this._epoch || this._mahjong !== state) return;
            this._mahjongCursor = 0;
            this._applyMahjongAction(actions[index]);
        };
        const tile = state.pending?.tile;
        this._dialog = this.openDialog(SelectDialog, 'cchess-mahjong-action', {
            layout: 'list', footer: false, align: 'center',
            width: 32,
            title: tile ? `${WINDS[state.pending.seat]}家打出 ${CHARS[tile.color][tile.type]}` : '可以自摸',
            options: actions.map(a => a.type === 'pass' ? '過' : a.type === 'win'
                ? state.phase === 'self' ? '自摸' : '胡牌'
                : '吃 ' + [...state.players[state.human].hand.filter(t => a.ids.includes(t.id)), tile]
                    .sort((a, b) => a.kind - b.kind).map(t => CHARS[t.color][t.type]).join('')),
            onSelect: select,
            onCancel: () => select(actions.length - 1),
            keyActions: Object.fromEntries(['h', 'H', 'r', 'R', 'n', 'N', 'q', 'Q', '\x03'].map(key => [key, {
                onAction: data => { this._dialog = null; this._onMahjongKey(data); },
            }])),
        });
    },

    _mahjongFail(error) {
        this._stopAsync();
        this._mahjongError = error.message;
        this._render();
    },

    _confirmMahjong(newMatch) {
        if (this._dialog) return;
        this._stopAsync();
        this._dialog = this.openDialog(ConfirmDialog, 'cchess-mahjong-confirm', {
            title: newMatch ? '重開象棋麻將' : '退出象棋麻將',
            message: newMatch ? '結束本場並重新設定？積分將歸零。' : '確定退出目前的遊戲嗎？',
            confirmLabel: newMatch ? '重開' : '退出', cancelLabel: '繼續', selectedIndex: 1,
            onConfirm: () => { this._dialog = null; newMatch ? this._pickMahjong() : this._quit(); },
            onCancel: () => { this._dialog = null; this._mahjongPump(); },
            onAbort: () => { this._dialog = null; this._quit(); },
        });
    },

    _onMahjongKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        if (code === 3) { this._quit(); return; }
        if (data === 'h' || data === 'H') { this._showMahjongRules(); return; }
        if (data === '\x1B' || data === 27 || data === 'q' || data === 'Q') { this._confirmMahjong(false); return; }
        if (data === 'n' || data === 'N') { this._confirmMahjong(true); return; }
        if (data === 'r' || data === 'R') {
            if (this._mahjongInitial) this._startMahjongRound(structuredClone(this._mahjongInitial));
            return;
        }
        const state = this._mahjong;
        if (!state || this._mahjongError || this._mahjongCallOverlay) return;
        if (this._mahjongAnimating) return;
        if (state.phase === 'done') {
            if (code === 13 || code === 10) this._startNextMahjongRound();
            return;
        }
        if (state.phase !== 'discard' || state.turn !== state.human) return;
        const hand = state.players[state.human].hand;
        if (data === '\x1B[D' || data === '\x1B[C') {
            this._mahjongCursor = Math.max(0, Math.min(hand.length - 1,
                this._mahjongCursor + (data === '\x1B[D' ? -1 : 1)));
            this._render(); return;
        }
        // All other CSI/editing sequences are ignored, never interpreted as Escape.
        if (code === 27) return;
        if (code === 13 || code === 10) {
            this._applyMahjongAction({ type: 'discard', id: hand[this._mahjongCursor].id });
        }
    },
};
