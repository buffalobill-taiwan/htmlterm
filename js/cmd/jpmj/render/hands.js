import { meldTypeToBg, meldBg, countCallType } from './tiles.js';

const handsMethods = {
    _renderPlayerHand(vb) {
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const drawTile = p.lastDraw || (this._phase === 'result' ? p.ronTile : null);
        const melds = p.melds;
        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;
        const buf = vb._buffer;

        const meldTiles = [];
        for (const m of melds) {
            for (const t of m.tiles) meldTiles.push(t);
        }

        const handCount = drawIdx >= 0 ? hand.length - 1 : hand.length;
        const handCols = handCount * 2;
        const gapBeforeDraw = 1;
        const drawCols = 2;
        const gapBeforeMeld = melds.length > 0 ? 1 : 0;
        const meldCols = meldTiles.length * 2;
        const totalCols = handCols + gapBeforeDraw + drawCols + gapBeforeMeld + meldCols;
        const startCol = Math.floor((40 - totalCols) / 2);

        let col = startCol;
        let visPos = 0;
        const isDiscardPhase = (g.phase === 'discard' || g.phase === 'dealer_first_discard') && g.waitingHuman;
        const discardableIndices = isDiscardPhase ? this._getDiscardableIndices() : [];
        const showCursor = g.waitingHuman && this._phase === 'playing';

        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            const tile = hand[i];
            const key = tile.key();
            const isCursor = showCursor && (this._cursorMode === 'hand' && this._handCursor === visPos);
            const canDiscard = discardableIndices.includes(visPos);
            let pal;
            if (isCursor && !canDiscard && isDiscardPhase) pal = this._palCursorDark[key];
            else if (isCursor) pal = this._palCursor[key];
            else pal = this._palNormal[key];
            this._writeTile2x2(buf, 1, col, pal);
            col += 2;
            visPos++;
        }

        col += gapBeforeDraw;
        if (drawTile) {
            const key = drawTile.key();
            const isRonDraw = this._phase === 'result' && p.ronTile && drawTile.equals(p.ronTile);
            const isCursor = showCursor && (this._cursorMode === 'hand' && this._handCursor === hand.length - 1);
            const canDiscard = discardableIndices.includes(hand.length - 1);
            let pal;
            if (isRonDraw) pal = this._getRonPal2x2(key);
            else if (isCursor && !canDiscard && isDiscardPhase) pal = this._palCursorDark[key];
            else if (isCursor) pal = this._palCursor[key];
            else pal = this._palNormal[key];
            this._writeTile2x2(buf, 1, col, pal);
        }
        col += drawCols;

        if (melds.length > 0) {
            col += 1;
            for (let mi = 0; mi < melds.length; mi++) {
                const m = melds[mi];
                const bgType = meldTypeToBg(m);
                const bg = meldBg(bgType, countCallType(melds.slice(0, mi), bgType));
                const isClosedKan = m.type === 'kan' && !m.open;
                for (let ti = 0; ti < m.tiles.length; ti++) {
                    if (isClosedKan && (ti === 1 || ti === 2)) {
                        this._writeCover2x2(buf, 1, col, this._getCover2x2('▓', 240, bg)[0]);
                    } else {
                        const pal = this._getMeldPal2x2(m.tiles[ti].key(), bg);
                        this._writeTile2x2(buf, 1, col, pal);
                    }
                    col += 2;
                }
            }
        }
    },

    _renderActionBar(vb) {
        const items = this._actionItems;
        if (items.length === 0 && this._cursorMode !== 'chiSelect' && this._cursorMode !== 'kanSelect') return;

        const buf = vb._buffer;
        const bc = this._blankCell;
        for (let c = 0; c < 40; c++) buf[0][c] = bc;

        let displayItems;
        let selectedIdx = -1;
        if (this._cursorMode === 'chiSelect' && this._chiOptions.length > 0) {
            displayItems = this._chiOptions.map((opt, i) => ({
                label: 'チー' + (i + 1),
                action: opt,
            }));
            selectedIdx = this._subMenuCursor;
        } else if (this._cursorMode === 'kanSelect' && this._kanOptions.length > 0) {
            displayItems = this._kanOptions.map((opt, i) => ({
                label: opt.desc || ('槓' + (i + 1)),
                action: opt,
            }));
            selectedIdx = this._subMenuCursor;
        } else {
            displayItems = items;
            selectedIdx = this._cursorMode === 'action' ? this._actionCursor : -1;
        }

        if (displayItems.length === 0) return;

        const bar = [];
        for (let i = 0; i < displayItems.length; i++) {
            const item = displayItems[i];
            const sel = selectedIdx === i;
            if (sel) bar.push('\x1B[7m\x1B[1m');
            bar.push(item.label);
            if (sel) bar.push('\x1B[0m');
            if (i < displayItems.length - 1) bar.push(' ');
        }

        let x = 0;
        const str = bar.join('');
        const plain = displayItems.map(i => i.label).join(' ');
        const pad = Math.max(0, 40 - plain.length);
        x += Math.floor(pad / 2);
        vb.writeStr(0, x, str);
    },

    _renderAcrossHand(vb) {
        const g = this._game;
        const across = g.players[2];
        const hand = across.hand;
        const melds = across.melds;
        const buf = vb._buffer;
        const reveal = this._phase === 'result';
        const drawTile = across.lastDraw || (reveal ? across.ronTile : null);
        const cover2x2 = this._getCover2x2('▓', 240, 236);

        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;
        const hasDraw = !!drawTile;
        const handDisplay = hand.length - (drawIdx >= 0 ? 1 : 0);

        const meldTileCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const meldCols = meldTileCount * 2;
        const gapBeforeDraw = 1;
        const drawCols = 2;
        const gapBeforeHand = 1;
        const handCols = handDisplay * 2;
        const totalCols = meldCols + gapBeforeDraw + drawCols + gapBeforeHand + handCols;
        const startCol = Math.floor((40 - totalCols) / 2);

        let col = startCol;
        for (let mi = melds.length - 1; mi >= 0; mi--) {
            const m = melds[mi];
            const bgType = meldTypeToBg(m);
            const bg = meldBg(bgType, countCallType(melds.slice(mi + 1), bgType));
            const isClosedKan = m.type === 'kan' && !m.open;
            for (let ti = 0; ti < m.tiles.length; ti++) {
                if (isClosedKan && (ti === 1 || ti === 2)) {
                    this._writeCover2x2(buf, 0, col, this._getCover2x2('▓', 240, bg)[0]);
                } else {
                    const pal = this._getMeldPal2x2(m.tiles[ti].key(), bg);
                    this._writeTile2x2(buf, 0, col, pal);
                }
                col += 2;
            }
        }
        col += gapBeforeDraw;
        if (hasDraw) {
            const isRonDraw = drawTile && across.ronTile && drawTile.equals(across.ronTile);
            if (reveal && isRonDraw) {
                this._writeTile2x2(buf, 0, col, this._getRonPal2x2(drawTile.key()));
            } else if (reveal) {
                this._writeTile2x2(buf, 0, col, this._palNormal[drawTile.key()]);
            } else {
                this._writeCover2x2(buf, 0, col, cover2x2[0]);
            }
        }
        col += drawCols;
        col += gapBeforeHand;
        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._writeTile2x2(buf, 0, col, this._palNormal[hand[i].key()]);
            } else {
                this._writeCover2x2(buf, 0, col, cover2x2[0]);
            }
            col += 2;
        }
    },

    _renderLeftHand(vb) {
        const g = this._game;
        const left = g.players[3];
        const hand = left.hand;
        const melds = left.melds;
        const buf = vb._buffer;
        const reveal = this._phase === 'result';
        const drawTile = reveal ? (left.lastDraw || left.ronTile) : left.lastDraw;

        const drawIdx = drawTile ? hand.findIndex(t => t.equals(drawTile)) : -1;
        const hasDraw = !!drawTile;
        const handDisplay = hand.length - (drawIdx >= 0 ? 1 : 0);
        const meldCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const base = handDisplay + 1 + meldCount;
        const spare = 18 - base;
        const gapAfterHand = spare >= 3 ? 1 : 0;
        const gapAfterDraw = spare >= 1 ? 1 : 0;
        const startRow = Math.floor((18 - base) / 2);

        let row = startRow;

        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[hand[i].key()]);
            } else {
                this._writeCoverRow(buf, row, 0, 236);
            }
            row++;
        }
        row += gapAfterHand;
        if (hasDraw) {
            const isRonDraw = drawTile && left.ronTile && drawTile.equals(left.ronTile);
            if (reveal && isRonDraw) {
                this._writeTileH(buf, row, 0, this._getRonPalHoriz(drawTile.key()));
            } else if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[drawTile.key()]);
            } else {
                this._writeCoverRow(buf, row, 0, 236);
            }
        }
        row++;
        row += gapAfterDraw;
        for (let mi = 0; mi < melds.length; mi++) {
            const m = melds[mi];
            const bgType = meldTypeToBg(m);
            const bg = meldBg(bgType, countCallType(melds.slice(0, mi), bgType));
            const isClosedKan = m.type === 'kan' && !m.open;
            for (let ti = 0; ti < m.tiles.length; ti++) {
                if (isClosedKan && (ti === 1 || ti === 2)) {
                    this._writeCoverRow(buf, row, 0, bg);
                } else {
                    this._writeTileH(buf, row, 0, this._getMeldPalHoriz(m.tiles[ti].key(), bg));
                }
                row++;
            }
        }
    },

    _renderRightHand(vb) {
        const g = this._game;
        const right = g.players[1];
        const hand = right.hand;
        const melds = right.melds;
        const buf = vb._buffer;
        const reveal = this._phase === 'result';
        const drawTile = reveal ? (right.lastDraw || right.ronTile) : right.lastDraw;

        const drawIdx = drawTile ? hand.findIndex(t => t.equals(drawTile)) : -1;
        const hasDraw = !!drawTile;
        const handDisplay = hand.length - (drawIdx >= 0 ? 1 : 0);
        const meldCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const base = handDisplay + 1 + meldCount;
        const spare = 18 - base;
        const gapAfterMelds = spare >= 3 ? 1 : 0;
        const gapAfterDraw = spare >= 1 ? 1 : 0;
        const startRow = Math.floor((18 - base) / 2);

        let row = startRow;

        for (let mi = melds.length - 1; mi >= 0; mi--) {
            const m = melds[mi];
            const bgType = meldTypeToBg(m);
            const bg = meldBg(bgType, countCallType(melds.slice(mi + 1), bgType));
            const isClosedKan = m.type === 'kan' && !m.open;
            for (let ti = 0; ti < m.tiles.length; ti++) {
                if (isClosedKan && (ti === 1 || ti === 2)) {
                    this._writeCoverRow(buf, row, 0, bg);
                } else {
                    this._writeTileH(buf, row, 0, this._getMeldPalHoriz(m.tiles[ti].key(), bg));
                }
                row++;
            }
        }
        row += gapAfterMelds;
        if (hasDraw) {
            const isRonDraw = drawTile && right.ronTile && drawTile.equals(right.ronTile);
            if (reveal && isRonDraw) {
                this._writeTileH(buf, row, 0, this._getRonPalHoriz(drawTile.key()));
            } else if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[drawTile.key()]);
            } else {
                this._writeCoverRow(buf, row, 0, 236);
            }
        }
        row++;
        row += gapAfterDraw;
        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[hand[i].key()]);
            } else {
                this._writeCoverRow(buf, row, 0, 236);
            }
            row++;
        }
    },
};

export { handsMethods };
