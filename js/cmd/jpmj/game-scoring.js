import { evaluateHand, canFormCompleteHand, getWaitingTiles, removeTiles } from './yaku.js';

// Win eligibility, furiten, yaku context, and winning-hand payments.
// Installed on Game.prototype; all state remains on the Game instance.
export const gameScoringMethods = {
  checkTsumo(playerIdx) {
    const p = this.players[playerIdx];
    if (!p.lastDraw) return { canWin: false, hasYaku: false };
    const handMinusDraw = removeTiles(p.hand, p.lastDraw.key(), 1);
    const canForm = canFormCompleteHand(handMinusDraw, p.melds, p.lastDraw);
    if (!canForm) return { canWin: false, hasYaku: false };
    const result = evaluateHand(
      handMinusDraw,
      p.melds,
      p.lastDraw,
      'tsumo',
      this.getGameState(playerIdx, p.lastDraw, 'tsumo')
    );
    return { canWin: true, hasYaku: result !== null };
  },

  checkRon(playerIdx, tile) {
    if (this.isFuriten(playerIdx)) return null;
    const p = this.players[playerIdx];
    const result = evaluateHand(
      p.hand, p.melds, tile, 'ron',
      this.getGameState(playerIdx, tile, 'ron')
    );
    return result;
  },

  executeWin(playerIdx, winType, tile) {
    const p = this.players[playerIdx];
    this.addLog(playerIdx, winType === 'tsumo' ? 'ツモ' : 'ロン', tile.name);
    const handForEval = winType === 'tsumo'
      ? removeTiles(p.hand, tile.key(), 1)
      : p.hand;
    const result = evaluateHand(
      handForEval,
      p.melds,
      tile,
      winType,
      this.getGameState(playerIdx, tile, winType)
    );

    if (!result) return;

    this.winner = playerIdx;
    if (winType === 'ron') p.ronTile = tile;
    const isRenchan = playerIdx === this.dealerIndex;
    const nextRoundNum = isRenchan ? this.roundNumber : this.roundNumber + 1;
    const nextWind = ['東', '南', '西', '北'][Math.floor(nextRoundNum / 4) % 4];
    const nextRoundLabel = `${nextWind}${(nextRoundNum % 4) + 1}局`;
    this.roundResult = {
      winner: playerIdx,
      winType,
      discarder: winType === 'ron' ? this.lastDiscardPlayer : -1,
      yaku: result.yaku,
      totalHan: result.totalHan,
      fu: result.fu,
      payments: result.payments,
      deltas: this.computeWinDeltas(playerIdx, result.payments),
      isYakuman: result.isYakuman,
      winTile: tile,
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      doraHan: result.doraHan || 0,
      uraDoraHan: result.uraDoraHan || 0,
      isRenchan,
      winnerRiichi: p.isRiichi,
      nextRoundLabel,
    };

    if (p.isRiichi) {
      const uraTiles = this.wall.getUraDoraIndicators();
      this.addSystemLog('裏ドラ', uraTiles.map(t => t.name).join(' '));
    }
    this.addSystemLog('和牌', p.name);
    this._pendingCallEffect = { type: winType, playerIdx };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  computeWinDeltas(winnerIdx, payments) {
    const deltas = [0, 0, 0, 0];
    if (payments.type === 'tsumo') {
      for (let i = 0; i < 4; i++) {
        if (i === winnerIdx) continue;
        deltas[i] -= i === this.dealerIndex ? payments.dealerPayment : payments.childPayment;
      }
    } else {
      deltas[this.lastDiscardPlayer] -= payments.discarderPayment;
    }
    deltas[winnerIdx] += payments.total;

    if (this.honba > 0) {
      if (payments.type === 'tsumo') {
        for (let i = 0; i < 4; i++) {
          if (i === winnerIdx) continue;
          deltas[i] -= this.honba * 100;
        }
      } else {
        deltas[this.lastDiscardPlayer] -= this.honba * 300;
      }
      deltas[winnerIdx] += this.honba * 300;
    }

    if (this.riichiSticks > 0) {
      deltas[winnerIdx] += this.riichiSticks * 1000;
    }
    return deltas;
  },

  isFuriten(playerIdx) {
    const p = this.players[playerIdx];
    if (p.isTempFuriten) return true;
    const waits = getWaitingTiles(p.hand, p.melds);
    if (waits.length === 0) return false;
    return waits.some(w => p.discards.some(d => d.key() === w.key()));
  },

  getGameState(playerIdx, winTile, winType) {
    const p = this.players[playerIdx];
    return {
      isDealer: playerIdx === this.dealerIndex,
      seatWind: p.seatWind,
      roundWind: this.roundWind + 1,
      winType,
      winTile,
      isRiichi: p.isRiichi,
      isDoubleRiichi: p.isRiichi && !this.firstRoundCallsMade && p.riichiTurn < 4,
      isIppatsu: p.ippatsuRound >= 0,
      isTenhou: this.turnCount === 0 && winType === 'tsumo' && playerIdx === this.dealerIndex,
      isChiihou: this.turnCount === 0 && winType === 'tsumo' && playerIdx !== this.dealerIndex,
      isRinshan: this.phase === 'rinshan',
      isChankan: this.phase === 'call_pending' && this.lastActionWasKan,
      isHaitei: this.wall.isExhausted() && winType === 'tsumo',
      isHoutei: this.wall.isExhausted() && winType === 'ron',
      doraIndicators: this.wall.getDoraIndicators(),
      uraDoraIndicators: this.wall.getUraDoraIndicators(),
    };
  },
};
