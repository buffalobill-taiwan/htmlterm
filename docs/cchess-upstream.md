# Chinese chess engine and endgames

The third mode, 休閒暗棋, is a local 4×8 dark-chess game in `dark.js`,
independent of the upstream engine. All 32 pieces start face down as green
`⬤` glyphs in the squares of the board's upper half. A setup dialog offers
Easy/Medium/Hard and human first/second. The first flip assigns the first
actor's color; the other actor receives the opposite color. Pieces move one square
orthogonally. Captures use king > advisor > elephant > chariot > horse > cannon
> soldier, with soldiers able to capture kings and kings unable to capture
soldiers. Cannons capture any revealed enemy over exactly one occupied square;
face-down pieces can be screens but cannot be captured. Equal ranks can capture.
No remaining pieces or no legal action loses; 80 consecutive moves without a
capture or flip draw. Easy prioritizes captures, then flips, then moves. Medium
considers an opponent reply; Hard searches one further ply. Search uses revealed
pieces only and evaluates flips as an unknown-information alternative, without
inspecting hidden identities. Every computer action blinks its source (or the
face-down piece to flip) twice, with 100ms off/on phases on a separate overlay,
before committing. `r` restores the original hidden layout and settings;
`n` reopens setup and shuffles a new game. Pending AI timers and blink overlays
are cancelled on restart and exit.
Below the dark-chess board, two fixed rows list red and black pieces in rank
order. Hidden pieces have green backgrounds; revealed pieces have normal
backgrounds. Captured pieces leave blank slots within their type's group.

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
puzzles, plus `endgame-008` (炮兵傳奇, 4 steps) and `endgame-009` (側翼總攻,
8 steps), `endgame-010` (陷陣俥傌驚, 3 steps), and `endgame-011` (前仆後繼,
7 steps), and `endgame-012` (連環計, 3 steps), and `endgame-013` (雄俥破關,
5 steps), `endgame-014` (炮對砲, 5 steps), and `endgame-015` (性命逐輕俥,
6 steps), `endgame-016` (橫行無忌, 6 steps), and `endgame-017` (三出將,
7 steps), and `endgame-018` (奮不顧身, 9 steps), and `endgame-019` (生死之進退,
7 steps), and `endgame-020` (五兵戰五卒, 8 steps), and `endgame-021` (十二連, 12 steps), and `endgame-022` (續傌再殺將, 10 steps), and `endgame-023` (眾志成城, 11 steps), and `endgame-024` (齊聚一堂, 8 steps). 側翼總攻 and 前仆後繼 had null
step counts in their source files;
their respective 8-step and 7-step minima were computed by breadth-first
traversal of the supplied response tables.
The first two puzzles were
supplied as `/tmp/傌炮兵圍城.json` and
`/tmp/雙俥夾車攻.json`.

The endgame selector uses MenuDialog scrolling with at most 10 visible puzzles
and a scrollbar. Up/Down moves the selection, PageUp/PageDown moves by one
page, and Home/End selects the first/last puzzle. Enter completes the dialog
before loading the selected puzzle; Escape returns to mode selection.

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
