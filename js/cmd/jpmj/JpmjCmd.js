import { system, term } from '../../system/sys.js';
import { CmdBase } from '../CmdBase.js';
import { CURSOR_HIDE, CURSOR_SHOW, makeCell } from '../../util/sgr.js';
import { SettingsDialog } from '../../dialog/SettingsDialog.js';
import { ConfirmDialog } from '../../dialog/ConfirmDialog.js';
import { VirtualBuffer } from '../../util/VirtualBuffer.js';
import { Game } from './game.js';
import { palettesMixin } from './palettes.js';
import { renderMixin } from './render.js';
import { loopMixin } from './loop.js';
import { inputMixin } from './input.js';

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
        this._tenpaiCache = { handStr: '', info: null };
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
        this._callEffectOverlay = null;
        this._callEffectTimer = null;
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
            statusRow[9] = makeCell(' ', 8, 17, false, 0);
            statusRow[10] = makeCell('管', 8, 17, false, 2);
            statusRow[11] = makeCell(' ', 8, 17, false, 0);
            statusRow[12] = makeCell('|', 7, 17, false);
            statusRow[13] = makeCell('　', 8, 17, false, 2);
            statusRow[14] = makeCell(' ', 8, 17, false, 0);
            statusRow[15] = makeCell('立', 8, 17, false, 2);
            statusRow[16] = makeCell(' ', 8, 17, false, 0);
            statusRow[17] = makeCell('直', 8, 17, false, 2);
            statusRow[18] = makeCell(' ', 8, 17, false, 0);
            statusRow[19] = makeCell('|', 7, 17, false);
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
        this._tenpaiCache = { handStr: '', info: null };
        this._updateStatusBar();
        this._phase = 'playing';
        this._handCursor = 0;
        this._actionCursor = 0;
        this._cursorMode = 'hand';
        this._continueGame();
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

    static get commandName() { return 'jpmj'; }
    static get help() { return 'Japanese Mahjong (14 tiles, 6 AI types)'; }
    static get menu() { return 'Japanese Mahjong'; }
    static get usage() { return 'jpmj'; }
}

Object.assign(JpmjCmd.prototype, palettesMixin, renderMixin, loopMixin, inputMixin);