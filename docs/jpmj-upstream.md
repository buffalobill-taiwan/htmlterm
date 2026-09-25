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
