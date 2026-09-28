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

const tilesMethods = {
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
};

export { meldTypeToBg, meldBg, countCallType, tilesMethods };
