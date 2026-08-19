import { system, term } from '../../system/sys.js';
import { CmdBase } from '../CmdBase.js';
import { CURSOR_HIDE, CURSOR_SHOW, bold, cyan, yellow, green, red, magenta, gray, white } from '../../util/sgr.js';
import { SettingsDialog } from '../../dialog/SettingsDialog.js';
import { SelectDialog } from '../../dialog/SelectDialog.js';
import { VirtualBuffer, _blankCell } from '../../util/VirtualBuffer.js';
import { isWide, displayWidth } from '../../util/display-width.js';
import { tileFg } from './tiles.js';
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
        this._vb = new VirtualBuffer(80, 25);
        this._acrossVB = new VirtualBuffer(40, 2);
        this._leftVB = new VirtualBuffer(4, 18);
        this._rightVB = new VirtualBuffer(4, 18);
        this._playerVB = new VirtualBuffer(40, 3);
        this._discardVB = new VirtualBuffer(34, 15);
        this._infoVB = new VirtualBuffer(36, 21);
        this._resultVB = new VirtualBuffer(36, 16);
        this._slotAcross = this._vb.addChildSlot();
        this._slotLeft = this._vb.addChildSlot();
        this._slotRight = this._vb.addChildSlot();
        this._slotDiscard = this._vb.addChildSlot();
        this._slotPlayer = this._vb.addChildSlot();
        this._slotInfo = this._vb.addChildSlot();
        this._slotResult = this._vb.addChildSlot();
        this._game = null;
        this._phase = 'settings';
        this._settingsValues = null;
        this._settingsDialog = null;
        this._autoPlay = false;
        this._gameTimer = null;
        this._cursorMode = 'hand';
        this._handCursor = 0;
        this._actionCursor = 0;
        this._actionItems = [];
        this._subMenuCursor = 0;
        this._riichiCursor = 0;
        this._chiOptions = [];
        this._kanOptions = [];
        this._pausedIsAuto = false;
    }

    _loadSettings() {
        try {
            const raw = localStorage.getItem('jpmj_settings');
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    _saveSettings(values) {
        try {
            localStorage.setItem('jpmj_settings', JSON.stringify(values));
        } catch { /* ignore */ }
    }

    execute(args) {
        this.open();
        term.write('\x1B[2J\x1B[1;1H');
        term.write(CURSOR_HIDE);
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
        const dialog = new SettingsDialog(term, {
            title: 'jpmj — 日本麻將',
            settings: SETTINGS,
            footer: '↑↓ Move  ↩ Select  ESC Quit',
            onStart: (result) => {
                dialog.close();
                this._settingsDialog = null;
                this._saveSettings(result);
                this._startGame(result);
            },
            onCancel: () => {
                dialog.close();
                this._settingsDialog = null;
                term.write(CURSOR_SHOW);
                this.close();
            },
        });
        dialog.open();
        this._settingsDialog = dialog;
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
        this._phase = 'playing';
        this._handCursor = 0;
        this._actionCursor = 0;
        this._cursorMode = 'hand';
        this._continueGame();
    }

    _continueGame() {
        if (!this._game || this._game.gameOver) {
            this._autoPlay = false;
            this._phase = 'gameOver';
            this._render();
            return;
        }
        if (this._game.roundOver) {
            this._autoPlay = false;
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
        }
        this._render();
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

    close() {
        this._stopTimer();
        term.write('\x1B[2J\x1B[23;1H');
        super.close();
    }

    onCancel() {
        this._stopTimer();
        term.write('\x1B[2J\x1B[23;1H');
        super.onCancel();
    }

    _buildActionItems() {
        const items = [];
        const actions = this._game.availableActions;
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
                else if (a.type === 'ankan') items.push({ label: '暗槓', action: a });
                else if (a.type === 'kakan') items.push({ label: '加槓', action: a });
                else if (a.type === 'ron') items.push({ label: 'ロン', action: a });
                else if (a.type === 'pass') items.push({ label: '過', action: { type: 'pass' } });
            }
        }
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
        if (g.availableActions.includes('riichi')) return true;
        return false;
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
        for (let r = 0; r < vb.height; r++) {
            for (let c = 0; c < vb.width; c++) {
                vb.setCell(r, c, _blankCell);
            }
        }
    }

    _clearVBNull(vb) {
        for (let r = 0; r < vb.height; r++) {
            for (let c = 0; c < vb.width; c++) {
                vb.setCell(r, c, null);
            }
        }
    }

    _render() {
        term.cursorHidden = true;
        this._clearVB(this._vb);
        this._clearVB(this._acrossVB);
        this._clearVB(this._leftVB);
        this._clearVB(this._rightVB);
        this._clearVB(this._playerVB);
        this._clearVB(this._discardVB);
        this._clearVB(this._infoVB);
        this._clearVB(this._resultVB);

        if (this._phase === 'gameOver') {
            this._deactivateSlots();
            this._clearVB(this._vb);
            this._renderGameOver(this._vb);
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
                this._clearVB(this._vb);
            }
            this._updateSlots();
        }

        term.writeVB(this._vb);
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

    _updateSlots() {
        this._slotAcross.vb = this._acrossVB; this._slotAcross.x = 0;  this._slotAcross.y = 0;  this._slotAcross.active = true;
        this._slotLeft.vb = this._leftVB;     this._slotLeft.x = 0;    this._slotLeft.y = 2;    this._slotLeft.active = true;
        this._slotRight.vb = this._rightVB;   this._slotRight.x = 40;  this._slotRight.y = 0;   this._slotRight.active = true;
        this._slotDiscard.vb = this._discardVB; this._slotDiscard.x = 6; this._slotDiscard.y = 3; this._slotDiscard.active = true;
        this._slotPlayer.vb = this._playerVB; this._slotPlayer.x = 4;  this._slotPlayer.y = 18; this._slotPlayer.active = true;
        this._slotInfo.vb = this._infoVB;     this._slotInfo.x = 44;   this._slotInfo.y = 0;    this._slotInfo.active = true;
        this._slotResult.vb = this._resultVB; this._slotResult.x = 4; this._slotResult.y = 2;
    }

    _renderTile2x2(vb, row, col, tile, bgColor, inverse) {
        const fg = tileFg(tile.suit, tile.value);
        const bg = inverse ? 24 : (bgColor || 0);
        const fgC = inverse ? fg : fg;
        const top = tile.displayTop;
        const bot = tile.displayBottom;
        const c1 = top[0] || ' ';
        const c3 = bot[0] || ' ';
        const W0 = { ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };
        const cell = (ch) => ({ ch, fg: fgC, bg, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row, col, cell(c1));
        vb.setCell(row, col + 1, W0);
        vb.setCell(row + 1, col, cell(c3));
        vb.setCell(row + 1, col + 1, W0);
    }

    _renderTile2x2Dim(vb, row, col, tile) {
        const fg = 8;
        const bg = 0;
        const top = tile.displayTop;
        const bot = tile.displayBottom;
        const c1 = top[0] || ' ';
        const c3 = bot[0] || ' ';
        const W0 = { ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };
        const cell = (ch) => ({ ch, fg, bg, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row, col, cell(c1));
        vb.setCell(row, col + 1, W0);
        vb.setCell(row + 1, col, cell(c3));
        vb.setCell(row + 1, col + 1, W0);
    }

    _renderTileHorizontal(vb, row, col, tile, bgColor) {
        const fg = tileFg(tile.suit, tile.value);
        const bg = bgColor || 0;
        const W0 = { ch: ' ', fg: 0, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 0 };
        const mkCell = (ch, w) => ({ ch, fg, bg, bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: w });
        const horiz = tile.displayHorizontal;
        let cx = col;
        for (let i = 0; i < horiz.length; i++) {
            const ch = horiz[i];
            const w = isWide(ch) ? 2 : 1;
            vb.setCell(row, cx, mkCell(ch, w));
            if (w === 2) vb.setCell(row, cx + 1, W0);
            cx += w;
        }
    }

    _renderFacedown2x2(vb, row, col, ch, fg, bg) {
        const c = ch || '▓';
        const b = bg || 0;
        const f = fg || 240;
        vb.setCell(row, col, { ch: c, fg: f, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row, col + 1, { ch: c, fg: f, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row + 1, col, { ch: c, fg: f, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row + 1, col + 1, { ch: c, fg: f, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
    }

    _renderFacedown4x1(vb, row, col, bg) {
        const b = bg || 0;
        vb.setCell(row, col, { ch: '▒', fg: 240, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row, col + 1, { ch: '▒', fg: 240, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row, col + 2, { ch: '▒', fg: 240, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        vb.setCell(row, col + 3, { ch: '▒', fg: 240, bg: b, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
    }

    _renderPlayerHand(vb) {
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const drawTile = p.lastDraw;
        const melds = p.melds;
        const drawIdx = drawTile ? hand.indexOf(drawTile) : -1;

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
            const isCursor = showCursor && (
                             (this._cursorMode === 'hand' && this._handCursor === visPos) ||
                             (this._cursorMode === 'riichiSelect' && this._riichiCursor === visPos));
            const canDiscard = discardableIndices.includes(visPos);
            let bg = 0;
            if (isCursor) bg = 24;
            if (isCursor && !canDiscard && isDiscardPhase) bg = 236;
            this._renderTile2x2(vb, 1, col, tile, bg, false);
            col += 2;
            visPos++;
        }

        col += gapBeforeDraw;
        if (drawTile) {
            const isCursor = showCursor && (
                             (this._cursorMode === 'hand' && this._handCursor === hand.length - 1) ||
                             (this._cursorMode === 'riichiSelect' && this._riichiCursor === hand.length - 1));
            const canDiscard = discardableIndices.includes(hand.length - 1);
            let bg = 0;
            if (isCursor) bg = 24;
            if (isCursor && !canDiscard && isDiscardPhase) bg = 236;
            this._renderTile2x2(vb, 1, col, drawTile, bg, false);
        }
        col += drawCols;

        if (melds.length > 0) {
            col += 1;
            for (let mi = 0; mi < melds.length; mi++) {
                const m = melds[mi];
                const bgType = meldTypeToBg(m);
                const bg = meldBg(bgType, countCallType(melds.slice(0, mi), bgType));
                for (let ti = 0; ti < m.tiles.length; ti++) {
                    this._renderTile2x2(vb, 1, col, m.tiles[ti], bg, false);
                    col += 2;
                }
            }
        }
    }

    _renderActionBar(vb) {
        const items = this._actionItems;
        if (items.length === 0 && this._cursorMode !== 'chiSelect' && this._cursorMode !== 'kanSelect') return;

        for (let c = 0; c < 40; c++) {
            vb.setCell(0, c, _blankCell);
        }

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
                    this._renderFacedown2x2(vb, 0, col, '▓', 240, bg);
                } else {
                    this._renderTile2x2(vb, 0, col, m.tiles[ti], bg, false);
                }
                col += 2;
            }
        }
        col += gapBeforeDraw;
        if (drawTile) {
            if (this._phase === 'result') {
                this._renderTile2x2(vb, 0, col, drawTile, 0, false);
            } else {
                this._renderFacedown2x2(vb, 0, col, '▓', 240, 236);
            }
        }
        col += drawCols;
        col += gapBeforeHand;
        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (this._phase === 'result') {
                this._renderTile2x2(vb, 0, col, hand[i], 0, false);
            } else {
                this._renderFacedown2x2(vb, 0, col, '▓', 240, 236);
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

        const drawIdx = drawTile ? hand.findIndex(t => t.equals(drawTile)) : -1;
        const handDisplay = hand.length - (drawTile ? 1 : 0);
        const meldCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const base = handDisplay + 1 + meldCount;
        const spare = 18 - base;
        const gapAfterHand = spare >= 2 ? 1 : 0;
        const gapAfterDraw = spare >= 1 ? 1 : 0;
        const startRow = Math.floor((18 - base) / 2);

        let row = startRow;
        const reveal = this._phase === 'result';

        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._renderTileHorizontal(vb, row, 0, hand[i], 0);
            } else {
                this._renderFacedown4x1(vb, row, 0, 236);
            }
            row++;
        }
        row += gapAfterHand;
        if (drawTile) {
            if (reveal) {
                this._renderTileHorizontal(vb, row, 0, drawTile, 0);
            } else {
                this._renderFacedown4x1(vb, row, 0, 236);
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
                    this._renderFacedown4x1(vb, row, 0, bg);
                } else {
                    this._renderTileHorizontal(vb, row, 0, m.tiles[ti], bg);
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

        const drawIdx = drawTile ? hand.findIndex(t => t.equals(drawTile)) : -1;
        const handDisplay = hand.length - (drawTile ? 1 : 0);
        const meldCount = melds.reduce((s, m) => s + m.tiles.length, 0);
        const base = handDisplay + 1 + meldCount;
        const spare = 18 - base;
        const gapAfterMelds = spare >= 2 ? 1 : 0;
        const gapAfterDraw = spare >= 1 ? 1 : 0;
        const startRow = Math.floor((18 - base) / 2);

        let row = startRow;
        const reveal = this._phase === 'result';

        for (let mi = melds.length - 1; mi >= 0; mi--) {
            const m = melds[mi];
            const bgType = meldTypeToBg(m);
            const bg = meldBg(bgType, countCallType(melds.slice(mi + 1), bgType));
            const isClosedKan = m.type === 'kan' && !m.open;
            for (let ti = 0; ti < m.tiles.length; ti++) {
                if (isClosedKan && (ti === 1 || ti === 2)) {
                    this._renderFacedown4x1(vb, row, 0, bg);
                } else {
                    this._renderTileHorizontal(vb, row, 0, m.tiles[ti], bg);
                }
                row++;
            }
        }
        row += gapAfterMelds;
        if (drawTile) {
            if (reveal) {
                this._renderTileHorizontal(vb, row, 0, drawTile, 0);
            } else {
                this._renderFacedown4x1(vb, row, 0, 236);
            }
        }
        row++;
        row += gapAfterDraw;
        for (let i = 0; i < hand.length; i++) {
            if (i === drawIdx) continue;
            if (reveal) {
                this._renderTileHorizontal(vb, row, 0, hand[i], 0);
            } else {
                this._renderFacedown4x1(vb, row, 0, 236);
            }
            row++;
        }
    }

    _renderDiscardTile(vb, row, col, tile, isLatest, isCalled) {
        if (isCalled) {
            this._renderTile2x2Dim(vb, row, col, tile);
        } else {
            this._renderTile2x2(vb, row, col, tile, isLatest ? 240 : 0, isLatest);
        }
    }

    _renderDiscards(vb) {
        const g = this._game;
        if (!g) return;

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
                this._renderDiscardTile(vb, row, col, tile, latest, called);
            }
        }
    }

    _renderInfoPanel(vb) {
        const g = this._game;
        if (!g) return;

        for (let r = 0; r < 21; r++) {
            vb.setCell(r, 0, { ch: '│', fg: 8, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        }

        vb.writeStr(0, 1, '\x1B[1;36m' + g.roundLabel + '\x1B[0m');

        const statsLine = g.honbaLabel
            + ' 残り:' + String(g.wall.getRemainingCount()).padStart(2, '0') + '枚'
            + ' 供托:' + String(g.riichiSticks) + '本'
            + ' 本棒:' + String(g.honba);
        vb.writeStr(1, 1, statsLine);

        const doraIndicators = g.doraIndicators;
        for (let i = 0; i < Math.min(doraIndicators.length, 5); i++) {
            const tile = doraIndicators[i];
            this._renderTile2x2(vb, 2, 3 + i * 6, tile, 0, false);
        }
        const showUra = g.roundResult && g.roundResult.winnerRiichi;
        for (let i = 0; i < Math.min(doraIndicators.length, 5); i++) {
            const col = 3 + i * 6;
            if (showUra) {
                const uraTile = g.wall.getUraDoraIndicators()[i];
                if (uraTile) {
                    this._renderTile2x2(vb, 4, col, uraTile, 0, false);
                } else {
                    vb.setCell(4, col, { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                    vb.setCell(4, col + 1, { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                }
            } else {
                vb.setCell(4, col, { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
                vb.setCell(4, col + 1, { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
            }
            vb.setCell(5, col, { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
            vb.setCell(5, col + 1, { ch: '▒', fg: 240, bg: 0, bold: false, dim: true, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
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
                    const hanStr = yaku.han + '翻';
                    const nameStr = yaku.name;
                    vb.writeStr(y, 2, hanStr + ' ' + nameStr);
                    y++;
                    if (y >= oh - 4) break;
                }
            }

            y = oh - 5;
            const hanFu = r.isYakuman ? '役滿' : (r.totalHan + '翻' + r.fu + '符');
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

        vb.writeStr(0, 0, '┌' + '─'.repeat(78) + '┐');
        for (let r = 1; r < 24; r++) {
            vb.setCell(r, 0, { ch: '│', fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
            vb.setCell(r, 79, { ch: '│', fg: 7, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        }
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
        if (this._cursorMode === 'riichiSelect') {
            return this._getHandCursorPos(this._riichiCursor);
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
        if (this._settingsDialog) {
            this._settingsDialog.handleKey(data);
            if (!this._settingsDialog || this._settingsDialog.closed) this._settingsDialog = null;
            return;
        }

        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (this._phase === 'gameOver') {
            if (code === 0x6E || code === 0x4E || code === 0x0D || code === 0x0A) {
                this._phase = 'settings';
                this._showSettings();
                return;
            }
            if (code === 0x71 || code === 0x51 || code === 0x03) {
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
            if (code === 0x03 || code === 0x71 || code === 0x51) {
                this.close();
                return;
            }
            return;
        }

        if (this._phase === 'playing' && this._autoPlay) {
            if (code === 0x61 || code === 0x41) {
                this._autoPlay = false;
                this._render();
                return;
            }
            if (code === 0x70 || code === 0x50) {
                this._phase = 'paused';
                this._render();
                return;
            }
            if (code === 0x71 || code === 0x51 || code === 0x03) {
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
                    this._render();
                    this._continueGame();
                    return;
                }
            } else {
                if (code === 0x70 || code === 0x50) {
                    this._phase = 'playing';
                    this._render();
                    return;
                }
            }
            if (code === 0x71 || code === 0x51 || code === 0x03) {
                this.close();
                return;
            }
            if (code === 0x1B) {
                const s = typeof data === 'string' ? data : '';
                if (s === '\x1B' || s.length === 1) {
                    this._phase = 'playing';
                    this._render();
                    return;
                }
            }
            return;
        }

        if (!this._game || !this._game.waitingHuman) return;
        if (code === 0x03 || code === 0x71 || code === 0x51) {
            this.close();
            return;
        }
        if (code === 0x61 || code === 0x41) {
            this._autoPlay = true;
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
        if (this._cursorMode === 'riichiSelect') {
            this._handleRiichiSelectKey(data);
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
            this.close();
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
        const maxRegular = hand.length - 1;
        const maxDraw = maxRegular;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[C') {
                if (this._handCursor < maxDraw) {
                    this._handCursor++;
                    this._render();
                }
                return;
            }
            if (s === '\x1B[D') {
                if (this._handCursor > 0) {
                    this._handCursor--;
                    this._render();
                }
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
            this.close();
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
            if (g.availableActions.includes('riichi') || this._canDeclareRiichi()) {
                this._doDiscard(this._handCursor, true);
                return;
            }
            this._doDiscard(this._handCursor);
            return;
        }
    }

    _handleRiichiSelectKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;
        const g = this._game;
        const p = g.players[0];
        const hand = p.hand;
        const discardable = this._getDiscardableIndices();
        if (discardable.length === 0) {
            this._cursorMode = 'hand';
            this._render();
            return;
        }

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[C' || s === '\x1B[D') {
                const curIdx = discardable.indexOf(this._riichiCursor);
                if (s === '\x1B[C') {
                    this._riichiCursor = discardable[(curIdx + 1) % discardable.length];
                } else {
                    this._riichiCursor = discardable[(curIdx - 1 + discardable.length) % discardable.length];
                }
                this._render();
                return;
            }
            if (s === '\x1B[3~' || s === '\x1B[2~' || s === '\x1B[H' || s === '\x1B[F' || s === '\x1B[5~' || s === '\x1B[6~') return;
            this._cursorMode = 'hand';
            this._render();
            return;
        }

        if (code === 0x0D || code === 0x0A) {
            const idx = this._riichiCursor;
            const handIdx = this._visualToHandIdx(idx);
            const testHand = hand.filter((_, i) => i !== handIdx);
            if (checkTenpaiLocal(testHand, p.melds)) {
                this._game.humanRiichi(handIdx);
                this._cursorMode = 'hand';
                this._handCursor = 0;
                this._gameTimer = setTimeout(() => this._continueGame(), 100);
            }
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
            this._cursorMode = 'riichiSelect';
            const discardable = this._getDiscardableIndices();
            this._riichiCursor = discardable.length > 0 ? discardable[0] : 0;
            this._render();
            return;
        }

        if (action && typeof action === 'object') {
            if (action.type === 'chi' && action.chiSets && action.chiSets.length > 1) {
                const chiLabels = action.chiSets.map((set, i) => {
                    return set.map(t => t.name).join(' ');
                });
                const dialog = new SelectDialog(term, {
                    title: 'チー選択',
                    message: 'どの組み合わせでチーしますか？',
                    options: chiLabels,
                    width: 40,
                    onSelect: (idx) => {
                        dialog.close();
                        const call = { ...action, chosenChiSet: idx };
                        g.humanCall(call);
                        this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    },
                    onCancel: () => {
                        dialog.close();
                        this._gameTimer = setTimeout(() => this._continueGame(), 100);
                    },
                });
                dialog.open();
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

    _doDiscard(visualPos, isRiichi = false) {
        const g = this._game;
        const p = g.players[0];
        const tileIdx = this._visualToHandIdx(visualPos);
        if (tileIdx < 0 || tileIdx >= p.hand.length) return;

        if (isRiichi) {
            const testHand = p.hand.filter((_, i) => i !== tileIdx);
            if (checkTenpaiLocal(testHand, p.melds)) {
                g.humanRiichi(tileIdx);
            } else {
                g.humanDiscard(tileIdx);
            }
        } else {
            g.humanDiscard(tileIdx);
        }
        this._cursorMode = 'hand';
        this._handCursor = 0;
        this._gameTimer = setTimeout(() => this._continueGame(), 100);
    }

    _drawPauseOverlay() {
        const vb = this._vb;
        const ox = 4, oy = 2, ow = 36, oh = 15;

        for (let r = oy; r < oy + oh; r++) {
            for (let c = ox; c < ox + ow; c++) {
                vb.setCell(r, c, _blankCell);
            }
        }

        vb.writeStr(oy, ox, '\x1B[1;33m┌' + '─'.repeat(ow - 2) + '┐\x1B[0m');
        for (let r = 1; r < oh - 1; r++) {
            vb.setCell(oy + r, ox, { ch: '│', fg: 33, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
            vb.setCell(oy + r, ox + ow - 1, { ch: '│', fg: 33, bg: 0, bold: false, dim: false, italic: false, underline: false, blink: false, inverse: false, conceal: false, crossedOut: false, width: 1 });
        }
        vb.writeStr(oy + oh - 1, ox, '\x1B[1;33m└' + '─'.repeat(ow - 2) + '┘\x1B[0m');

        vb.writeStr(oy + 3, ox + 2, '\x1B[1;33m' + ' '.repeat(8) + '暫停中' + ' '.repeat(8) + '\x1B[0m');
        vb.writeStr(oy + 7, ox + 2, '  P 取消暫停    Q 退出');
        term.writeVB(vb);
    }

    static get commandName() { return 'jpmj'; }
    static get help() { return 'Japanese Mahjong (14 tiles, 6 AI types)'; }
    static get menu() { return 'Japanese Mahjong'; }
    static get usage() { return 'jpmj'; }
}

function checkTenpaiLocal(hand, melds) {
    return getWaitingTiles(hand, melds).length > 0;
}
