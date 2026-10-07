import { term } from '../../../system/sys.js';

const keysMethods = {
    handleKeyUp(key) {
        if (key === 'Tab') this._setPeekHeld(false);
    },

    _setPeekHeld(held) {
        if (held === this._peekHeld) return;
        this._peekHeld = held;
        if (!this.closed && this._phase === 'result') this._render();
        if (this._pauseOverlay) {
            for (let r = this._pauseOverlay.y; r < this._pauseOverlay.y + this._pauseOverlay.h; r++)
                term.markRowDirty(r);
        }
    },

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if ((code === 0x09 || data === '\x1B[Z') &&
            (this._phase === 'result' || this._phase === 'paused')) {
            this._setPeekHeld(true);
            return;
        }
        if (this._peekHeld) return;

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
        const hand = this._game.players[0].hand;

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
            if (s !== '\x1B' && data !== 0x1B) return;   // unknown sequence: ignore
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
            if (s !== '\x1B' && data !== 0x1B) return;   // unknown sequence: ignore
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
};

export { keysMethods };
