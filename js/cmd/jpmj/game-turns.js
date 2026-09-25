import { Tile } from './tiles.js';
import { checkTenpai } from './yaku.js';

// Turn progression, discards, and riichi declarations.
// Installed on Game.prototype; all state remains on the Game instance.
export const gameTurnMethods = {
  advance() {
    if (this.gameOver || this.roundOver) return true;

    if (this.phase === 'dealer_first_discard') {
      if (this.canDeclareKyuushu(this.currentPlayer)) {
        if (this.players[this.currentPlayer].isHuman) {
          this.availableActions = ['kyuushu', 'discard'];
          return true;
        }
        if (this.players[this.currentPlayer].ai.decideKyuushu(this, this.currentPlayer)) {
          this.handleKyuushuKyuuhai(this.currentPlayer);
          return true;
        }
      }
      if (this.players[this.currentPlayer].isHuman) {
        this.availableActions = ['discard'];
        return true;
      }
      const idx = this.players[this.currentPlayer].ai.chooseDiscard(this, this.currentPlayer);
      this.executeDiscard(this.currentPlayer, idx);
      return false;
    }

    if (this.phase === 'draw') {
      const tile = this.wall.draw();
      if (!tile) {
        this.handleExhaustiveDraw();
        return true;
      }
      const p = this.players[this.currentPlayer];
      p.hand.push(tile);
      p.hand = Tile.sortTiles(p.hand);
      p.lastDraw = tile;
      if (!p.isRiichi) p.isTempFuriten = false;
      const isHuman = this.players[this.currentPlayer].isHuman;
      this.addLog(this.currentPlayer, isHuman ? '摸' : '摸牌', isHuman ? tile.name : '');
      this.turnCount++;

      const tsumoInfo = this.checkTsumo(this.currentPlayer);
      if (tsumoInfo.canWin && !p.isHuman) {
        if (tsumoInfo.hasYaku && this.players[this.currentPlayer].ai.decideTsumo(this, this.currentPlayer)) {
          this.executeWin(this.currentPlayer, 'tsumo', tile);
          return true;
        }
      }

      if (!this.players[this.currentPlayer].isHuman && this.handleAIKan(this.currentPlayer)) {
        return false;
      }

      if (p.isHuman) {
        const kanOptions = this.getHumanKanOptions(this.currentPlayer);
        if (tsumoInfo.canWin || kanOptions.length > 0) {
          this.availableActions = [
            ...(tsumoInfo.canWin ? [tsumoInfo.hasYaku ? 'tsumo' : 'tsumo-no-yaku'] : []),
            ...kanOptions,
            'pass',
          ];
          return true;
        }
      }

      if (p.ippatsuRound >= 0) {
        p.ippatsuRound = -1;
      }

      if (p.isRiichi) {
        const drawnIdx = p.hand.findIndex(t => t.equals(tile));
        if (p.isHuman) {
          this._riichiAutoDiscard = { playerIdx: this.currentPlayer, tileIdx: drawnIdx };
        } else {
          this.executeDiscard(this.currentPlayer, drawnIdx);
        }
        return false;
      }

      this.phase = 'discard';
      return false;
    }

    if (this.phase === 'discard') {
      if (this.turnCount <= 3 && this.canDeclareKyuushu(this.currentPlayer)) {
        if (this.players[this.currentPlayer].isHuman) {
          this.availableActions = ['kyuushu', 'discard'];
          return true;
        }
        if (this.players[this.currentPlayer].ai.decideKyuushu(this, this.currentPlayer)) {
          this.handleKyuushuKyuuhai(this.currentPlayer);
          return true;
        }
      }
      if (this.players[this.currentPlayer].isHuman) {
        this.availableActions = ['discard'];
        return true;
      }
      if (this.handleAIKan(this.currentPlayer)) {
        return false;
      }
      const p = this.players[this.currentPlayer];
      if (!p.isRiichi && p.score >= 1000 && !p.melds.some(m => m.open) && this.wall.getRemainingCount() >= 4 && p.ai.decideRiichi(this, this.currentPlayer)) {
        for (let i = 0; i < p.hand.length; i++) {
          const testHand = p.hand.filter((_, j) => j !== i);
          if (checkTenpai(testHand, p.melds)) {
            this.humanRiichi(i);
            return false;
          }
        }
      }
      const idx = this.players[this.currentPlayer].ai.chooseDiscard(this, this.currentPlayer);
      this.executeDiscard(this.currentPlayer, idx);
      return false;
    }

    if (this.phase === 'call_pending') {
      const needHuman = this.processCallPhase();
      return needHuman;
    }

    if (this.phase === 'rinshan') {
      const tile = this.wall.drawRinshan();
      if (!tile) {
        this.handleExhaustiveDraw();
        return true;
      }
      const p = this.players[this.currentPlayer];
      p.hand.push(tile);
      p.lastDraw = tile;

      const tsumoInfo = this.checkTsumo(this.currentPlayer);
      if (tsumoInfo.canWin) {
        if (this.players[this.currentPlayer].isHuman) {
          this.availableActions = tsumoInfo.hasYaku ? ['tsumo', 'pass'] : ['tsumo-no-yaku', 'pass'];
          return true;
        }
        if (tsumoInfo.hasYaku && this.players[this.currentPlayer].ai.decideTsumo(this, this.currentPlayer)) {
          this.executeWin(this.currentPlayer, 'tsumo', tile);
          return true;
        }
      }

      this.phase = 'discard';
      return false;
    }

    return true;
  },

  humanDiscard(tileIdx) {
    if (!this.players[this.currentPlayer].isHuman) return;
    if (this.phase !== 'dealer_first_discard' && this.phase !== 'discard') return;
    this.executeDiscard(this.currentPlayer, tileIdx);
  },

  passDraw() {
    if (this.phase !== 'draw' && this.phase !== 'rinshan') return false;
    const p = this.players[this.currentPlayer];
    if (!p.isHuman || !p.lastDraw || !this.availableActions.includes('pass')) return false;
    this.phase = 'discard';
    this.availableActions = ['discard'];
    return true;
  },

  executeDiscard(playerIdx, tileIdx, isRiichi = false) {
    const p = this.players[playerIdx];
    const tile = p.hand.splice(tileIdx, 1)[0];
    if (!tile) return;
    if (isRiichi) tile.isRiichi = true;
    p.hand = Tile.sortTiles(p.hand);
    p.discards.push(tile);
    this.lastDiscard = tile;
    this.lastDiscardPlayer = playerIdx;
    this.riichiDeclaredThisTurn = false;
    this.lastActionWasKan = false;

    if (this.firstRoundActive) this.firstDiscards.push(tile);

    let detail = tile.name;
    if (isRiichi) {
      detail += '（立直）';
    } else if (p.lastDraw === tile) {
      detail += '（摸切）';
    }

    this.addLog(playerIdx, '打', detail);

    this.phase = 'call_pending';
    this.availableActions = [];
    this.availableCalls = this.buildAvailableCalls(playerIdx, tile);
    p.lastDraw = null;
  },

  advanceTurn() {
    if (this.suuchaRiichiPending) {
      this.suuchaRiichiPending = false;
      this.handleSuuchaRiichi();
      return;
    }
    if (this.firstRoundActive && this.firstDiscards.length === 4) {
      const first = this.firstDiscards[0];
      if (first.isWind && this.firstDiscards.every(t => t.key() === first.key())) {
        this.handleSuufonRendai();
        return;
      }
    }
    this.firstRoundActive = false;
    this.firstDiscards = [];
    this.lastDiscard = null;
    this.lastDiscardPlayer = -1;
    this.lastActionWasKan = false;
    this.availableCalls = [];
    this.availableActions = [];
    this.players[this.currentPlayer].lastDraw = null;
    this.currentPlayer = (this.currentPlayer + 1) % 4;
    this.phase = 'draw';
  },

  humanRiichi(tileIdx) {
    if (this.phase !== 'discard' && this.phase !== 'dealer_first_discard') return;
    const p = this.players[this.currentPlayer];
    if (p.isRiichi) return;
    if (p.melds.some(m => m.open)) return;
    if (p.score < 1000) return;
    if (this.wall.getRemainingCount() < 4) return;

    if (!p.hand.some((_, i) => {
      const testHand = p.hand.filter((__, j) => j !== i);
      return checkTenpai(testHand, p.melds);
    })) return;

    const tile = p.hand[tileIdx];
    const testHand = p.hand.filter((_, i) => i !== tileIdx);
    if (!checkTenpai(testHand, p.melds)) return;

    p.isRiichi = true;
    p.riichiTurn = this.turnCount;
    this.addLog(this.currentPlayer, '立直', tile.name);
    this._pendingCallEffect = { type: 'riichi', playerIdx: this.currentPlayer };
    this.riichiDeclarers.push(this.currentPlayer);
    if (this.riichiDeclarers.length === 4) {
      this.suuchaRiichiPending = true;
    }
    this.executeDiscard(this.currentPlayer, tileIdx, true);
    if (this.phase === 'call_pending') {
      p.ippatsuRound = this.turnCount;
    }
    p.score -= 1000;
    this.riichiSticks++;
    this.riichiDeclaredThisTurn = true;
  },
};
