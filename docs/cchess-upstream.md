# Chinese chess engine and endgames

`cchess` uses a local adaptation of the DOM-free engine from
<https://github.com/buffalobill-taiwan/cchess-endgame>, based on commit
`741f8dea8debef74b5875fc465a734cb9e7cc1e4` (2026-10-01).
The local source checkout is `/home/buffalobill/playground/cchess-endgame`.
Do not copy its SVG UI, mutable application state, or browser persistence.

The rules, board, notation, constants and Zobrist modules reside in
`js/cmd/cchess/engine/`. Pure geometry helpers are named `helpers.js` locally.
`searchRootAsync` additionally accepts `options.color` (default red) and
`options.rootMoves` (optional legal candidate list), used only at the root;
internal search moves remain unrestricted. Preserve these adaptations when
synchronizing upstream. AI runs in a disposable module worker, with maximum
depths 1/2/4 plies (Easy/Medium/Hard) and a 3,000ms search budget for all
difficulties. The final completed iteration supplies the move; if no iteration completes, use a legal
root candidate. Worker startup and move animation are outside this budget.

Match repetition is not adjudicated. AI root candidates prefer positions
(board plus next side to move) absent from the game history. If all repeat,
allow all legal moves. Human moves have no repetition restriction.

Each endgame keeps the upstream `{ meta: { name, step, init }, table }` format.
`init` and table keys/values are FEN board fields. A table key is the board
after a legal red move; its value is the board after the black response, or
null for a red win. Cyclic branches are playable. No live search substitutes
for missing or invalid entries. Both mate and stalemate count as a loss.

`js/data/cchess/index.json` contains only `{ id, name, step, file }` records.
The importer and selection list sort puzzles by ascending step count;
equal-step puzzles retain their existing relative order. The catalog currently
includes `endgame-005` (俥炮兵破關, 4 steps), `endgame-007` (炮勇致勝, 5
steps), and `endgame-006` (俥炮兵打, 6 steps), in addition to the earlier
puzzles. The first two puzzles were supplied as `/tmp/傌炮兵圍城.json` and
`/tmp/雙俥夾車攻.json`.

The command fetches the index on entering the endgame selector and fetches
individual puzzles on selection; loaded puzzles are cached for the command
execution and cleared on exit. Requests include `ENDGAME_DATA_VERSION` as a
query parameter so browsers can fetch updated index and puzzle data after a
deployment.

Generate more puzzles with upstream `tools/game-analyze.mjs`, then import:

```sh
node tools/cchess-import.mjs --output js/data/cchess /path/to/puzzle.json
```

The importer validates all reachable red alternatives and legal black responses,
including terminal markers and cycles, before writing. Existing initial
positions retain their IDs/files; new positions receive `endgame-NNN` IDs.
It preserves other indexed puzzles. No generator runs in the terminal demo.

Only computer moves blink off/on twice (100ms per phase) before moving;
player moves skip blinking, regardless of the player's color. Rooks and
non-capturing cannons advance one board intersection every
50ms; cannon captures land directly. Horses visit their leg
intersection and elephants visit their eye for 50ms, then land. Other pieces
land directly. Animation uses a separate command overlay and
reused cells/buffers; the game board is committed only after completion.
Restart, New, exit and cancellation immediately stop animation, workers and
data loading. No partially completed move is committed.
