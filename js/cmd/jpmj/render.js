import { term } from '../../system/sys.js';
import { makeCell } from '../../util/sgr.js';
import { displayWidth } from '../../util/display-width.js';
import { tileFg } from './tiles.js';
import { getWaitingTiles, evaluateHand, getRankLabel } from './yaku.js';

const MELD_BG = {
    chi:  [17, 18, 19, 20],
    pon:  [22, 28, 34, 40],
    kan:  [53, 54, 55, 56],
};

function meldBg(type, callIndex) {
    const colors = MELD_BG[type];
    return colors[Math.min(callIndex, colors.length - 1)];
}

function meldTypeToBg(m) {
    if (m.type === 'kan') return 'kan';
    if (m.type === 'triplet') return 'pon';
    return 'chi';
}

function countCallType(melds, type) {
    let n = 0;
    for (const m of melds) {
        if (meldTypeToBg(m) === type) n++;
    }
    return n;
}

function formatScore(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const renderMixin = {
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
                if (this._phase === 'result') {
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

    _writeTile2x2(buf, row, col, pal) {
        if (!buf[row] || !buf[row + 1]) return;
        buf[row][col]     = pal.top;
        buf[row][col + 1] = pal.topCont;
        buf[row + 1][col] = pal.bot;
        buf[row + 1][col + 1] = pal.botCont;
    },

    _writeTileH(buf, row, col, cells) {
        if (!buf[row]) return;
        for (let i = 0; i < cells.length; i++) buf[row][col + i] = cells[i];
    },

    _writeCover2x2(buf, row, col, cell) {
        if (!buf[row] || !buf[row + 1]) return;
        buf[row][col] = cell; buf[row][col + 1] = cell;
        buf[row + 1][col] = cell; buf[row + 1][col + 1] = cell;
    },

    _writeCoverRow(buf, row, col, bg) {
        if (!buf[row]) return;
        const cells = this._getCoverRow(bg);
        buf[row][col] = cells[0]; buf[row][col + 1] = cells[1];
        buf[row][col + 2] = cells[2]; buf[row][col + 3] = cells[3];
    },

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

    _renderInfoPanel(vb) {
        const g = this._game;
        if (!g) return;
        const buf = vb._buffer;
        const bv = this._cellBorderV;
        const cover = this._cellCover;

        for (let r = 0; r < 21; r++) buf[r][0] = bv;

        vb.writeStr(0, 1, '\x1B[1;36m' + g.roundLabel + '\x1B[0m');

        const statsLine = g.honbaLabel
            + ' 残り:' + String(g.wall.getRemainingCount()).padStart(2, '0') + '枚'
            + ' 供托:' + String(g.riichiSticks) + '本'
            + ' 本棒:' + String(g.honba);
        vb.writeStr(1, 1, statsLine);

        const doraIndicators = g.doraIndicators;
        const doraCount = doraIndicators.length;
        const showUra = g.roundResult && g.roundResult.winnerRiichi;
        const uraIndicators = showUra ? g.wall.getUraDoraIndicators() : [];

        vb.writeStr(2, 1, '　ドラ：');
        for (let i = 0; i < 5; i++) {
            const col = 9 + i * 3;
            if (i < doraCount) {
                const pal = this._palNormal[doraIndicators[i].key()];
                buf[2][col] = pal.top; buf[2][col + 1] = pal.topCont;
                buf[3][col] = pal.bot; buf[3][col + 1] = pal.botCont;
            } else {
                buf[2][col] = cover; buf[2][col + 1] = cover;
                buf[3][col] = cover; buf[3][col + 1] = cover;
            }
        }

        vb.writeStr(4, 1, '裏ドラ：');
        for (let i = 0; i < 5; i++) {
            const col = 9 + i * 3;
            if (showUra && i < doraCount && uraIndicators[i]) {
                const pal = this._palNormal[uraIndicators[i].key()];
                buf[4][col] = pal.top; buf[4][col + 1] = pal.topCont;
                buf[5][col] = pal.bot; buf[5][col + 1] = pal.botCont;
            } else {
                buf[4][col] = cover; buf[4][col + 1] = cover;
                buf[5][col] = cover; buf[5][col + 1] = cover;
            }
        }

        vb.writeStr(6, 1, '─'.repeat(34));

        const winds = ['東', '南', '西', '北'];
        const sorted = [0, 1, 2, 3].sort((a, b) => {
            const pa = g.players[a], pb = g.players[b];
            if (pb.score !== pa.score) return pb.score - pa.score;
            return a - b;
        });
        const deltas = (this._phase === 'result' && g.roundResult && g.roundResult.deltas) ? g.roundResult.deltas : null;
        for (let row = 0; row < 4; row++) {
            const pi = sorted[row];
            const p = g.players[pi];
            const windChar = winds[p.seatWind - 1] || '?';
            const riichi = p.isRiichi ? '\x1B[91;107m⬤\x1B[0m' : '  ';
            const namePad = ' '.repeat(6 - displayWidth(p.name));
            const dealer = pi === g.dealerIndex ? '親' : '  ';
            const scoreStr = String(p.score).replace(/\B(?=(\d{3})+(?!\d))/g, ',').padStart(6);
            let line = windChar + ' ' + riichi + p.name + namePad + ' ' + dealer + ' ' + scoreStr;
            if (deltas) {
                const delta = deltas[pi];
                if (delta !== 0) {
                    const sign = delta > 0 ? '+' : '';
                    const deltaStr = sign + String(delta).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                    const color = delta > 0 ? '\x1B[32m' : '\x1B[31m';
                    line += '  ' + color + deltaStr + '\x1B[0m';
                }
            }
            const y = 7 + row;
            vb.writeStr(y, 1, line);
        }

        vb.writeStr(11, 1, '─'.repeat(34));

        const logs = g.log.slice(-9);
        for (let i = 0; i < 9; i++) {
            if (i < logs.length) {
                const entry = logs[i];
                const text = entry.player + ' ' + entry.action + (entry.detail ? ' ' + entry.detail : '');
                const truncated = text.length > 33 ? text.substring(0, 32) + '…' : text;
                vb.writeStr(12 + i, 1, truncated);
            }
        }
    },

    _renderResultOverlay(vb) {
        const g = this._game;
        const r = g.roundResult;
        if (!r) return;

        const ow = 36, oh = 16;

        vb.writeStr(0, 0, '┌' + '─'.repeat(ow - 2) + '┐');
        vb.writeStr(oh - 1, 0, '└' + '─'.repeat(ow - 2) + '┘');
        for (let rr = 1; rr < oh - 1; rr++) {
            vb.writeStr(rr, 0, '│');
            vb.writeStr(rr, ow - 1, '│');
        }

        if (r.winner >= 0) {
            const winner = g.players[r.winner];
            const isTsumo = r.winType === 'tsumo';
            let title = winner.name + (isTsumo ? ' ツモ' : ' ロン');
            if (!isTsumo && r.discarder >= 0) {
                title += ' | 放銃：' + g.players[r.discarder].name;
            }
            vb.writeStr(1, 2, '\x1B[1;33m' + title + '\x1B[0m');

            let y = 3;
            if (r.yaku) {
                for (const yaku of r.yaku) {
                    const hanStr = yaku.han + '飜';
                    const nameStr = yaku.name;
                    vb.writeStr(y, 2, hanStr + ' ' + nameStr);
                    y++;
                    if (y >= oh - 4) break;
                }
            }
            if (r.doraHan > 0 && y < oh - 4) {
                vb.writeStr(y++, 2, r.doraHan + '飜 ドラ');
            }
            if (r.uraDoraHan > 0 && y < oh - 4) {
                vb.writeStr(y++, 2, r.uraDoraHan + '飜 裏ドラ');
            }

            y = oh - 5;
            const rankLabel = getRankLabel(r.totalHan, r.fu, r.isYakuman, r.yaku);
            const hanFu = rankLabel || (r.totalHan + '飜' + r.fu + '符');
            const points = r.payments ? r.payments.total : 0;
            vb.writeStr(y, 2, '\x1B[1m' + hanFu + '  ' + String(points) + '点\x1B[0m');

            if (r.payments) {
                y++;
                if (r.payments.type === 'tsumo') {
                    if (r.winner === g.dealerIndex) {
                        vb.writeStr(y, 2, '各 ' + r.payments.dealerPayment + ' 点');
                    } else {
                        vb.writeStr(y, 2, '子' + r.payments.childPayment + ' 親' + r.payments.dealerPayment);
                    }
                } else {
                    const disc = g.players[r.discarder];
                    vb.writeStr(y, 2, disc.name + ' 支払 ' + r.payments.discarderPayment);
                }
            }
        } else {
            const reasons = {
                exhaustive: '流局 — 荒牌平局',
                kyuushu_kyuuhai: '流局 — 九種九牌',
                suufon_rendai: '流局 — 四風連打',
                suukantsu_abort: '流局 — 四槓散了',
                suucha_riichi: '流局 — 四家立直',
                sancha_ron: '流局 — 三家和了',
            };
            vb.writeStr(1, 2, '\x1B[1;33m' + (reasons[r.winType] || '流局') + '\x1B[0m');

            if (r.tenpaiPlayers && r.tenpaiPlayers.length > 0) {
                const tenpaiNames = r.tenpaiPlayers.map(i => g.players[i].name).join(' ');
                vb.writeStr(3, 2, '聴牌: ' + tenpaiNames);
            }
            if (r.notenPlayers && r.notenPlayers.length > 0) {
                const notenNames = r.notenPlayers.map(i => g.players[i].name).join(' ');
                vb.writeStr(4, 2, '不聴: ' + notenNames);
            }
        }

        const enterY = oh - 2;
        vb.writeStr(enterY, 4, '\x1B[36mENTER で次の局へ\x1B[0m');
    },

    _renderGameOver(vb) {
        const g = this._game;
        if (!g) return;
        const buf = vb._buffer;
        const bw = this._cellBorderW;
        const TOP = 1, FH = 22;
        const BOT = TOP + FH - 1;

        vb.writeStr(TOP, 0, '┌' + '─'.repeat(78) + '┐');
        for (let r = TOP + 1; r < BOT; r++) { buf[r][0] = bw; buf[r][79] = bw; }
        vb.writeStr(BOT, 0, '└' + '─'.repeat(78) + '┘');

        const padEndW = (s, w) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));
        const padStartW = (s, w) => ' '.repeat(Math.max(0, w - displayWidth(s))) + s;
        const centerX = (s) => 1 + Math.floor((78 - displayWidth(s)) / 2);
        const putCentered = (row, s) => vb.writeStr(row, centerX(s), s);

        const scores = g.getFinalScores();
        const GAP = ' '.repeat(2);
        const rankW = Math.max(displayWidth('順位'), ...scores.map(s => displayWidth(s.rank + '位')));
        const nameW = Math.max(displayWidth('名前'), ...scores.map(s => displayWidth(s.name)));
        const scoreW = Math.max(displayWidth('点数'), ...scores.map(s => formatScore(s.score).length));
        const cntW = 4;

        const header =
            padEndW('順位', rankW) + GAP +
            padEndW('名前', nameW) + GAP +
            padStartW('点数', scoreW) + GAP +
            padStartW('ツモ', cntW) + GAP +
            padStartW('ロン', cntW) + GAP +
            padStartW('放銃', cntW);
        const rows = scores.map(s =>
            padEndW(s.rank + '位', rankW) + GAP +
            padEndW(s.name, nameW) + GAP +
            padStartW(formatScore(s.score), scoreW) + GAP +
            padStartW(String(s.tsumo), cntW) + GAP +
            padStartW(String(s.ron), cntW) + GAP +
            padStartW(String(s.dealtIn), cntW));
        const tableW = displayWidth(header);

        vb.writeStr(3, centerX('最終結果'), '\x1B[1;33m最終結果\x1B[0m');
        putCentered(5, header);
        putCentered(6, '─'.repeat(tableW));
        for (let i = 0; i < rows.length; i++) putCentered(7 + i, rows[i]);

        const summary = '連莊 ' + g.renchanCount + ' ／ 總局數 ' + g.roundCount + ' ／ 流局 ' + g.ryuukyokuCount;
        putCentered(13, summary);

        vb.writeStr(20, centerX('按 ENTER 返回'), '\x1B[36m按 ENTER 返回\x1B[0m');
    },

    _updateStatusBar() {
        if (!this._statusVB) return;
        const row = this._statusVB._buffer[0];
        const fg = this._autoPlay ? 15 : 8;
        const bold = this._autoPlay;
        row[5] = makeCell('[', fg, 17, bold);
        row[6] = makeCell('A', fg, 17, bold);
        row[7] = makeCell(']', fg, 17, bold);
        row[8] = makeCell('託', fg, 17, bold, 2);
        row[9] = makeCell(' ', fg, 17, bold, 0);
        row[10] = makeCell('管', fg, 17, bold, 2);
        row[11] = makeCell(' ', fg, 17, bold, 0);

        const riichi = this._game && this._game.players && this._game.players[0] && this._game.players[0].isRiichi;
        if (riichi) {
            row[13] = makeCell('⬤', 9, 15, true, 2);
            row[14] = makeCell(' ', 9, 15, false, 0);
            row[15] = makeCell('立', 15, 17, true, 2);
            row[16] = makeCell(' ', 15, 17, false, 0);
            row[17] = makeCell('直', 15, 17, true, 2);
            row[18] = makeCell(' ', 15, 17, false, 0);
        } else {
            row[13] = makeCell('　', 8, 17, false, 2);
            row[14] = makeCell(' ', 8, 17, false, 0);
            row[15] = makeCell('立', 8, 17, false, 2);
            row[16] = makeCell(' ', 8, 17, false, 0);
            row[17] = makeCell('直', 8, 17, false, 2);
            row[18] = makeCell(' ', 8, 17, false, 0);
        }

        const tenpai = this._getTenpaiInfo();
        row[19] = makeCell('|', 7, 17, false);
        const tenpaiStart = 20;
        for (let c = tenpaiStart; c < 80; c++) row[c] = makeCell(' ', 7, 17, false);
        if (!tenpai) return;

        const isFuriten = tenpai.furitenWaits.length > 0;
        const furitenSet = new Set(tenpai.furitenWaits.map(w => w.key()));
        const deadSet = new Set(tenpai.deadWaits.map(w => w.key()));
        const label = isFuriten ? '聽(振聽): ' : tenpai.hasYaku ? '聽: ' : '聽(無役): ';
        const labelFg = isFuriten ? 1 : tenpai.hasYaku ? 15 : 1;
        const labelBold = !isFuriten && tenpai.hasYaku;
        let col = tenpaiStart;
        for (let i = 0; i < label.length && col < 80; i++) {
            row[col] = makeCell(label[i], labelFg, 17, labelBold);
            col++;
        }
        for (let wi = 0; wi < tenpai.waits.length && col < 80; wi++) {
            const w = tenpai.waits[wi];
            const wfg = (furitenSet.has(w.key()) || deadSet.has(w.key())) ? 8 : tileFg(w.suit, w.value);
            const name = w.name;
            for (let i = 0; i < name.length && col < 80; i++) {
                row[col] = makeCell(name[i], wfg, 17, false);
                col++;
            }
            if (col < 80) { row[col] = makeCell(' ', 7, 17, false); col++; }
        }
    },

    _getTenpaiInfo() {
        const g = this._game;
        if (!g || g.gameOver) return null;
        const p = g.players[0];
        const hand = p.hand;
        const meldCount = p.melds.length;
        const expectedLen = 13 - 3 * meldCount;
        if (expectedLen < 0) return null;

        const isDiscardPhase = (g.phase === 'discard' || g.phase === 'dealer_first_discard') && g.waitingHuman;
        let removeIdx;
        if (isDiscardPhase && this._cursorMode === 'hand') {
            removeIdx = this._visualToHandIdx(this._handCursor);
        } else {
            const drawnTile = p.lastDraw;
            removeIdx = drawnTile ? hand.indexOf(drawnTile) : -1;
        }
        let baseHand;
        if (removeIdx >= 0 && removeIdx < hand.length) {
            baseHand = hand.filter((_, i) => i !== removeIdx);
        } else {
            baseHand = hand;
        }
        if (baseHand.length !== expectedLen) return null;

        const handStr = baseHand.map(t => t.key()).join(',') + '|' + meldCount + '|' + p.discards.length;
        if (this._tenpaiCache && handStr === this._tenpaiCache.handStr) return this._tenpaiCache.info;

        const waits = getWaitingTiles(baseHand, p.melds);
        if (waits.length === 0) {
            this._tenpaiCache = { handStr, info: null };
            return null;
        }
        const gs = g.getGameState(0, waits[0], 'tsumo');
        const deadWaits = waits.filter(w => evaluateHand(baseHand, p.melds, w, 'tsumo', gs) === null);
        const hasYaku = deadWaits.length < waits.length;
        const discardKeys = new Set(p.discards.map(d => d.key()));
        const furitenWaits = waits.filter(w => discardKeys.has(w.key()));
        const info = { waits, hasYaku, deadWaits, furitenWaits };
        this._tenpaiCache = { handStr, info };
        return info;
    },
};