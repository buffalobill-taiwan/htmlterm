import { system, term } from '../../system/sys.js';
import { CmdBase } from '../CmdBase.js';
import { CURSOR_HIDE, CURSOR_SHOW, OverlayZ, makeOverlayGetCell, makeCell, bold, cyan, yellow, green, red, magenta, gray, white } from '../../util/sgr.js';
import { SettingsDialog } from '../../dialog/SettingsDialog.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { VerticalSelectDialog } from '../../dialog/VerticalSelectDialog.js';
import { ConfirmDialog } from '../../dialog/ConfirmDialog.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { isWide, displayWidth } from '../../util/display-width.js';
import { Tile, tileFg } from './tiles.js';
import { Game } from './game.js';
import { getWaitingTiles, checkTenpai } from './yaku.js';



const SETTINGS = [
    { key: 'gameLength', label: '對戰長度', value: '東風戰',
      options: ['東風戰', '半莊戰', '一莊戰'] },
    { key: 'aiLeft', label: '上家 AI', value: '一般人',
      options: ['初學者', '一般人', '高手', '国士命', '断么廚', '門清俠'] },
    { key: 'aiAcross', label: '對家 AI', value: '一般人',
      options: ['初學者', '一般人', '高手', '国士命', '断么廚', '門清俠'] },
    { key: 'aiRight', label: '下家 AI', value: '一般人',
      options: ['初學者', '一般人', '高手', '国士命', '断么廚', '門清俠'] },
    { key: 'autoPlayAI', label: '託管 AI', value: '一般人',
      options: ['初學者', '一般人', '高手', '国士命', '断么廚', '門清俠'] },
    { key: 'seat', label: '起始座位', value: '隨機',
      options: ['隨機', '東', '南', '西', '北'] },
];

const AI_MAP = {
    '初學者': 'beginner', '一般人': 'normal', '高手': 'expert',
    '国士命': 'kokushi', '断么廚': 'tanyao', '門清俠': 'menzen',
};

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

export class JpmjCmd extends CmdBase {
    constructor() {
        super();
        this._acrossVB = new VirtualBuffer(40, 2);
        this._leftVB = new VirtualBuffer(4, 18);
        this._rightVB = new VirtualBuffer(4, 18);
        this._playerVB = new VirtualBuffer(40, 3);
        this._discardVB = new VirtualBuffer(34, 15);
        this._infoVB = new VirtualBuffer(36, 21);
        this._resultVB = new VirtualBuffer(36, 16);
        this._game = null;
        this._phase = 'settings';
        this._settingsValues = null;
        this._autoPlay = false;
        this._updateStatusBar();
        this._gameTimer = null;
        this._cursorMode = 'hand';
        this._handCursor = 0;
        this._actionCursor = 0;
        this._actionItems = [];
        this._subMenuCursor = 0;
        this._chiOptions = [];
        this._kanOptions = [];
        this._pausedIsAuto = false;
        this._palettesReady = false;
        this._pauseVB = new VirtualBuffer(36, 15);
        this._statusVB = new VirtualBuffer(80, 1);
        this._pauseOverlay = null;
        this._pauseVBBuffer = null;
    }

