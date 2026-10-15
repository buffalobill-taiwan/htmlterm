import { FieldPickerDialog } from '../../../dialog/FieldPickerDialog.js';
import { CompactListDialog } from '../../../dialog/CompactListDialog.js';
import { ConfirmDialog } from '../../../dialog/ConfirmDialog.js';
import { ShowDialog } from '../../../dialog/ShowDialog.js';
import { term } from '../../../system/sys.js';
import { makeOverlayGetCell } from '../../../util/sgr.js';
import { buildCallEffectBuffer } from '../../../util/call-effect.js';
import { CHARS } from '../engine/constants.js';
import { WINDS, createRound, actor, legalActions, applyAction, publicView } from './rules.js';
import { chooseAction } from './ai.js';

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

// DialogFrame still owns routing; finish the dialog before invoking game controls.
class ActionDialog extends CompactListDialog {
    constructor(term, opts) { super(term, opts); this._control = opts.onControl; }
    _onKey(data) {
        if (data === '\x03' || /^[hrnq]$/i.test(data)) return this.complete(this._control, data);
        return super._onKey(data);
    }
}

class GameConfirmDialog extends ConfirmDialog {
    constructor(term, opts) { super(term, opts); this._abort = opts.onAbort; }
    _onKey(data) {
        if (data === '\x03') return this.complete(this._abort);
        return super._onKey(data);
    }
}

class SetupDialog extends FieldPickerDialog {
    constructor(term, opts) { super(term, opts); this._abort = opts.onAbort; }
    _onKey(data) {
        if (data === '\x03') return this.complete(this._abort);
        return super._onKey(data);
    }
}

class RulesDialog extends ShowDialog {
    constructor(term, opts) { super(term, opts); this._abort = opts.onAbort; }
    _onKey(data) {
        if (data === '\x03') return this.complete(this._abort);
        return super._onKey(data);
    }
}

const CALL_BUFFERS = new Map();

export const mahjongMethods = {
    _applyMahjongAction(action) {
        const state = this._mahjong, seat = actor(state);
        const text = action.type === 'chi' ? '吃牌'
            : action.type === 'win' ? state.phase === 'self' ? '自摸' : '胡牌' : null;
        applyAction(state, action);
        if (text) {
            this._render();
            const relative = (seat - state.human + 4) % 4;
            if (!CALL_BUFFERS.has(text)) CALL_BUFFERS.set(text, buildCallEffectBuffer(text));
            const buffer = CALL_BUFFERS.get(text);
            const overlay = {
                x: relative < 2 ? 35 : 9, y: relative === 0 || relative === 3 ? 17 : 2,
                w: 10, h: 4, owner: this,
                getCell: makeOverlayGetCell(buffer, 10, 4),
            };
            this._mahjongCallOverlay = overlay;
            term.addOverlay(overlay);
            for (let row = overlay.y; row < overlay.y + overlay.h; row++) term.markRowDirty(row);
            const epoch = this._epoch;
            this._mahjongTimer = setTimeout(() => {
                this._mahjongTimer = null;
                this._removeMahjongCallEffect();
                if (epoch === this._epoch && this._mahjong === state) this._mahjongPump();
            }, 500);
        }
        this._mahjongPump();
    },

    _removeMahjongCallEffect() {
        const overlay = this._mahjongCallOverlay;
        if (!overlay) return;
        term.removeOverlay(overlay);
        for (let row = overlay.y; row < overlay.y + overlay.h; row++) term.markRowDirty(row);
        this._mahjongCallOverlay = null;
    },

    _showMahjongRules() {
        if (!this._mahjong || this._dialog) return;
        this._stopAsync();
        const state = this._mahjong, epoch = this._epoch;
        this._dialog = this.openDialog(RulesDialog, 'cchess-mahjong-rules', {
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
        this._dialog = this.openDialog(SetupDialog, 'cchess-mahjong-setup', {
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
        this._mahjongPump();
    },

    _mahjongPump() {
        if (!this._mahjong || this._dialog || this._mahjongTimer || this._mahjongError) return;
        try {
            const state = this._mahjong;
            // Non-decisions do not need a prompt or a computer delay.
            if (state.phase === 'self' && legalActions(state).length === 1) applyAction(state, { type: 'pass' });
            if (state.phase === 'draw' && state.turn === state.human) {
                applyAction(state, { type: 'draw' });
                this._mahjongCursor = Math.max(0, state.players[state.human].hand.length - 1);
                this._mahjongPump(); return;
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
        this._dialog = this.openDialog(ActionDialog, 'cchess-mahjong-action', {
            width: 32,
            title: tile ? `${WINDS[state.pending.seat]}家打出 ${CHARS[tile.color][tile.type]}` : '可以自摸',
            options: actions.map(a => a.type === 'pass' ? '過' : a.type === 'win'
                ? state.phase === 'self' ? '自摸' : '胡牌'
                : '吃 ' + [...state.players[state.human].hand.filter(t => a.ids.includes(t.id)), tile]
                    .sort((a, b) => a.kind - b.kind).map(t => CHARS[t.color][t.type]).join('')),
            onSelect: select,
            onCancel: () => select(actions.length - 1),
            onControl: data => { this._dialog = null; this._onMahjongKey(data); },
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
        this._dialog = this.openDialog(GameConfirmDialog, 'cchess-mahjong-confirm', {
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
        if (state.phase === 'done') {
            if (code === 13 || code === 10) this._startMahjongRound(createRound({
                dealer: state.result.nextDealer, human: state.human, scores: state.scores, round: state.round + 1,
            }));
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
            applyAction(state, { type: 'discard', id: hand[this._mahjongCursor].id });
            this._mahjongCursor = 0;
            this._mahjongPump();
        }
    },
};
