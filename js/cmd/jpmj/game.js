// Game state, initialization, round setup, and logging.
import { Tile } from './tiles.js';
import { Wall } from './wall.js';
import { createAI } from './ai_factory.js';
import { gameTurnMethods } from './game-turns.js';
import { gameCallMethods } from './game-calls.js';
import { gameKanMethods } from './game-kans.js';
import { gameScoringMethods } from './game-scoring.js';
import { gameRoundMethods } from './game-rounds.js';

export class Game {
  constructor(options) {
    this.options = options;
    this.players = [];
    this.wall = null;
    this.roundNumber = 0;
    this.honba = 0;
    this.riichiSticks = 0;
    this.dealerIndex = 0;
    if (this.options.startingSeat) {
      if (this.options.startingSeat === 'random') {
        this.dealerIndex = Math.floor(Math.random() * 4);
      } else {
        const seatMap = { east: 0, south: 3, west: 2, north: 1 };
        this.dealerIndex = seatMap[this.options.startingSeat] || 0;
      }
    }
    this.currentPlayer = 0;
    this.lastDiscard = null;
    this.lastDiscardPlayer = -1;
    this.phase = 'idle';
    this.turnCount = 0;
    this.availableActions = [];
    this.availableCalls = [];
    this.roundResult = null;
    this.gameOver = false;
    this.roundOver = false;
    this.riichiDeclaredThisTurn = false;
    this.lastActionWasRiichi = false;
    this.lastActionWasKan = false;
    this.discardAfterRiichi = null;
    this.firstRoundActive = false;
    this.firstRoundCallsMade = false;
    this.firstDiscards = [];
    this.kanDeclarers = [];
    this.riichiDeclarers = [];
    this.suuchaRiichiPending = false;
    this.sanchaRonCandidates = [];
    this.sanchaRonPending = false;
    this.roundCount = 0;
    this.renchanCount = 0;
    this.ryuukyokuCount = 0;
    this.log = [];
    this.logGroup = 0;
    this.lastLogPlayer = -1;
    this.logEntryId = 0;
    this._pendingCallEffect = null;
    this._riichiAutoDiscard = null;
  }

  get maxRounds() {
    return this.options.length === 'east' ? 4
         : this.options.length === 'half' ? 8 : 16;
  }

  get roundWind() {
    return Math.floor(this.roundNumber / 4);
  }

  get roundLabel() {
    const wind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4)];
    let label = wind + ((this.roundNumber % 4) + 1) + '局';
    if (this.roundNumber === this.maxRounds - 1) label += ' All Last';
    return label;
  }

  get honbaLabel() {
    return this.honba + '本場';
  }

  get doraIndicators() {
    return this.wall ? this.wall.getDoraIndicators() : [];
  }

  get waitingHuman() {
    if (this.gameOver || this.roundOver) return false;
    if (this.currentPlayer === 0) return true;
    if (this.phase === 'call_pending' && this.availableCalls &&
        this.availableCalls.some(c => this.players[c.playerIdx].isHuman)) {
      return true;
    }
    return false;
  }

  initGame() {
    this.players = [];
    const diff = this.options.difficulties || [];
    for (let i = 0; i < 4; i++) {
      const isHuman = i === 0;
      const difficulty = isHuman
        ? (this.options.autoPlayDifficulty || 'normal')
        : (diff[i - 1] || 'normal');
      this.players.push({
        name: i === 0 ? 'あなた' : i === 1 ? '下家' : i === 2 ? '對家' : '上家',
        isHuman,
        difficulty,
        ai: createAI(difficulty),
        hand: [],
        melds: [],
        discards: [],
        score: 25000,
        seatWind: 0,
        isRiichi: false,
        riichiTurn: -1,
        isTenpai: false,
        ippatsuRound: -1,
        lastDraw: null,
        isTempFuriten: false,
        ronTile: null,
        stats: { tsumo: 0, ron: 0, dealtIn: 0 },
      });
    }
    this.roundNumber = 0;
    this.honba = 0;
    this.riichiSticks = 0;
    this.dealerIndex = 0;
    if (this.options.startingSeat && this.options.startingSeat !== 'random') {
      const seatMap = { east: 0, south: 3, west: 2, north: 1 };
      this.dealerIndex = seatMap[this.options.startingSeat] || 0;
    } else if (this.options.startingSeat === 'random') {
      this.dealerIndex = Math.floor(Math.random() * 4);
    }
    this.gameOver = false;
    this.startNewRound();
  }

  startNewRound() {
    this.logGroup = 0;
    this.lastLogPlayer = -1;
    this.firstRoundActive = true;
    this.firstRoundCallsMade = false;
    this.firstDiscards = [];
    this.kanDeclarers = [];
    this.riichiDeclarers = [];
    this.suuchaRiichiPending = false;
    this.sanchaRonCandidates = [];
    this.sanchaRonPending = false;
    const wind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4) % 4];
    const label = `${wind}${(this.roundNumber % 4) + 1}局`;
    this.addSystemLog('開始', label);

    this.wall = new Wall();
    for (const p of this.players) {
      p.hand = [];
      p.melds = [];
      p.discards = [];
      p.isRiichi = false;
      p.riichiTurn = -1;
      p.isTenpai = false;
      p.ippatsuRound = -1;
      p.lastDraw = null;
      p.isTempFuriten = false;
      p.ronTile = null;
    }
    for (let i = 0; i < 4; i++) {
      this.players[i].seatWind = ((i - this.dealerIndex + 4) % 4) + 1;
    }

    this.wall.deal(this.players);
    for (const p of this.players) {
      p.hand = Tile.sortTiles(p.hand);
    }
    this.players[this.dealerIndex].hand.push(this.wall.dealerExtraTile);
    this.players[this.dealerIndex].lastDraw = this.wall.dealerExtraTile;
    this.currentPlayer = this.dealerIndex;
    this.lastDiscard = null;
    this.lastDiscardPlayer = -1;
    this.turnCount = 0;
    this.availableActions = [];
    this.availableCalls = [];
    this.roundResult = null;
    this.roundOver = false;
    this.riichiDeclaredThisTurn = false;
    this.lastActionWasRiichi = false;

    this.phase = 'dealer_first_discard';
  }

  addLog(playerIdx, action, detail) {
    if (playerIdx !== this.lastLogPlayer) this.logGroup++;
    this.lastLogPlayer = playerIdx;
    const p = this.players[playerIdx];
    this.log.push({
      id: this.logEntryId++,
      turn: this.turnCount,
      group: this.logGroup,
      player: p ? p.name : '系統',
      action,
      detail: detail || '',
    });
    if (this.log.length > 256) this.log.shift();
  }

  addSystemLog(action, detail) {
    this.addLog(-1, action, detail);
  }
}

// Preserve class-method descriptors and the existing Game API.
for (const methods of [
  gameTurnMethods,
  gameCallMethods,
  gameKanMethods,
  gameScoringMethods,
  gameRoundMethods,
]) {
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(Game.prototype, name, {
      value, writable: true, configurable: true, enumerable: false,
    });
  }
}
