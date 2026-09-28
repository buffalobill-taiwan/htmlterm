import { displayWidth } from '../../../util/display-width.js';
import { getRankLabel, getWaitingTiles, evaluateHand } from '../yaku/index.js';
import { makeCell } from '../../../util/sgr.js';
import { tileFg } from '../tiles.js';

function formatScore(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const panelsMethods = {
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
        vb.writeStr(enterY, 4, '\x1B[36m[Enter]次の局へ [TAB]查看捨牌\x1B[0m');
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

export { panelsMethods };
