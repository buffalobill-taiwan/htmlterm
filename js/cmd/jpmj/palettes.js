import { makeCell } from '../../util/sgr.js';
import { isWide } from '../../util/display-width.js';
import { Tile, tileFg } from './tiles.js';

export const palettesMixin = {
    _initPalettes() {
        if (this._palettesReady) return;
        this._palettesReady = true;

        this._cellW0 = { ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false,
            underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };

        this._blankCell = { ch: ' ', fg: 7, bg: 0, bold: false, dim: false, italic: false,
            underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };

        this._cellBorderV = { ch: '│', fg: 8, bg: 0, bold: false, dim: false, italic: false,
            underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };

        this._cellBorderW = { ch: '│', fg: 7, bg: 0, bold: false, dim: false, italic: false,
            underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };

        this._cellBorderY = { ch: '│', fg: 33, bg: 0, bold: false, dim: false, italic: false,
            underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };

        this._cellCover = { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false,
            underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 };

        this._coverRowCache = {};
        this._cover2x2Cache = {};
        this._meldPal2x2 = {};
        this._meldPalHoriz = {};
        this._dimPal2x2 = {};
        this._dimPalHoriz = {};
        this._ronPal2x2 = {};
        this._ronPalHoriz = {};

        this._palNormal = {};
        this._palCursor = {};
        this._palCursorDark = {};
        this._palHorizNormal = {};
        this._palHorizCursor = {};

        const allTiles = Tile.allTiles();
        const seen = new Set();
        for (const tile of allTiles) {
            const key = tile.key();
            if (seen.has(key)) continue;
            seen.add(key);
            const fg = tileFg(tile.suit, tile.value);

            const topCh = tile.displayTop[0] || ' ';
            const botCh = tile.displayBottom[0] || ' ';
            this._palNormal[key] = {
                top: makeCell(topCh, fg, 0, true, isWide(topCh) ? 2 : 1),
                topCont: this._cellW0,
                bot: makeCell(botCh, fg, 0, true, isWide(botCh) ? 2 : 1),
                botCont: this._cellW0,
            };
            this._palCursor[key] = {
                top: makeCell(topCh, fg, 24, true, isWide(topCh) ? 2 : 1),
                topCont: this._cellW0,
                bot: makeCell(botCh, fg, 24, true, isWide(botCh) ? 2 : 1),
                botCont: this._cellW0,
            };
            this._palCursorDark[key] = {
                top: makeCell(topCh, fg, 236, true, isWide(topCh) ? 2 : 1),
                topCont: this._cellW0,
                bot: makeCell(botCh, fg, 236, true, isWide(botCh) ? 2 : 1),
                botCont: this._cellW0,
            };

            const horiz = tile.displayHorizontal;
            const hCells = [];
            for (let i = 0; i < horiz.length; i++) {
                const ch = horiz[i];
                const w = isWide(ch) ? 2 : 1;
                hCells.push(makeCell(ch, fg, 0, true, w));
                if (w === 2) hCells.push(this._cellW0);
            }
            this._palHorizNormal[key] = hCells;

            const hCellsC = [];
            for (let i = 0; i < horiz.length; i++) {
                const ch = horiz[i];
                const w = isWide(ch) ? 2 : 1;
                hCellsC.push(makeCell(ch, fg, 24, true, w));
                if (w === 2) hCellsC.push(this._cellW0);
            }
            this._palHorizCursor[key] = hCellsC;
        }
    },

    _getMeldPal2x2(key, bg) {
        const ck = key + '_' + bg;
        if (!this._meldPal2x2[ck]) {
            const tile = Tile.fromString(key);
            if (!tile) return this._palNormal[key] || this._palNormal['m1'];
            const fg = tileFg(tile.suit, tile.value);
            const topCh = tile.displayTop[0] || ' ';
            const botCh = tile.displayBottom[0] || ' ';
            this._meldPal2x2[ck] = {
                top: makeCell(topCh, fg, bg, true, isWide(topCh) ? 2 : 1),
                topCont: this._cellW0,
                bot: makeCell(botCh, fg, bg, true, isWide(botCh) ? 2 : 1),
                botCont: this._cellW0,
            };
        }
        return this._meldPal2x2[ck];
    },

    _getMeldPalHoriz(key, bg) {
        const ck = key + '_' + bg;
        if (!this._meldPalHoriz[ck]) {
            const tile = Tile.fromString(key);
            if (!tile) return this._palHorizNormal[key] || this._palHorizNormal['m1'];
            const fg = tileFg(tile.suit, tile.value);
            const horiz = tile.displayHorizontal;
            const cells = [];
            for (let i = 0; i < horiz.length; i++) {
                const ch = horiz[i];
                const w = isWide(ch) ? 2 : 1;
                cells.push(makeCell(ch, fg, bg, true, w));
                if (w === 2) cells.push(this._cellW0);
            }
            this._meldPalHoriz[ck] = cells;
        }
        return this._meldPalHoriz[ck];
    },

    _getDimPal2x2(key) {
        if (!this._dimPal2x2[key]) {
            const tile = Tile.fromString(key);
            if (!tile) return this._palNormal['m1'];
            const topCh = tile.displayTop[0] || ' ';
            const botCh = tile.displayBottom[0] || ' ';
            this._dimPal2x2[key] = {
                top: makeCell(topCh, 8, 0, false, isWide(topCh) ? 2 : 1),
                topCont: this._cellW0,
                bot: makeCell(botCh, 8, 0, false, isWide(botCh) ? 2 : 1),
                botCont: this._cellW0,
            };
        }
        return this._dimPal2x2[key];
    },

    _getDimPalHoriz(key) {
        if (!this._dimPalHoriz[key]) {
            const tile = Tile.fromString(key);
            if (!tile) return this._palHorizNormal['m1'];
            const fg = 8;
            const horiz = tile.displayHorizontal;
            const cells = [];
            for (let i = 0; i < horiz.length; i++) {
                const ch = horiz[i];
                const w = isWide(ch) ? 2 : 1;
                cells.push(makeCell(ch, fg, 0, false, w));
                if (w === 2) cells.push(this._cellW0);
            }
            this._dimPalHoriz[key] = cells;
        }
        return this._dimPalHoriz[key];
    },

    _getRonPal2x2(key) {
        if (!this._ronPal2x2[key]) {
            const tile = Tile.fromString(key);
            if (!tile) return this._palNormal['m1'];
            const fg = tileFg(tile.suit, tile.value);
            const topCh = tile.displayTop[0] || ' ';
            const botCh = tile.displayBottom[0] || ' ';
            this._ronPal2x2[key] = {
                top: makeCell(topCh, fg, 24, true, isWide(topCh) ? 2 : 1),
                topCont: this._cellW0,
                bot: makeCell(botCh, fg, 24, true, isWide(botCh) ? 2 : 1),
                botCont: this._cellW0,
            };
        }
        return this._ronPal2x2[key];
    },

    _getRonPalHoriz(key) {
        if (!this._ronPalHoriz[key]) {
            const tile = Tile.fromString(key);
            if (!tile) return this._palHorizNormal['m1'];
            const fg = tileFg(tile.suit, tile.value);
            const horiz = tile.displayHorizontal;
            const cells = [];
            for (let i = 0; i < horiz.length; i++) {
                const ch = horiz[i];
                const w = isWide(ch) ? 2 : 1;
                cells.push(makeCell(ch, fg, 24, true, w));
                if (w === 2) cells.push(this._cellW0);
            }
            this._ronPalHoriz[key] = cells;
        }
        return this._ronPalHoriz[key];
    },

    _getCoverRow(bg) {
        let row = this._coverRowCache[bg];
        if (!row) {
            const cell = makeCell('▒', 240, bg, false);
            cell.dim = true;
            row = [cell, cell, cell, cell];
            this._coverRowCache[bg] = row;
        }
        return row;
    },

    _getCover2x2(ch, fg, bg) {
        const k = ch + '_' + fg + '_' + bg;
        let cells = this._cover2x2Cache[k];
        if (!cells) {
            const cell = makeCell(ch, fg, bg, false);
            cell.dim = true;
            cells = [cell, cell, cell, cell];
            this._cover2x2Cache[k] = cells;
        }
        return cells;
    },
};