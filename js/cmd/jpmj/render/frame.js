import { term } from '../../../system/sys.js';

const frameMethods = {
    _render() {
        term.cursorHidden = true;
        this._clearVB(this._rootVB);
        this._clearVB(this._acrossVB);
        this._clearVB(this._leftVB);
        this._clearVB(this._rightVB);
        this._clearVB(this._playerVB);
        this._clearVB(this._discardVB);
        this._clearVB(this._infoVB);
        this._clearVB(this._resultVB);
        this._updateStatusBar();

        if (this._phase === 'gameOver') {
            this._deactivateSlots();
            this._clearVB(this._rootVB);
            this._renderGameOver(this._rootVB);
        } else {
            if (this._game) {
                this._renderAcrossHand(this._acrossVB);
                this._renderLeftHand(this._leftVB);
                this._renderRightHand(this._rightVB);
                this._renderDiscards(this._discardVB);
                if (this._phase === 'result' && !this._resultPeekHeld) {
                    this._renderResultOverlay(this._resultVB);
                    this._slotResult.active = true;
                } else {
                    this._slotResult.active = false;
                }
                if (this._game.waitingHuman && this._phase === 'playing') {
                    this._actionItems = this._buildActionItems();
                }
                this._renderPlayerHand(this._playerVB);
                this._renderActionBar(this._playerVB);
                this._renderInfoPanel(this._infoVB);
                this._updateSlots();
            } else {
                this._deactivateSlots();
                this._clearVB(this._rootVB);
            }
        }

        term.writeVB(this._rootVB);
    },

    _clearVB(vb) {
        const bc = this._blankCell;
        for (let r = 0; r < vb.height; r++) {
            const row = vb._buffer[r];
            for (let c = 0; c < vb.width; c++) row[c] = bc;
        }
    },

    _clearVBNull(vb) {
        for (let r = 0; r < vb.height; r++) {
            const row = vb._buffer[r];
            for (let c = 0; c < vb.width; c++) row[c] = null;
        }
    },

    _deactivateSlots() {
        this._slotAcross.active = false;
        this._slotLeft.active = false;
        this._slotRight.active = false;
        this._slotDiscard.active = false;
        this._slotPlayer.active = false;
        this._slotInfo.active = false;
        this._slotResult.active = false;
        this._slotStatus.active = false;
    },

    _updateSlots() {
        this._slotAcross.vb = this._acrossVB; this._slotAcross.x = 0;  this._slotAcross.y = 0;  this._slotAcross.active = true;
        this._slotLeft.vb = this._leftVB;     this._slotLeft.x = 0;    this._slotLeft.y = 2;    this._slotLeft.active = true;
        this._slotRight.vb = this._rightVB;   this._slotRight.x = 40;  this._slotRight.y = 0;   this._slotRight.active = true;
        this._slotDiscard.vb = this._discardVB; this._slotDiscard.x = 5; this._slotDiscard.y = 3; this._slotDiscard.active = true;
        this._slotPlayer.vb = this._playerVB; this._slotPlayer.x = 4;  this._slotPlayer.y = 18; this._slotPlayer.active = true;
        this._slotInfo.vb = this._infoVB;     this._slotInfo.x = 44;   this._slotInfo.y = 0;    this._slotInfo.active = true;
        this._slotResult.vb = this._resultVB; this._slotResult.x = 4; this._slotResult.y = 2;
        this._slotStatus.vb = this._statusVB; this._slotStatus.x = 0; this._slotStatus.y = 21; this._slotStatus.active = true;
    },
};

export { frameMethods };