    _loadSettings() {
        try {
            const raw = localStorage.getItem('jpmj_settings');
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

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
    }

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
    }

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
    }

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
    }

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
    }

    _getCoverRow(bg) {
        let row = this._coverRowCache[bg];
        if (!row) {
            const cell = makeCell('▒', 240, bg, false);
            cell.dim = true;
            row = [cell, cell, cell, cell];
            this._coverRowCache[bg] = row;
        }
        return row;
    }

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
    }

    _saveSettings(values) {
        try {
            localStorage.setItem('jpmj_settings', JSON.stringify(values));
        } catch { /* ignore */ }
    }

    execute(args) {
        this._initPalettes();
        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);

        if (!this._rootVB) {
            this._rootVB = new VirtualBuffer(term.cols, term.rows);
            this._slotAcross = this._rootVB.addChildSlot();
            this._slotLeft = this._rootVB.addChildSlot();
            this._slotRight = this._rootVB.addChildSlot();
            this._slotDiscard = this._rootVB.addChildSlot();
            this._slotPlayer = this._rootVB.addChildSlot();
            this._slotInfo = this._rootVB.addChildSlot();
            this._slotResult = this._rootVB.addChildSlot();
            this._slotStatus = this._rootVB.addChildSlot();

            const statusRow = this._statusVB._buffer[0];
            for (let c = 0; c < 80; c++) statusRow[c] = makeCell(' ', 7, 17, false);
            const title = 'JPMJ';
            for (let i = 0; i < title.length; i++) statusRow[i] = makeCell(title[i], 15, 17, true);
            statusRow[4] = makeCell('|', 7, 17, false);
            statusRow[5] = makeCell('[', 8, 17, false);
            statusRow[6] = makeCell('A', 8, 17, false);
            statusRow[7] = makeCell(']', 8, 17, false);
            statusRow[8] = makeCell('託', 8, 17, false, 2);
            statusRow[10] = makeCell('管', 8, 17, false, 2);
            statusRow[12] = makeCell('|', 7, 17, false);
        }

        this._phase = 'settings';
        this._showSettings();
    }

    _showSettings() {
        const saved = this._loadSettings();
        for (const s of SETTINGS) {
            if (saved[s.key] != null && s.options.includes(saved[s.key])) {
                s.value = saved[s.key];
            }
        }
        const stackDepth = system.cmdStack.length;
        system.createDialog(SettingsDialog, 'jpmj-settings', {
            title: 'jpmj — 日本麻將',
            settings: SETTINGS,
            footer: '↑↓ Move  ↩ Select  ESC Quit',
            onStart: (result) => {
                const removeHook = system.addFramePopHook(() => {
                    if (system.cmdStack.length === stackDepth) {
                        removeHook();
                        this._saveSettings(result);
                        this._startGame(result);
                    }
                });
                return 'close';
            },
            onCancel: () => {
                const removeHook = system.addFramePopHook(() => {
                    if (system.cmdStack.length === stackDepth) {
                        removeHook();
                        term.write(CURSOR_SHOW);
                        this.close();
                    }
                });
                return 'close';
            },
        });
    }

    _startGame(settings) {
        this._settingsValues = settings;
        const opts = {
            length: { '東風戰': 'east', '半莊戰': 'half', '一莊戰': 'full' }[settings.gameLength] || 'east',
            difficulties: [
                AI_MAP[settings.aiRight] || 'normal',
                AI_MAP[settings.aiAcross] || 'normal',
                AI_MAP[settings.aiLeft] || 'normal',
            ],
            autoPlayDifficulty: AI_MAP[settings.autoPlayAI] || 'normal',
            startingSeat: { '隨機': 'random', '東': 'east', '南': 'south', '西': 'west', '北': 'north' }[settings.seat] || 'random',
        };
        this._game = new Game(opts);
        this._game.initGame();
        this._autoPlay = false;
        this._updateStatusBar();
        this._phase = 'playing';
        this._handCursor = 0;
        this._actionCursor = 0;
        this._cursorMode = 'hand';
        this._continueGame();
    }

    _continueGame() {
        if (!this._game || this._game.gameOver) {
            this._autoPlay = false;
            this._updateStatusBar();
            this._phase = 'gameOver';
            this._render();
            return;
        }
        if (this._game.roundOver) {
            this._autoPlay = false;
            this._updateStatusBar();
            this._game.endRound();
            if (this._game.gameOver) {
                this._phase = 'gameOver';
                this._render();
                return;
            }
            this._phase = 'result';
            this._render();
            return;
        }
        const needHuman = this._game.advance();
        if (this._game.roundOver) {
            this._game.endRound();
            if (this._game.gameOver) {
                this._phase = 'gameOver';
            } else {
                this._phase = 'result';
            }
            this._render();
            return;
        }
        if (needHuman) {
            const p = this._game.players[0];
            const hasDraw = p.lastDraw && p.hand.includes(p.lastDraw);
            const hasKanOptions = this._game.availableActions.some(a => typeof a === 'object');
            if (this._game.phase === 'call_pending' || hasKanOptions) {
                this._cursorMode = 'action';
                this._actionCursor = 0;
            } else if (hasDraw) {
                this._cursorMode = 'hand';
                this._handCursor = p.hand.length - 1;
            } else {
                this._cursorMode = 'hand';
                this._handCursor = Math.max(0, p.hand.length - 1);
            }
        } else {
            const p = this._game.players[0];
            if (p.lastDraw && p.hand.includes(p.lastDraw)) {
                this._cursorMode = 'hand';
                this._handCursor = p.hand.length - 1;
            }
        }
        const skipRender = !needHuman && this._game.currentPlayer === 0
            && this._game.phase === 'draw' && !this._game.players[0].lastDraw;
        if (!skipRender) this._render();
        if (needHuman && this._autoPlay) {
            this._processAutoPlay();
            return;
        }
        if (!needHuman) {
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
        }
    }

    _processAutoPlay() {
        if (!this._game || this._game.gameOver || this._game.roundOver) return;
        if (!this._game.waitingHuman || !this._autoPlay) return;

        const g = this._game;
        const p = g.players[0];

        // A. Discard phase
        if (g.phase === 'dealer_first_discard' || g.phase === 'discard') {
            if (g.availableActions.includes('kyuushu')) {
                if (p.ai.decideKyuushu(g, 0)) {
                    g.handleKyuushuKyuuhai(0);
                    this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    return;
                }
                g.availableActions = g.availableActions.filter(a => a !== 'kyuushu');
            }
            if (!g.availableActions.includes('discard')) return;
            if (g.handleAIKan(0)) {
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            if (!p.isRiichi && p.score >= 1000 && g.wall.getRemainingCount() >= 4 && p.ai.decideRiichi(g, 0)) {
                for (let i = 0; i < p.hand.length; i++) {
                    const testHand = p.hand.filter((_, j) => j !== i);
                    if (checkTenpai(testHand, p.melds)) {
                        g.humanRiichi(i);
                        this._gameTimer = setTimeout(() => this._continueGame(), 100);
                        return;
                    }
                }
            }
            const idx = p.ai.chooseDiscard(g, 0);
            g.humanDiscard(idx);
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        // B. Call pending
        if (g.phase === 'call_pending') {
            const humanCalls = g.availableCalls.filter(c => c.playerIdx === 0);
            if (humanCalls.length === 0) {
                const passAction = g.availableActions.find(a => a.type === 'pass');
                if (passAction) g.humanCall(passAction);
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            const chosenCall = p.ai.decideCall(g, humanCalls);
            if (chosenCall) {
                g.humanCall(chosenCall);
            } else {
                const passAction = g.availableActions.find(a => a.type === 'pass');
                if (passAction) g.humanCall(passAction);
            }
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        // C. Tsumo / pass
        if (g.availableActions) {
            if (g.availableActions.includes('tsumo')) {
                g.executeWin(0, 'tsumo', p.lastDraw);
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            if (g.availableActions.includes('tsumo-no-yaku') || g.availableActions.includes('pass')) {
                g.availableActions = [];
                g.phase = 'discard';
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
        }
    }

    _stopTimer() {
        if (this._gameTimer) {
            clearTimeout(this._gameTimer);
            this._gameTimer = null;
        }
    }

    _showQuitConfirm() {
        system.createDialog(ConfirmDialog, 'jpmj-confirm', {
            title: '確認',
            message: '確定要離開嗎？',
            onConfirm: () => this.close(),
        });
    }

    close() {
        this._stopTimer();
        this._removeOverlays();
        term.write('\x1B[2J\x1B[23;1H');
        super.close();
    }

    onCancel() {
        this._stopTimer();
        this._removeOverlays();
        term.write('\x1B[2J\x1B[23;1H');
        super.onCancel();
    }

    _removeOverlays() {
        if (this._pauseOverlay) { term.removeOverlay(this._pauseOverlay); this._pauseOverlay = null; }
    }

    _buildActionItems() {
        const items = [];
        const actions = this._game.availableActions;
        const ankans = [];
        const kakans = [];
        for (const a of actions) {
            if (a === 'discard' || a === 'pass' || a === 'tsumo-no-yaku' || a === 'ron-no-yaku' || a === 'ron-furiten') continue;
            if (a === 'pass') { items.push({ label: '過', action: 'pass' }); continue; }
            if (a === 'tsumo') { items.push({ label: 'ツモ', action: 'tsumo' }); continue; }
            if (a === 'ron') { items.push({ label: 'ロン', action: 'ron' }); continue; }
            if (a === 'kyuushu') { items.push({ label: '九種', action: 'kyuushu' }); continue; }
            if (a === 'riichi') { items.push({ label: '立直', action: 'riichi' }); continue; }
            if (a && typeof a === 'object') {
                if (a.type === 'pon') items.push({ label: 'ポン', action: a });
                else if (a.type === 'chi') items.push({ label: 'チー', action: a });
                else if (a.type === 'kan') items.push({ label: '槓', action: a });
                else if (a.type === 'ankan') ankans.push(a);
                else if (a.type === 'kakan') kakans.push(a);
                else if (a.type === 'ron') items.push({ label: 'ロン', action: a });
                else if (a.type === 'pass') items.push({ label: '過', action: { type: 'pass' } });
            }
        }
        if (ankans.length === 1) items.push({ label: '暗槓', action: ankans[0] });
        else if (ankans.length > 1) items.push({ label: '暗槓', action: { type: 'ankans', options: ankans } });
        if (kakans.length === 1) items.push({ label: '加槓', action: kakans[0] });
        else if (kakans.length > 1) items.push({ label: '加槓', action: { type: 'kakans', options: kakans } });
        if (this._canDeclareRiichi() && !items.find(i => i.action === 'riichi')) {
            const passIdx = items.findIndex(i => i.action === 'pass' || (i.action && i.action.type === 'pass'));
            if (passIdx >= 0) items.splice(passIdx, 0, { label: '立直', action: 'riichi' });
            else items.unshift({ label: '立直', action: 'riichi' });
        }
        const hasPass = items.some(i => i.action === 'pass' || (i.action && i.action.type === 'pass'));
        if (!hasPass && items.length > 0) {
            items.push({ label: '過', action: 'pass' });
        }
        return items;
    }

    _canDeclareRiichi() {
        if (!this._game || this._game.gameOver || this._game.roundOver) return false;
        if (this._phase !== 'playing') return false;
        const g = this._game;
        if (g.currentPlayer !== 0) return false;
        if (g.phase !== 'discard' && g.phase !== 'dealer_first_discard') return false;
        const p = g.players[0];
        if (p.isRiichi) return false;
        if (p.melds.length > 0) return false;
        if (p.score < 1000) return false;
        if (g.wall.getRemainingCount() < 4) return false;
        return p.hand.some((_, i) => {
            const testHand = p.hand.filter((__, j) => j !== i);
            return checkTenpai(testHand, p.melds);
        });
    }

    _getDiscardableIndices() {
        if (!this._game) return [];
        const p = this._game.players[0];
        const hand = p.hand;
        const drawTile = p.lastDraw;
        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;
        if (p.isRiichi) {
            if (drawTile && drawIdx >= 0) {
                return [hand.length - 1];
            }
            return [];
        }
        const indices = [];
        for (let i = 0; i < hand.length; i++) {
            indices.push(this._handIdxToVisual(i));
        }
        return indices.sort((a, b) => a - b);
    }

    _clearVB(vb) {
        const bc = this._blankCell;
        for (let r = 0; r < vb.height; r++) {
            const row = vb._buffer[r];
            for (let c = 0; c < vb.width; c++) row[c] = bc;
        }
    }

    _clearVBNull(vb) {
        for (let r = 0; r < vb.height; r++) {
            const row = vb._buffer[r];
            for (let c = 0; c < vb.width; c++) row[c] = null;
        }
    }

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
            } else {
                this._deactivateSlots();
                this._clearVB(this._rootVB);
            }
            this._updateSlots();
        }

        term.writeVB(this._rootVB);
    }

    _deactivateSlots() {
        this._slotAcross.active = false;
        this._slotLeft.active = false;
        this._slotRight.active = false;
        this._slotDiscard.active = false;
        this._slotPlayer.active = false;
        this._slotInfo.active = false;
        this._slotResult.active = false;
    }

    _updateStatusBar() {
        const row = this._statusVB._buffer[0];
        const fg = this._autoPlay ? 15 : 8;
        const bold = this._autoPlay;
        row[5] = makeCell('[', fg, 17, bold);
        row[6] = makeCell('A', fg, 17, bold);
        row[7] = makeCell(']', fg, 17, bold);
        row[8] = makeCell('託', fg, 17, bold, 2);
        row[10] = makeCell('管', fg, 17, bold, 2);
    }

    _updateSlots() {
        this._slotAcross.vb = this._acrossVB; this._slotAcross.x = 0;  this._slotAcross.y = 0;  this._slotAcross.active = true;
        this._slotLeft.vb = this._leftVB;     this._slotLeft.x = 0;    this._slotLeft.y = 2;    this._slotLeft.active = true;
        this._slotRight.vb = this._rightVB;   this._slotRight.x = 40;  this._slotRight.y = 0;   this._slotRight.active = true;
        this._slotDiscard.vb = this._discardVB; this._slotDiscard.x = 6; this._slotDiscard.y = 3; this._slotDiscard.active = true;
        this._slotPlayer.vb = this._playerVB; this._slotPlayer.x = 4;  this._slotPlayer.y = 18; this._slotPlayer.active = true;
        this._slotInfo.vb = this._infoVB;     this._slotInfo.x = 44;   this._slotInfo.y = 0;    this._slotInfo.active = true;
        this._slotResult.vb = this._resultVB; this._slotResult.x = 4; this._slotResult.y = 2;
        this._slotStatus.vb = this._statusVB; this._slotStatus.x = 0; this._slotStatus.y = 21; this._slotStatus.active = true;
    }

    _writeTile2x2(buf, row, col, pal) {
        buf[row][col]     = pal.top;
        buf[row][col + 1] = pal.topCont;
        buf[row + 1][col] = pal.bot;
        buf[row + 1][col + 1] = pal.botCont;
    }

    _writeTileH(buf, row, col, cells) {
        for (let i = 0; i < cells.length; i++) buf[row][col + i] = cells[i];
    }

    _writeCover2x2(buf, row, col, cell) {
        buf[row][col] = cell; buf[row][col + 1] = cell;
        buf[row + 1][col] = cell; buf[row + 1][col + 1] = cell;
    }

    _writeCoverRow(buf, row, col, bg) {
        const cells = this._getCoverRow(bg);
        buf[row][col] = cells[0]; buf[row][col + 1] = cells[1];
        buf[row][col + 2] = cells[2]; buf[row][col + 3] = cells[3];
    }

    _renderPlayerHand(vb) {
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const drawTile = p.lastDraw;
        const melds = p.melds;
        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;
        const buf = vb._buffer;

        const meldTiles = [];
        for (const m of melds) {
            for (const t of m.tiles) meldTiles.push(t);
        }

        const handCount = drawTile ? hand.length - 1 : hand.length;
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
            const isCursor = showCursor && (this._cursorMode === 'hand' && this._handCursor === hand.length - 1);
            const canDiscard = discardableIndices.includes(hand.length - 1);
            let pal;
            if (isCursor && !canDiscard && isDiscardPhase) pal = this._palCursorDark[key];
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
                for (let ti = 0; ti < m.tiles.length; ti++) {
                    const pal = this._getMeldPal2x2(m.tiles[ti].key(), bg);
                    this._writeTile2x2(buf, 1, col, pal);
                    col += 2;
                }
            }
        }
    }

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
    }

    _renderAcrossHand(vb) {
        const g = this._game;
        const across = g.players[2];
        const hand = across.hand;
        const drawTile = across.lastDraw;
        const melds = across.melds;
        const buf = vb._buffer;
        const reveal = this._phase === 'result';
        const cover2x2 = this._getCover2x2('▓', 240, 236);

        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;
        const handDisplay = hand.length - (drawTile ? 1 : 0);

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
                    const pal = reveal ? this._palNormal[m.tiles[ti].key()] : this._getMeldPal2x2(m.tiles[ti].key(), bg);
                    this._writeTile2x2(buf, 0, col, pal);
                }
                col += 2;
            }
        }
        col += gapBeforeDraw;
        if (drawTile) {
            if (reveal) {
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
    }

    _renderLeftHand(vb) {
        const g = this._game;
        const left = g.players[3];
        const hand = left.hand;
        const drawTile = left.lastDraw;
        const melds = left.melds;
        const buf = vb._buffer;
        const reveal = this._phase === 'result';
        const cover = this._getCoverRow(236);

        const drawIdx = drawTile ? hand.findIndex(t => t.equals(drawTile)) : -1;
        const handDisplay = hand.length - (drawTile ? 1 : 0);
        const meldCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const base = handDisplay + 1 + meldCount;
        const spare = 18 - base;
        const gapAfterHand = spare >= 2 ? 1 : 0;
        const gapAfterDraw = spare >= 1 ? 1 : 0;
        const startRow = Math.floor((18 - base) / 2);

        let row = startRow;

        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[hand[i].key()]);
            } else {
                buf[row][0] = cover[0]; buf[row][1] = cover[1]; buf[row][2] = cover[2]; buf[row][3] = cover[3];
            }
            row++;
        }
        row += gapAfterHand;
        if (drawTile) {
            if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[drawTile.key()]);
            } else {
                buf[row][0] = cover[0]; buf[row][1] = cover[1]; buf[row][2] = cover[2]; buf[row][3] = cover[3];
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
    }

    _renderRightHand(vb) {
        const g = this._game;
        const right = g.players[1];
        const hand = right.hand;
        const drawTile = right.lastDraw;
        const melds = right.melds;
        const buf = vb._buffer;
        const reveal = this._phase === 'result';
        const cover = this._getCoverRow(236);

        const drawIdx = drawTile ? hand.findIndex(t => t.equals(drawTile)) : -1;
        const handDisplay = hand.length - (drawTile ? 1 : 0);
        const meldCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const base = handDisplay + 1 + meldCount;
        const spare = 18 - base;
        const gapAfterMelds = spare >= 2 ? 1 : 0;
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
        if (drawTile) {
            if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[drawTile.key()]);
            } else {
                buf[row][0] = cover[0]; buf[row][1] = cover[1]; buf[row][2] = cover[2]; buf[row][3] = cover[3];
            }
        }
        row++;
        row += gapAfterDraw;
        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._writeTileH(buf, row, 0, this._palHorizNormal[hand[i].key()]);
            } else {
                buf[row][0] = cover[0]; buf[row][1] = cover[1]; buf[row][2] = cover[2]; buf[row][3] = cover[3];
            }
            row++;
        }
    }

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
    }

    _renderDiscards(vb) {
        const g = this._game;
        if (!g) return;
        const buf = vb._buffer;

        const quadrants = [
            { playerIdx: 2, startCol: 0, startRow: 0 },
            { playerIdx: 1, startCol: 17, startRow: 0 },
            { playerIdx: 3, startCol: 0, startRow: 7 },
            { playerIdx: 0, startCol: 17, startRow: 7 },
        ];

        for (const q of quadrants) {
            const discards = g.players[q.playerIdx].discards;
            const isLatest = g.lastDiscardPlayer === q.playerIdx;
            for (let i = 0; i < discards.length; i++) {
                const col = q.startCol + (i % 6) * 2;
                const row = q.startRow + Math.floor(i / 6) * 2;
                const tile = discards[i];
                const latest = isLatest && i === discards.length - 1;
                const called = tile.called || false;
                this._renderDiscardTile(buf, row, col, tile, latest, called);
            }
        }
    }

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
        for (let row = 0; row < 4; row++) {
            const pi = sorted[row];
            const p = g.players[pi];
            const windChar = winds[p.seatWind - 1] || '?';
            const riichi = p.isRiichi ? '\x1B[91;107m⬤\x1B[0m' : '  ';
            const namePad = ' '.repeat(6 - displayWidth(p.name));
            const dealer = pi === g.dealerIndex ? '親' : '  ';
            const scoreStr = String(p.score).replace(/\B(?=(\d{3})+(?!\d))/g, ',').padStart(6);
            const line = windChar + ' ' + riichi + p.name + namePad + ' ' + dealer + ' ' + scoreStr;
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
    }

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
            const winLabel = isTsumo ? 'ツモ和了' : 'ロンドラ';

            vb.writeStr(1, 2, '\x1B[1;33m和了！ ' + winner.name + ' ' + winLabel + '\x1B[0m');

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

            y = oh - 5;
            const hanFu = r.isYakuman ? '役滿' : (r.totalHan + '飜' + r.fu + '符');
            const points = r.payments ? r.payments.total : 0;
            vb.writeStr(y, 2, '\x1B[1m' + hanFu + '  ' + String(points) + '点\x1B[0m');

            if (r.payments) {
                y++;
                if (r.payments.type === 'tsumo') {
                    vb.writeStr(y, 2, '子' + r.payments.childPayment + ' 親' + r.payments.dealerPayment);
                } else {
                    const disc = g.players[g.lastDiscardPlayer];
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
    }

    _renderGameOver(vb) {
        const g = this._game;
        if (!g) return;
        const buf = vb._buffer;
        const bw = this._cellBorderW;

        vb.writeStr(0, 0, '┌' + '─'.repeat(78) + '┐');
        for (let r = 1; r < 24; r++) { buf[r][0] = bw; buf[r][79] = bw; }
        vb.writeStr(24, 0, '└' + '─'.repeat(78) + '┘');

        vb.writeStr(1, 0, '\x1B[1;33m' + ' '.repeat(30) + '最終結果' + ' '.repeat(31) + '\x1B[0m');
        vb.writeStr(2, 0, '  ' + '─'.repeat(76));

        vb.writeStr(3, 0, '  順位     名前         點數      ツモ    ロン    放銃');
        vb.writeStr(4, 0, '  ' + '─'.repeat(76));

        const scores = g.getFinalScores();
        for (let i = 0; i < scores.length; i++) {
            const s = scores[i];
            const rank = s.rank;
            const rankStr = (rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : '4th');
            const rankColor = rank === 1 ? '\x1B[1;33m' : (rank <= 2 ? '\x1B[1;37m' : (rank === 3 ? '\x1B[36m' : '\x1B[31m'));
            const line = rankStr.padEnd(6) + s.name.padEnd(12) + formatScore(s.score).padStart(8) +
                         String(s.tsumo).padStart(8) + String(s.ron).padStart(8) + String(s.dealtIn).padStart(8);
            vb.writeStr(5 + i, 0, '  ' + rankColor + line + '\x1B[0m');
        }

        const sepRow = 5 + scores.length;
        vb.writeStr(sepRow, 0, '  ' + '─'.repeat(76));

        const statsRow = sepRow + 1;
        const totalRounds = g.roundCount;
        const ryuukyoku = g.ryuukyokuCount;
        const riichiRemain = g.riichiSticks;
        const statsLine = '  連莊 ' + g.renchanCount + ' ｜ 總局數 ' + totalRounds + ' ｜ 流局 ' + ryuukyoku + ' ｜ 立直棒殘留 ' + riichiRemain;
        vb.writeStr(statsRow, 0, statsLine);

        vb.writeStr(statsRow + 1, 0, '  ' + '─'.repeat(76));
        vb.writeStr(23, 0, '\x1B[36m' + ' '.repeat(30) + '按 ENTER 返回' + ' '.repeat(30) + '\x1B[0m');
    }

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
    }

    _handIdxToVisual(handIdx) {
        const p = this._game.players[0];
        const drawTile = p.lastDraw;
        if (!drawTile) return handIdx;
        const drawIdx = p.hand.indexOf(drawTile);
        if (drawIdx < 0) return handIdx;
        if (handIdx === drawIdx) return p.hand.length - 1;
        return handIdx < drawIdx ? handIdx : handIdx - 1;
    }

    _visualToHandIdx(visualPos) {
        const p = this._game.players[0];
        const drawTile = p.lastDraw;
        if (!drawTile) return visualPos;
        const drawIdx = p.hand.indexOf(drawTile);
        if (drawIdx < 0) return visualPos;
        const handCount = p.hand.length - 1;
        if (visualPos === handCount) return drawIdx;
        return visualPos < drawIdx ? visualPos : visualPos + 1;
    }

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
    }

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
    }

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (this._phase === 'gameOver') {
            if (code === 0x6E || code === 0x4E || code === 0x0D || code === 0x0A) {
                this._phase = 'settings';
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
                this._game.startNewRound();
                this._phase = 'playing';
                this._handCursor = 0;
                this._actionCursor = 0;
                this._cursorMode = 'hand';
                this._continueGame();
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
    }

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
                const hasKanOptions = this._game.availableActions.some(a => typeof a === 'object');
                if (this._game.phase !== 'call_pending' && !hasKanOptions) {
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
    }

    _handleHandKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const hasDraw = !!p.lastDraw;

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
            const hasKanOptions = g.availableActions.some(a => typeof a === 'object');
            if (hasKanOptions) {
                this._cursorMode = 'action';
                this._actionCursor = 0;
                this._render();
                return;
            }
            if (this._actionItems.length > 0 && this._actionItems.length === 1 && this._actionItems[0].action === 'discard') {
                this._doDiscard(this._handCursor);
                return;
            }
            if (g.availableActions.includes('discard') && this._actionItems.length === 0) {
                this._doDiscard(this._handCursor);
                return;
            }
            this._doDiscard(this._handCursor);
            return;
        }
    }

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
    }

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
    }

    _executeAction(item) {
        const g = this._game;
        const action = item.action;
        const stackDepth = system.cmdStack.length;

        if (action === 'pass') {
            if (g.phase === 'draw') {
                g.phase = 'discard';
            } else {
                g.humanCall({ type: 'pass' });
            }
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        if (action === 'tsumo') {
            const p = g.players[0];
            g.executeWin(0, 'tsumo', p.lastDraw);
            this._continueGame();
            return;
        }

        if (action === 'ron') {
            const ronCalls = g.availableCalls.filter(c => c.type === 'ron');
            if (ronCalls.length > 0) {
                g.humanCall(ronCalls[0]);
            } else {
                g.humanCall({ type: 'pass' });
            }
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        if (action === 'kyuushu') {
            g.handleKyuushuKyuuhai(0);
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }

        if (action === 'riichi') {
            const p = g.players[0];
            const hand = p.hand;
            const options = [];
            for (let i = 0; i < hand.length; i++) {
                const testHand = hand.filter((_, j) => j !== i);
                const waits = getWaitingTiles(testHand, p.melds);
                if (waits.length > 0) {
                    options.push({ handIdx: i, tile: hand[i], waits });
                }
            }
            if (options.length === 0) return;
            if (options.length === 1) {
                this._game.humanRiichi(options[0].handIdx);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            const labels = options.map(o =>
                '捨' + o.tile.name + '→聽' + o.waits.map(w => w.name).join('')
            );
            const maxLen = Math.max(...labels.map(l => displayWidth(l)));
            const stackDepth = system.cmdStack.length;
            const removeHook = system.addFramePopHook(() => {
                if (system.cmdStack.length === stackDepth) {
                    removeHook();
                    this._gameTimer = setTimeout(() => this._continueGame(), 100);
                }
            });
            system.createDialog(VerticalSelectDialog, 'jpmj-riichi', {
                title: '立直',
                message: 'どの牌を捨てますか？',
                options: labels,
                width: maxLen + 6,
                cols: 1,
                onSelect: (idx) => {
                    this._game.humanRiichi(options[idx].handIdx);
                    this._cursorMode = 'hand';
                    this._handCursor = 0;
                    return 'close';
                },
                onCancel: () => {
                    return 'close';
                },
            });
            return;
        }

        if (action && typeof action === 'object') {
            if (action.type === 'chi' && action.chiSets && action.chiSets.length > 1) {
                const chiLabels = action.chiSets.map(set => set.map(t => t.name).join(' '));
                const removeHook = system.addFramePopHook(() => {
                    if (system.cmdStack.length === stackDepth) {
                        removeHook();
                        this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    }
                });
                system.createDialog(SelectDialog, 'jpmj-chi', {
                    title: 'チー選択',
                    message: 'どの組み合わせでチーしますか？',
                    options: chiLabels,
                    width: 40,
                    onSelect: (idx) => {
                        const call = { ...action, chosenChiSet: idx };
                        g.humanCall(call);
                        return 'close';
                    },
                    onCancel: () => {
                        return 'close';
                    },
                });
                return;
            }
            if (action.type === 'kan') {
                const kans = g.buildAvailableKans();
                if (kans.length > 1) {
                    this._cursorMode = 'kanSelect';
                    this._subMenuCursor = 0;
                    this._kanOptions = kans;
                    this._render();
                    return;
                }
                g.humanCall(action);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            if (action.type === 'ankans' || action.type === 'kakans') {
                const opts = action.options;
                if (opts.length === 1) {
                    g.executeKan(opts[0]);
                    this._cursorMode = 'hand';
                    this._handCursor = 0;
                    this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    return;
                }
                const labels = opts.map(o => o.desc);
                const maxLen = Math.max(...labels.map(l => displayWidth(l)));
                const key = action.type === 'ankans' ? 'jpmj-ankans' : 'jpmj-kakans';
                const stackDepth = system.cmdStack.length;
                const removeHook = system.addFramePopHook(() => {
                    if (system.cmdStack.length === stackDepth) {
                        removeHook();
                        this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    }
                });
                system.createDialog(VerticalSelectDialog, key, {
                    title: action.type === 'ankans' ? '暗槓選択' : '加槓選択',
                    options: labels,
                    width: maxLen + 6,
                    cols: 1,
                    onSelect: (idx) => {
                        g.executeKan(opts[idx]);
                        this._cursorMode = 'hand';
                        this._handCursor = 0;
                        return 'close';
                    },
                    onCancel: () => {
                        return 'close';
                    },
                });
                return;
            }
            if (action.type === 'ankan' || action.type === 'kakan') {
                g.executeKan(action);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
                return;
            }
            g.humanCall(action);
            this._cursorMode = 'hand';
            this._handCursor = 0;
            this._gameTimer = setTimeout(() => this._continueGame(), 100);
            return;
        }
    }

    _doDiscard(visualPos) {
        const g = this._game;
        const p = g.players[0];
        const tileIdx = this._visualToHandIdx(visualPos);
        if (tileIdx < 0 || tileIdx >= p.hand.length) return;

        g.humanDiscard(tileIdx);
        this._cursorMode = 'hand';
        this._handCursor = 0;
        this._gameTimer = setTimeout(() => this._continueGame(), 100);
    }

    _drawPauseOverlay() {
        const vb = this._pauseVB;
        const buf = vb._buffer;
        const ow = 36, oh = 15;
        const bc = this._blankCell;
        const by = this._cellBorderY;

        for (let r = 0; r < oh; r++) {
            const row = buf[r];
            for (let c = 0; c < ow; c++) row[c] = bc;
        }

        vb.writeStr(0, 0, '\x1B[1;33m┌' + '─'.repeat(ow - 2) + '┐\x1B[0m');
        for (let r = 1; r < oh - 1; r++) { buf[r][0] = by; buf[r][ow - 1] = by; }
        vb.writeStr(oh - 1, 0, '\x1B[1;33m└' + '─'.repeat(ow - 2) + '┘\x1B[0m');

        vb.writeStr(3, 2, '\x1B[1;33m' + ' '.repeat(8) + '暫停中' + ' '.repeat(8) + '\x1B[0m');
        vb.writeStr(7, 2, '  P 取消暫停    Q 退出');

        this._pauseVBBuffer = vb.render();
        if (!this._pauseOverlay) {
            this._pauseOverlay = {
                x: 4, y: 2, w: ow, h: oh,
                z: 5,
                owner: this,
                getCell: makeOverlayGetCell(() => this._pauseVBBuffer, ow, oh),
            };
            term.addOverlay(this._pauseOverlay);
        }
        for (let r = 2; r < 2 + oh; r++) term.markRowDirty(r);
    }

    _removePauseOverlay() {
        if (this._pauseOverlay) {
            term.removeOverlay(this._pauseOverlay);
            this._pauseOverlay = null;
            for (let r = 2; r < 17; r++) term.markRowDirty(r);
        }
    }

    static get commandName() { return 'jpmj'; }
    static get help() { return 'Japanese Mahjong (14 tiles, 6 AI types)'; }
    static get menu() { return 'Japanese Mahjong'; }
    static get usage() { return 'jpmj'; }
}
