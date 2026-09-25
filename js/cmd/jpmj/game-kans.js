import { evaluateHand, getCounts, removeTiles } from './yaku.js';

// Human and AI concealed/added kans, including chankan handling.
// Installed on Game.prototype; all state remains on the Game instance.
export const gameKanMethods = {
  buildAvailableKans() {
    const p = this.players[this.currentPlayer];
    if (!p.isHuman) return [];
    if (p.isRiichi) return [];
    if (this.phase !== 'discard' && this.phase !== 'dealer_first_discard') return [];

    const kans = [];
    const handCounts = getCounts(p.hand);

    for (const [k, c] of Object.entries(handCounts)) {
      if (c === 4) {
        const tile = p.hand.find(t => t.key() === k);
        kans.push({ type: 'ankan', tile, meldIndex: -1, desc: `暗槓 ${tile.name}` });
      }
    }

    for (let mi = 0; mi < p.melds.length; mi++) {
      const m = p.melds[mi];
      if (m.type === 'triplet' && !m.isKan) {
        const tileKey = m.tiles[0].key();
        if ((handCounts[tileKey] || 0) >= 1) {
          const tile = p.hand.find(t => t.key() === tileKey);
          if (tile) {
            kans.push({ type: 'kakan', tile, meldIndex: mi, desc: `加槓 ${tile.name}` });
          }
        }
      }
    }

    return kans;
  },

  executeKan(kanOption) {
    const p = this.players[this.currentPlayer];
    const tile = kanOption.tile;
    const handCounts = getCounts(p.hand);

    if (kanOption.type === 'ankan') {
      const newHand = [];
      let n = 4;
      for (const t of p.hand) {
        if (n > 0 && t.key() === tile.key()) { n--; }
        else { newHand.push(t); }
      }
      p.hand = newHand;
      if (p.lastDraw && !p.hand.includes(p.lastDraw)) p.lastDraw = null;
      p.melds.push({ type:'kan', tiles:[tile, tile, tile, tile], open:false });
      this.addLog(this.currentPlayer, '暗槓', tile.name);

      this.lastDiscardPlayer = this.currentPlayer;
      const chankanCalls = [];
      for (let ci = 1; ci <= 3; ci++) {
        const pIdx = (this.currentPlayer + ci) % 4;
        const other = this.players[pIdx];
        const gs = this.getGameState(pIdx, tile, 'ron');
        const result = evaluateHand(other.hand, other.melds, tile, 'ron', gs);
        if (result && !this.isFuriten(pIdx) && result.yaku.some(y => y.name === '国士無双')) {
          chankanCalls.push({ type: 'ron', playerIdx: pIdx, tile });
        }
      }
      if (chankanCalls.length > 0) {
        this.lastActionWasKan = true;
        this.sanchaRonCandidates = chankanCalls.map(c => c.playerIdx);
        this.sanchaRonPending = this.sanchaRonCandidates.length >= 3;
        this.availableCalls = chankanCalls;
        this.availableActions = [];
        this.phase = 'call_pending';
        return;
      }
    } else if (kanOption.type === 'kakan') {
      const meldIndex = kanOption.meldIndex;
      const m = p.melds[meldIndex];
      const newHand = [];
      let removed = false;
      for (const t of p.hand) {
        if (!removed && t.key() === tile.key()) { removed = true; }
        else { newHand.push(t); }
      }
      p.hand = newHand;
      if (p.lastDraw && !p.hand.includes(p.lastDraw)) p.lastDraw = null;
      m.type = 'kan';
      m.tiles.push(tile);
      m.isKan = true;
      m.open = true;
      this.addLog(this.currentPlayer, '加槓', tile.name);

      this.lastDiscardPlayer = this.currentPlayer;
      const chankanCalls = [];
      for (let ci = 1; ci <= 3; ci++) {
        const pIdx = (this.currentPlayer + ci) % 4;
        const other = this.players[pIdx];
        const gs = this.getGameState(pIdx, tile, 'ron');
        const result = evaluateHand(other.hand, other.melds, tile, 'ron', gs);
        if (result && !this.isFuriten(pIdx)) {
          chankanCalls.push({ type: 'ron', playerIdx: pIdx, tile });
        }
      }
      if (chankanCalls.length > 0) {
        this.lastActionWasKan = true;
        this.sanchaRonCandidates = chankanCalls.map(c => c.playerIdx);
        this.sanchaRonPending = this.sanchaRonCandidates.length >= 3;
        this.availableCalls = chankanCalls;
        this.availableActions = [];
        this.phase = 'call_pending';
        return;
      }
    }

    this.lastActionWasKan = true;
    for (let i = 0; i < 4; i++) {
      this.players[i].ippatsuRound = -1;
    }
    this.wall.addDoraIndicator();
    this.kanDeclarers.push(this.currentPlayer);
    if (this.kanDeclarers.length >= 4 && new Set(this.kanDeclarers).size > 1) {
      this.handleSuukantsuAbort();
      return;
    }
    this.availableActions = [];
    this.phase = 'rinshan';
  },

  handleAIKan(playerIdx) {
    const p = this.players[playerIdx];
    if (p.isRiichi) return false;
    if (this.phase !== 'discard') return false;
    if (!p.lastDraw) return false;

    const counts = getCounts(p.hand);

    for (const [k, c] of Object.entries(counts)) {
      if (c === 4 && p.ai.decideKan(this, playerIdx)) {
        const tile = p.hand.find(t => t.key() === k);
        const newHand = [];
        let n = 4;
        for (const t of p.hand) {
          if (n > 0 && t.key() === k) { n--; }
          else { newHand.push(t); }
        }
        p.hand = newHand;
        if (p.lastDraw && !p.hand.includes(p.lastDraw)) p.lastDraw = null;
        p.melds.push({ type:'kan', tiles:[tile, tile, tile, tile], open:false });
        this.addLog(playerIdx, '暗槓', tile.name);

        this.lastDiscardPlayer = playerIdx;
        const chankanCalls = [];
        for (let ci = 1; ci <= 3; ci++) {
          const oIdx = (playerIdx + ci) % 4;
          const other = this.players[oIdx];
          const gs = this.getGameState(oIdx, tile, 'ron');
          const result = evaluateHand(other.hand, other.melds, tile, 'ron', gs);
          if (result && !this.isFuriten(oIdx) && result.yaku.some(y => y.name === '国士無双')) {
            chankanCalls.push({ type: 'ron', playerIdx: oIdx, tile });
          }
        }
        if (chankanCalls.length > 0) {
          this.lastActionWasKan = true;
          this.sanchaRonCandidates = chankanCalls.map(c => c.playerIdx);
          this.sanchaRonPending = this.sanchaRonCandidates.length >= 3;
          this.availableCalls = chankanCalls;
          this.availableActions = [];
          this.phase = 'call_pending';
          return true;
        }

        this.wall.addDoraIndicator();
        for (let i = 0; i < 4; i++) {
          this.players[i].ippatsuRound = -1;
        }
        this.kanDeclarers.push(playerIdx);
        if (this.kanDeclarers.length >= 4 && new Set(this.kanDeclarers).size > 1) {
          this.handleSuukantsuAbort();
          return true;
        }
        this.availableActions = [];
        this.phase = 'rinshan';
        return true;
      }
    }

    for (const m of p.melds) {
      if (m.type === 'triplet' && !m.isKan) {
        const ponKey = m.tiles[0].key();
        if ((counts[ponKey] || 0) >= 1) {
          const tile = p.hand.find(t => t.key() === ponKey);
          if (tile) {
            const shantenBefore = p.ai.estimateShanten(p.hand, p.melds);
            const handAfter = removeTiles(p.hand, ponKey, 1);
            const shantenAfter = p.ai.estimateShanten(handAfter, p.melds);
            if (shantenAfter <= shantenBefore) {
              const newHand = [];
              let removed = false;
              for (const t of p.hand) {
                if (!removed && t.key() === ponKey) { removed = true; }
                else { newHand.push(t); }
              }
              p.hand = newHand;
              if (p.lastDraw && !p.hand.includes(p.lastDraw)) p.lastDraw = null;
              m.type = 'kan';
              m.tiles.push(tile);
              m.isKan = true;
              this.lastActionWasKan = true;
              this.addLog(playerIdx, '加槓', tile.name);

              this.lastDiscardPlayer = playerIdx;
              const chankanCalls = [];
              for (let ci = 1; ci <= 3; ci++) {
                const pIdx = (playerIdx + ci) % 4;
                const other = this.players[pIdx];
                const gs = this.getGameState(pIdx, tile, 'ron');
                const result = evaluateHand(other.hand, other.melds, tile, 'ron', gs);
                if (result && !this.isFuriten(pIdx)) {
                  chankanCalls.push({ type: 'ron', playerIdx: pIdx, tile });
                }
              }
              if (chankanCalls.length > 0) {
                this.sanchaRonCandidates = chankanCalls.map(c => c.playerIdx);
                this.sanchaRonPending = this.sanchaRonCandidates.length >= 3;
                this.availableCalls = chankanCalls;
                this.availableActions = [];
                this.phase = 'call_pending';
                return true;
              }

              this.wall.addDoraIndicator();
              this.kanDeclarers.push(playerIdx);
              if (this.kanDeclarers.length >= 4 && new Set(this.kanDeclarers).size > 1) {
                this.handleSuukantsuAbort();
                return true;
              }

              for (let i = 0; i < 4; i++) {
                this.players[i].ippatsuRound = -1;
              }
              this.availableActions = [];
              this.phase = 'rinshan';
              return true;
            }
          }
        }
      }
    }

    return false;
  },

  getHumanKanOptions(playerIdx) {
    const p = this.players[playerIdx];
    if (p.isRiichi) return [];
    if (!p.lastDraw) return [];
    const counts = getCounts(p.hand);
    const options = [];

    for (const [k, c] of Object.entries(counts)) {
      if (c === 4) {
        const tile = p.hand.find(t => t.key() === k);
        options.push({ type: 'ankan', tile, desc: '暗槓 ' + tile.name });
      }
    }

    for (let mi = 0; mi < p.melds.length; mi++) {
      const m = p.melds[mi];
      if (m.type === 'triplet' && !m.isKan) {
        const ponKey = m.tiles[0].key();
        if ((counts[ponKey] || 0) >= 1) {
          const tile = p.hand.find(t => t.key() === ponKey);
          if (tile) {
            options.push({ type: 'kakan', tile, meldIndex: mi, desc: '加槓 ' + tile.name });
          }
        }
      }
    }

    return options;
  },
};
