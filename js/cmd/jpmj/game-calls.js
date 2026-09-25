import { Tile } from './tiles.js';
import { evaluateHand, canFormCompleteHand, getCounts, findTile } from './yaku.js';

// Call discovery, priority resolution, and chi/pon/open-kan execution.
// Installed on Game.prototype; all state remains on the Game instance.
export const gameCallMethods = {
  buildAvailableCalls(discardPlayerIdx, tile) {
    const calls = [];
    for (let i = 1; i <= 3; i++) {
      const pIdx = (discardPlayerIdx + i) % 4;
      const p = this.players[pIdx];
      const hand = p.hand;
      if (p.isRiichi) {
        const ronCheck = evaluateHand(hand, p.melds, tile, 'ron', this.getGameState(pIdx, tile, 'ron'));
        if (ronCheck && !this.isFuriten(pIdx)) {
          calls.push({ type: 'ron', playerIdx: pIdx, tile });
        }
        continue;
      }

      const ronCheck = evaluateHand(hand, p.melds, tile, 'ron', this.getGameState(pIdx, tile, 'ron'));
      if (ronCheck && !this.isFuriten(pIdx)) {
        calls.push({ type: 'ron', playerIdx: pIdx, tile });
      }
      if (p.isHuman) {
        if (this.isFuriten(pIdx) && (ronCheck || canFormCompleteHand(hand, p.melds, tile))) {
          calls.push({ type: 'ron-furiten', playerIdx: pIdx, tile });
        } else if (!ronCheck && canFormCompleteHand(hand, p.melds, tile)) {
          calls.push({ type: 'ron-no-yaku', playerIdx: pIdx, tile });
        }
      }

      if (!this.wall.isExhausted()) {
        const handCounts = getCounts(hand);
        const tileKey = tile.key();
        if ((handCounts[tileKey] || 0) >= 2) {
          calls.push({ type: 'pon', playerIdx: pIdx, tile });
          if ((handCounts[tileKey] || 0) >= 3) {
            calls.push({ type: 'kan', playerIdx: pIdx, tile, isCalled: true });
          }
        }

        if (i === 1 && tile.suit !== 'honor') {
          const v = tile.value;
          const s = tile.suit;
          const chiSets = [];
          if (v >= 3 && findTile(hand, s, v-2) && findTile(hand, s, v-1)) {
            chiSets.push([new Tile(s, v-2), new Tile(s, v-1), tile]);
          }
          if (v >= 2 && v <= 8 && findTile(hand, s, v-1) && findTile(hand, s, v+1)) {
            chiSets.push([new Tile(s, v-1), tile, new Tile(s, v+1)]);
          }
          if (v <= 7 && findTile(hand, s, v+1) && findTile(hand, s, v+2)) {
            chiSets.push([tile, new Tile(s, v+1), new Tile(s, v+2)]);
          }
          if (chiSets.length > 0) {
            calls.push({ type: 'chi', playerIdx: pIdx, tile, chiSets });
          }
        }
      }
    }

    this.sanchaRonCandidates = calls.filter(c => c.type === 'ron').map(c => c.playerIdx);
    this.sanchaRonPending = this.sanchaRonCandidates.length >= 3;

    calls.sort((a, b) => {
      const pri = { ron:0, 'ron-no-yaku':1, 'ron-furiten':2, kan:3, pon:4, chi:5 };
      return (pri[a.type] ?? 99) - (pri[b.type] ?? 99);
    });

    return calls;
  },

  processCallPhase() {
    const aiCalls = this.availableCalls.filter(c => !this.players[c.playerIdx].isHuman);
    const aiDecisions = aiCalls.map(c => {
      const p = this.players[c.playerIdx];
      return { playerIdx: c.playerIdx, call: p.ai.decideCall(this, [c]) };
    }).filter(d => d.call !== null);

    const humanCalls = this.availableCalls.filter(c => this.players[c.playerIdx].isHuman);
    if (humanCalls.length > 0) {
      this.pendingAiDecisions = aiDecisions;
      this.availableActions = humanCalls;
      this.availableActions.push({ type: 'pass' });
      return true;
    }

    this.resolveCalls(aiDecisions);
    return false;
  },

  humanCall(callChoice) {
    const decisions = this.pendingAiDecisions || [];
    if (callChoice.type !== 'pass') {
      decisions.push({ playerIdx: 0, call: callChoice });
    } else {
      const hadRon = this.availableCalls.some(c => c.playerIdx === 0 && (c.type === 'ron' || c.type === 'ron-no-yaku' || c.type === 'ron-furiten'));
      if (hadRon) this.players[0].isTempFuriten = true;
    }
    this.pendingAiDecisions = null;
    this.resolveCalls(decisions);
  },

  resolveCalls(decisions) {
    const rons = decisions.filter(d => d.call.type === 'ron');
    const others = decisions.filter(d => d.call.type !== 'ron');

    if (rons.length > 0) {
      const ronEligibleIdxs = this.availableCalls.filter(c => c.type === 'ron').map(c => c.playerIdx);
      for (const idx of ronEligibleIdxs) {
        if (!rons.some(r => r.playerIdx === idx)) {
          this.players[idx].isTempFuriten = true;
        }
      }

      if (rons.length >= 3) {
        this.handleSanchaRon();
        return;
      }

      rons.sort((a, b) => {
        const distA = (a.playerIdx - this.lastDiscardPlayer + 4) % 4;
        const distB = (b.playerIdx - this.lastDiscardPlayer + 4) % 4;
        return distA - distB;
      });

      if (rons.length > 1) {
        for (let i = 1; i < rons.length; i++) {
          this.addSystemLog('頭跳', `${this.players[rons[i].playerIdx].name}和了無效`);
        }
      }

      for (const d of others) {
        this.addSystemLog('榮和優先', `${this.players[d.playerIdx].name}鳴牌無效`);
      }

      this.executeCall(rons[0].call);
      return;
    }

    if (others.length > 0) {
      const pri = { kan: 0, pon: 0, chi: 1 };
      others.sort((a, b) => (pri[a.call.type] ?? 99) - (pri[b.call.type] ?? 99));

      const best = others[0];
      if (best.call.type !== 'chi') {
        for (let i = 1; i < others.length; i++) {
          if (others[i].call.type === 'chi') {
            this.addSystemLog('鳴牌優先', `${this.players[others[i].playerIdx].name}鳴牌無效`);
          }
        }
      }

      this.executeCall(best.call);
      return;
    }

    const ronEligibleIdxs = this.availableCalls.filter(c => c.type === 'ron').map(c => c.playerIdx);
    for (const idx of ronEligibleIdxs) {
      this.players[idx].isTempFuriten = true;
    }
    this.advanceTurn();
  },

  executeCall(call) {
    const { type, playerIdx, tile } = call;
    const p = this.players[playerIdx];

    if (type === 'ron') {
      this.executeWin(playerIdx, 'ron', tile);
      return;
    }

    if (type === 'pon') {
      this.firstRoundActive = false;
      this.firstRoundCallsMade = true;
      this.firstDiscards = [];
      this.addLog(playerIdx, 'ポン', tile.name + ' ← ' + this.players[this.lastDiscardPlayer].name);
      let n = 2;
      const newHand = [];
      for (const t of p.hand) {
        if (n > 0 && t.key() === tile.key()) { n--; }
        else { newHand.push(t); }
      }
      p.hand = newHand;
      p.melds.push({ type:'triplet', tiles:[tile, tile, tile], open:true, from: this.lastDiscardPlayer, calledIndex:0 });
      if (this.lastDiscard) this.lastDiscard.called = true;
      this.lastDiscard = null;
      this.lastDiscardPlayer = -1;
      this.currentPlayer = playerIdx;
      this.phase = 'discard';

      for (let i = 0; i < 4; i++) {
        if (this.players[i].ippatsuRound >= 0) {
          this.players[i].ippatsuRound = -1;
        }
      }

      this._pendingCallEffect = { type: 'pon', playerIdx };
      if (this.players[playerIdx].isHuman) {
        this.availableActions = ['discard'];
        return;
      }
      const idx = this.players[playerIdx].ai.chooseDiscard(this, playerIdx);
      this.executeDiscard(playerIdx, idx);
      return;
    }

    if (type === 'chi') {
      this.firstRoundActive = false;
      this.firstRoundCallsMade = true;
      this.firstDiscards = [];
      this.addLog(playerIdx, 'チー', tile.name + ' ← ' + this.players[this.lastDiscardPlayer].name);
      const chiTileSet = call.chosenChiSet !== undefined ? call.chiSets[call.chosenChiSet] : call.chiSets[0];
      const meldTiles = chiTileSet.slice();
      const calledIndex = meldTiles.findIndex(t => t.key() === tile.key());
      const newHand = [];
      const keepKeys = {};
      for (const ct of chiTileSet) {
        if (ct.key() === tile.key()) continue;
        keepKeys[ct.key()] = (keepKeys[ct.key()] || 0) + 1;
      }
      for (const t of p.hand) {
        const k = t.key();
        if (keepKeys[k] && keepKeys[k] > 0) {
          keepKeys[k]--;
        } else {
          newHand.push(t);
        }
      }
      p.hand = newHand;
      p.melds.push({ type:'sequence', tiles:meldTiles, open:true, from: this.lastDiscardPlayer, calledIndex });
      if (this.lastDiscard) this.lastDiscard.called = true;
      this.lastDiscard = null;
      this.lastDiscardPlayer = -1;
      this.currentPlayer = playerIdx;
      this.phase = 'discard';

      for (let i = 0; i < 4; i++) {
        if (this.players[i].ippatsuRound >= 0) this.players[i].ippatsuRound = -1;
      }

      this._pendingCallEffect = { type: 'chi', playerIdx };
      if (this.players[playerIdx].isHuman) {
        this.availableActions = ['discard'];
        return;
      }
      const idx = this.players[playerIdx].ai.chooseDiscard(this, playerIdx);
      this.executeDiscard(playerIdx, idx);
      return;
    }

    if (type === 'kan' && call.isCalled) {
      this.firstRoundActive = false;
      this.firstRoundCallsMade = true;
      this.firstDiscards = [];
      this.addLog(playerIdx, 'カン', tile.name);
      const removed = [];
      let n = 3;
      const newHand = [];
      for (const t of p.hand) {
        if (n > 0 && t.key() === tile.key()) { removed.push(t); n--; }
        else { newHand.push(t); }
      }
      p.hand = newHand;
      p.melds.push({ type:'kan', tiles:[tile, tile, tile, tile], open:true, from: this.lastDiscardPlayer, calledIndex:0 });
      if (this.lastDiscard) this.lastDiscard.called = true;
      this.lastDiscard = null;
      this.lastDiscardPlayer = -1;
      this.lastActionWasKan = true;
      this.wall.addDoraIndicator();
      this.kanDeclarers.push(playerIdx);
      if (this.kanDeclarers.length >= 4 && new Set(this.kanDeclarers).size > 1) {
        this.handleSuukantsuAbort();
        return;
      }
      this.currentPlayer = playerIdx;
      for (let i = 0; i < 4; i++) {
        if (this.players[i].ippatsuRound >= 0) this.players[i].ippatsuRound = -1;
      }
      this._pendingCallEffect = { type: 'kan', playerIdx };
      this.phase = 'rinshan';
      return;
    }
  },
};
