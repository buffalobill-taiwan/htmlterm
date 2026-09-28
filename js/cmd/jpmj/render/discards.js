const discardsMethods = {
    _renderDiscardTile(buf, row, col, tile, isLatest, isCalled) {
        const key = tile.key();
        if (isCalled) {
            this._writeTile2x2(buf, row, col, this._getDimPal2x2(key));
        } else {
            let pal;
            if (isLatest) pal = this._palCursor[key];
            else pal = this._palNormal[key];
            this._writeTile2x2(buf, row, col, pal);
        }
    },

    _renderDiscards(vb) {
        const g = this._game;
        if (!g) return;
        const buf = vb._buffer;

        const quadrants = [
            { playerIdx: 2, startCol: 0, startRow: 0 },
            { playerIdx: 1, startCol: 18, startRow: 0 },
            { playerIdx: 3, startCol: 0, startRow: 7 },
            { playerIdx: 0, startCol: 18, startRow: 7 },
        ];

        for (const q of quadrants) {
            const discards = g.players[q.playerIdx].discards;
            const isLatest = g.lastDiscardPlayer === q.playerIdx;
            for (let i = 0; i < discards.length; i++) {
                const col = q.startCol + (i % 8) * 2;
                const row = q.startRow + Math.floor(i / 8) * 2;
                const tile = discards[i];
                const latest = isLatest && i === discards.length - 1;
                const called = tile.called || false;
                this._renderDiscardTile(buf, row, col, tile, latest, called);
            }
        }
    },
};

export { discardsMethods };
