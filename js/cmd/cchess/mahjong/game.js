import { FieldPickerDialog } from '../../../dialog/FieldPickerDialog.js';
import { CompactListDialog } from '../../../dialog/CompactListDialog.js';
import { ConfirmDialog } from '../../../dialog/ConfirmDialog.js';
import { CHARS } from '../engine/constants.js';
import { WINDS, createRound, actor, legalActions, applyAction, publicView } from './rules.js';
import { chooseAction } from './ai.js';

// DialogFrame still owns routing; finish the dialog before invoking game controls.
class ActionDialog extends CompactListDialog {
    constructor(term, opts) { super(term, opts); this._control = opts.onControl; }
    _onKey(data) {
        if (data === '\x03' || /^[rnq]$/i.test(data)) return this.complete(this._control, data);
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

export const mahjongMethods = {
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
                    applyAction(state, action);
                    this._mahjongPump();
                } catch (error) { this._mahjongFail(error); }
            }, 450);
        } catch (error) { this._mahjongFail(error); }
    },

    _mahjongPrompt(actions) {
        const state = this._mahjong, epoch = this._epoch;
        const select = index => {
            this._dialog = null;
            if (epoch !== this._epoch || this._mahjong !== state) return;
            applyAction(state, actions[index]);
            this._mahjongCursor = 0;
            this._mahjongPump();
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
        if (data === '\x1B' || data === 27 || data === 'q' || data === 'Q') { this._confirmMahjong(false); return; }
        if (data === 'n' || data === 'N') { this._confirmMahjong(true); return; }
        if (data === 'r' || data === 'R') {
            if (this._mahjongInitial) this._startMahjongRound(structuredClone(this._mahjongInitial));
            return;
        }
        const state = this._mahjong;
        if (!state || this._mahjongError) return;
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
