# Japanese Mahjong upstream synchronization

Upstream: <https://github.com/buffalobill-taiwan/jpmj>
Local checkout: `/home/buffalobill/playground/jpmj`.

Reviewed on 2026-09-25 against upstream HEAD
`575d60b8c0dcf2c3cc28d021ac074b2eba742e0f` (also verified against GitHub HEAD).
This is a comparison baseline, not a claim that both implementations are identical.

## Current differences

- `wall.js`: same implementation after module/formatting adaptation.
- `yaku.js`: rule logic matches this baseline; terminal exports and
  `getRankLabel` (adapted from upstream `main.js`) are local additions.
  The terminal version explicitly sets kokushi's `uraDoraHan` to zero.
- `ai_*.js`: strategy logic matches after importing the missing `34618fb`
  change in `ai_base.js`: concealed kans preserve menzen status when evaluating
  targets. Other differences are imports/exports, formatting, equivalent helper
  expressions, and the terminal's AI factory and labels.
- `tiles.js`: retains tile identity and deck logic, but replaces browser Mahjong
  glyph rendering with terminal display getters and colors.
- `game.js`: preserves terminal-specific human kan choices, delayed riichi
  discards, call-animation signals, ron tile display, and clearing consumed
  `lastDraw` references. Its AI riichi path also explicitly rejects open melds.
  Round results record score deltas; `commitRoundEnd()` applies them on Enter.
  Final riichi-stick allocation lives in the engine rather than browser UI.
- Upstream `main.js` / HTML / CSS are replaced by `JpmjCmd.js` and its input,
  loop, render, and palette modules. Result rendering and held-Tab discard
  inspection belong to this terminal UI.

Already present before this review: meld tiles in dora counting (`575d60b`),
human riichi after concealed kan (`34618fb`, game portion), corrected ura-dora
indicator positions (`346fd75`), special-hand exclusions (`0e3d600`), and the
`断么九` label (`54ae35d`).

## Updating from upstream

1. Check upstream HEAD and compare its changes against the reviewed hash above.
   Inspect local working changes before updating either checkout.
2. Port individual rule/AI changes into the corresponding ES modules. Preserve
   imports/exports and terminal display APIs; do not overwrite the directory.
3. Adapt `game.js` changes around deferred settlement and human input timing.
   Browser `main.js` changes require a separate review for relevant rule or UX
   behavior; its DOM code cannot be imported directly.
4. Run syntax checks and focused rule scenarios for the imported changes.
   Manually verify affected browser interactions, including round confirmation,
   next-round progression, cancellation, and result inspection where relevant.
5. Update this baseline and record any intentionally unported upstream changes.

## Parallel engine refactor (2026-09-25)

Both working trees now split the engine using the same filenames and method
groups. This structural change is subsequent to the upstream baseline above;
compare corresponding modules once both repositories have this refactor.

| File | Responsibility |
|---|---|
| `game.js` | Game state, getters, initialization, dealing, and logging |
| `game-turns.js` | Turn progression, drawing, discarding, and riichi |
| `game-calls.js` | Available calls, human/AI decisions, priority, chi/pon/open kan |
| `game-kans.js` | Concealed/added kans and chankan paths |
| `game-scoring.js` | Win eligibility, furiten, yaku context, and win payments |
| `game-rounds.js` | Abortive/exhaustive draws, settlement, progression, standings |

These are method groups installed on `Game.prototype`, not separate state
owners. All callers retain the same `Game` API and all mutable state stays on
the Game instance. Method descriptors remain non-enumerable, as with the
original class. Modules call other Game methods through `this`; they do not
import one another or import `Game`, avoiding dependency cycles.

The terminal entry imports the groups as ES modules with explicit tile/yaku
dependencies. The web entry keeps classic scripts: `index.html` loads the five
method groups before `game.js`, then `main.js`. Web method files use strict mode
to preserve the semantics of the original class methods.

Methods were moved without changing their bodies. In particular, the terminal
version still applies pending score deltas through `commitRoundEnd()` and its UI
starts the next round; the web version applies payments immediately and
`endRound()` starts the next round automatically. These differences now live in
`game-scoring.js` and `game-rounds.js` and must survive subsequent imports.
