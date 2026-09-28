const cursorMethods = {
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
};

export { cursorMethods };
