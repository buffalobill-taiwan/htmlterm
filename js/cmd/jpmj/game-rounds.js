import { checkTenpai } from './yaku.js';

// Abortive/exhaustive draws, round settlement, and final standings.
// Installed on Game.prototype; all state remains on the Game instance.
export const gameRoundMethods = {
  canDeclareKyuushu(playerIdx) {
    const p = this.players[playerIdx];
    if (p.melds.length > 0) return false;
    const terminalTypes = new Set();
    for (const t of p.hand) {
      if (t.isTerminal) terminalTypes.add(t.key());
    }
    return terminalTypes.size >= 9;
  },

  wouldTriggerSuufonRendai(tile) {
    if (!this.firstRoundActive) return false;
    if (this.firstDiscards.length !== 3) return false;
    if (!tile || !tile.isWind) return false;
    const first = this.firstDiscards[0];
    return first.isWind && this.firstDiscards.every(t => t.key() === first.key()) && tile.key() === first.key();
  },

  wouldTriggerSuukantsuAbort(playerIdx) {
    if (this.kanDeclarers.length + 1 < 4) return false;
    const allDeclarers = [...this.kanDeclarers, playerIdx];
    return new Set(allDeclarers).size > 1;
  },

  wouldTriggerSuuchaRiichi(playerIdx) {
    return this.riichiDeclarers.length >= 3 && !this.riichiDeclarers.includes(playerIdx);
  },

  handleSuuchaRiichi() {
    this.addSystemLog('流局', '四家立直');
    for (const p of this.players) {
      p.isRiichi = false;
      p.riichiTurn = -1;
    }
    const nextWind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4) % 4];
    const nextRoundLabel = `${nextWind}${(this.roundNumber % 4) + 1}局`;
    this.roundResult = {
      winner: -1,
      winType: 'suucha_riichi',
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      deltas: [1000, 1000, 1000, 1000],
      isRenchan: true,
      nextRoundLabel,
    };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  wouldTriggerSanchaRon(playerIdx) {
    if (!this.sanchaRonPending) return false;
    const pos = this.sanchaRonCandidates.indexOf(playerIdx);
    return pos >= 2;
  },

  handleSanchaRon() {
    this.addSystemLog('流局', '三家和');
    for (const p of this.players) {
      p.isRiichi = false;
      p.riichiTurn = -1;
    }
    const nextWind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4) % 4];
    const nextRoundLabel = `${nextWind}${(this.roundNumber % 4) + 1}局`;
    this.roundResult = {
      winner: -1,
      winType: 'sancha_ron',
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      deltas: [0, 0, 0, 0],
      isRenchan: true,
      nextRoundLabel,
    };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  handleSuukantsuAbort() {
    this.addSystemLog('流局', '四槓散了');
    for (const p of this.players) {
      p.isRiichi = false;
      p.riichiTurn = -1;
    }
    const nextWind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4) % 4];
    const nextRoundLabel = `${nextWind}${(this.roundNumber % 4) + 1}局`;
    this.roundResult = {
      winner: -1,
      winType: 'suukantsu_abort',
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      deltas: [0, 0, 0, 0],
      isRenchan: true,
      nextRoundLabel,
    };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  handleSuufonRendai() {
    this.addSystemLog('流局', '四風連打');
    for (const p of this.players) {
      p.isRiichi = false;
      p.riichiTurn = -1;
    }
    const nextWind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4) % 4];
    const nextRoundLabel = `${nextWind}${(this.roundNumber % 4) + 1}局`;
    this.roundResult = {
      winner: -1,
      winType: 'suufon_rendai',
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      deltas: [0, 0, 0, 0],
      isRenchan: true,
      nextRoundLabel,
    };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  handleKyuushuKyuuhai(playerIdx) {
    this.addSystemLog('流局', '九種九牌 by ' + this.players[playerIdx].name);
    for (const p of this.players) {
      p.isRiichi = false;
      p.riichiTurn = -1;
    }
    const nextWind = ['東', '南', '西', '北'][Math.floor(this.roundNumber / 4) % 4];
    const nextRoundLabel = `${nextWind}${(this.roundNumber % 4) + 1}局`;
    this.roundResult = {
      winner: -1,
      winType: 'kyuushu_kyuuhai',
      declarer: playerIdx,
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      deltas: [0, 0, 0, 0],
      isRenchan: true,
      nextRoundLabel,
    };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  handleExhaustiveDraw() {
    this.addSystemLog('流局', '');
    this.phase = 'exhaustive_draw';
    const tenpaiPlayers = [];
    const notenPlayers = [];

    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      p.isTenpai = checkTenpai(p.hand, p.melds);
      if (p.isTenpai) tenpaiPlayers.push(i);
      else notenPlayers.push(i);
    }

    let notenPayment = 0;
    const deltas = [0, 0, 0, 0];
    if (notenPlayers.length > 0 && tenpaiPlayers.length > 0) {
      const paymentPerNoten = 3000 / notenPlayers.length;
      const total = 3000;
      notenPayment = total / tenpaiPlayers.length;
      for (const ti of tenpaiPlayers) {
        deltas[ti] += notenPayment;
      }
      for (const ni of notenPlayers) {
        deltas[ni] -= paymentPerNoten;
      }
    }

    for (const p of this.players) {
        p.isRiichi = false;
        p.riichiTurn = -1;
    }

    const dealerTenpai = tenpaiPlayers.includes(this.dealerIndex);
    const isRenchan = dealerTenpai;
    const nextRoundNum = isRenchan ? this.roundNumber : this.roundNumber + 1;
    const nextWind = ['東', '南', '西', '北'][Math.floor(nextRoundNum / 4) % 4];
    const nextRoundLabel = `${nextWind}${(nextRoundNum % 4) + 1}局`;

    this.roundResult = {
      winner: -1,
      winType: 'exhaustive',
      tenpaiPlayers,
      notenPlayers,
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      notenPayment,
      deltas,
      isRenchan,
      nextRoundLabel,
    };
    this.roundOver = true;
    this.phase = 'round_end';
  },

  checkGameOver() {
    if (this.roundNumber >= this.maxRounds) {
      this.gameOver = true;
      return true;
    }
    return false;
  },

  endRound() {
    this.roundCount++;
    if (this.roundResult.winner === -1) this.ryuukyokuCount++;
    if (this.roundResult.winType === 'kyuushu_kyuuhai' || this.roundResult.winType === 'suufon_rendai' || this.roundResult.winType === 'suukantsu_abort' || this.roundResult.winType === 'suucha_riichi' || this.roundResult.winType === 'sancha_ron') {
      this.honba++;
    } else if (this.roundResult.winner === -1) {
      const dealerTenpai = this.players[this.dealerIndex].isTenpai;
      if (!dealerTenpai) {
        this.dealerIndex = (this.dealerIndex + 1) % 4;
        this.honba = 0;
        this.roundNumber++;
      } else {
        this.honba++;
        this.renchanCount++;
      }
    } else {
      if (this.roundResult.winner === this.dealerIndex) {
        this.honba++;
        this.renchanCount++;
      } else {
        this.dealerIndex = (this.dealerIndex + 1) % 4;
        this.honba = 0;
        this.roundNumber++;
      }
    }

    if (this.checkGameOver()) {
      this.phase = 'game_end';
      this.gameOver = true;
      if (this.riichiSticks > 0) {
        const sorted = [...this.players].sort((a, b) => b.score - a.score);
        sorted[0].score += this.riichiSticks * 1000;
        this.riichiSticks = 0;
      }
      this.addSystemLog('終局', '遊戲結束');
    }
  },

  commitRoundEnd() {
    const r = this.roundResult;
    if (r && r.deltas) {
      for (let i = 0; i < 4; i++) this.players[i].score += r.deltas[i];
      if (this.riichiSticks > 0 && (r.winner >= 0 || r.winType === 'suucha_riichi')) {
        this.riichiSticks = 0;
      }
      if (r.winner >= 0) {
        const wp = this.players[r.winner];
        if (r.winType === 'tsumo') {
          wp.stats.tsumo++;
        } else {
          wp.stats.ron++;
          if (r.discarder >= 0) this.players[r.discarder].stats.dealtIn++;
        }
      }
    }
    this.endRound();
  },

  getFinalScores() {
    const scores = this.players.map((p, i) => ({
      name: p.name,
      score: p.score,
      isHuman: p.isHuman,
      tsumo: p.stats.tsumo,
      ron: p.stats.ron,
      dealtIn: p.stats.dealtIn,
    }));
    scores.sort((a, b) => b.score - a.score);
    scores.forEach((s, i) => { s.rank = i + 1; });
    return scores;
  },
};
