# Command modules

Small commands remain single files under `js/cmd/`. Larger games use a directory
with an explicit `index.js` entry, following the existing Wordle and Japanese
Mahjong layout. `js/cmd/index.js` imports those entries for command registration.

## Game directories

Each directory has a `<Name>Cmd.js` class that owns the game's mutable state,
command lifecycle, input handling, timers, and dialogs. `render.js` contains its
buffer setup, palettes, drawing helpers, and rendering methods. `constants.js`
contains shared dimensions, difficulty settings, and other fixed configuration.

| Directory | Command class | Additional modules |
|---|---|---|
| [game2048](../js/cmd/game2048/index.js) | `Game2048Cmd` | `board.js`: sliding, merging, spawning, and move availability |
| [gweled](../js/cmd/gweled/index.js) | `GweledCmd` | `board.js`: matches, gravity, legal swaps, and chain scores |
| [klotski](../js/cmd/klotski/index.js) | `KlotskiCmd` | `LevelSelectDialog.js`: level chooser; level data and solutions stay in `js/util/` |
| [minesweeper](../js/cmd/minesweeper/index.js) | `MinesweeperCmd` | `solver.js`: seeded generation, first-reveal parsing, flood reveal, and logical solvability checks |
| [nurikabe](../js/cmd/nurikabe/index.js) | `NurikabeCmd` | `analysis.js`: clue groups, pools, and sea connectivity; puzzle generation stays in `js/util/nurikabe-engine.js` |
| [othello](../js/cmd/othello/index.js) | `OthelloCmd` | `board.js`: legal moves and flips; `ai.js`: evaluation and search |
| [puyo](../js/cmd/puyo/index.js) | `PuyoCmd` | `board.js`: group detection, gravity, and chain scores |
| [snake](../js/cmd/snake/index.js) | `SnakeCmd` | Movement and food placement stay with the command |
| [sudoku](../js/cmd/sudoku/index.js) | `SudokuCmd` | `solver.js`: solving, uniqueness checks, seed validation, and deterministic puzzle generation |
| [tetris](../js/cmd/tetris/index.js) | `TetrisCmd` | `board.js`: collisions, ghost landing, T-spins, and line clearing; `pieces.js`: shapes, wall kicks, and colors |

The command class installs `renderMethods` on its prototype once, at module
initialization. These methods use the same `this` as before; they do not create
another state owner. Their descriptors remain non-enumerable, writable, and
configurable, matching class methods. Buffers, palettes, and child slots retain
their existing reuse and cleanup behavior.

Import shared values directly from the module that owns them. Rendering and
rule helpers must not import their command class or its `index.js`; calls to
other command methods go through `this`. This keeps dependencies acyclic.
Only the directory entry exposes the command publicly; Othello's entry also
preserves its board/AI exports for standalone consumers.

## Sudoku generation

[solver.js](../js/cmd/sudoku/solver.js) exports `_generate(difficulty, seed)` and
`parseSeed(value)` for both the browser command and
[sudoku-solve.mjs](../tools/sudoku-solve.mjs). Generation returns
`{ board, solution, given, seed }`; an omitted seed chooses a random integer in
the supported range. Seed validation accepts decimal integers from 0 through
2147483647 and returns `null` for invalid input. The validator and seed bound
live in [random.js](../js/util/random.js), shared with Minesweeper; Sudoku retains
its existing exports for the command and offline tool.

All shuffling during generation uses a local `mulberry32(seed)` instance from
[random.js](../js/util/random.js). Nurikabe uses the same utility and retains its
existing `mulberry32` export. Do not substitute global `Math.random()` inside a
seeded generation run or duplicate the generator in the offline tool: the same
seed and difficulty must yield identical clues and answers in both environments.
Changes to the generator or random-number consumption order can change existing
seed mappings, so include reproduction checks when modifying either.

The command stores the generated seed alongside its initial board. Restart
restores that board without generating another seed; New returns to difficulty
selection and generates a random puzzle. The UI displays the seed beside the
board, including after completion. See [Sudoku seeds](../README.md#sudoku-seeds)
for command syntax and [offline tools](development.md#offline-tools) for the CLI.

## Minesweeper generation

[solver.js](../js/cmd/minesweeper/solver.js) exports
`generatePuzzle(difficulty, seed, start)` for the command and
[minesw-solve.mjs](../tools/minesw-solve.mjs). `start` is `{ row, col }`, zero-based;
omitting it selects the center. The returned object contains
`{ board, seed, start, attempts, solvable }`. Board values are `-1` for mines and
0–8 for adjacent mine counts. `parseStart(value, difficulty)` validates `row,col`
text against the selected board dimensions. `revealCells` expands a safe cell's
empty region in place, optionally preserving player flags.

The command chooses the seed at game start but defers generation until the first
unflagged reveal. The first cell and its surrounding 3×3 area are kept mine-free.
All attempts consume one local `mulberry32` stream; browser and tool must keep
the same candidate order, solvability check, and 200-attempt limit. The first
logically solved board is accepted; if none passes, the last board is returned
with `solvable: false`, preserving the original gameplay policy.

`--start` positions the initial cursor; it does not force the first reveal or
prevent movement. Record the actual first cell in the UI, since changing it can
change the board even with the same seed. New clears the previous seed/start and
stops the old timer before opening difficulty selection. See
[Minesweeper seeds](../README.md#minesweeper-seeds) for replay examples.

## Japanese Mahjong

Japanese Mahjong already separates the command, engine, AI, and palettes.
The larger input, render, and yaku modules now have their own directories:

| Entry | Modules and responsibilities |
|---|---|
| [input/index.js](../js/cmd/jpmj/input/index.js) | `keys.js`: phase and keyboard routing; `actions.js`: available actions, riichi, calls, and discards; `cursor.js`: hand indices and cursor positions; `overlays.js`: tile strips and pause overlay |
| [render/index.js](../js/cmd/jpmj/render/index.js) | `frame.js`: buffer clearing, child slots, and composition; `tiles.js`: tile writers and meld colors; `hands.js`: player/opponent hands and action bar; `discards.js`: discard grid; `panels.js`: information, results, standings, status, and tenpai display |
| [yaku/index.js](../js/cmd/jpmj/yaku/index.js) | Tile helpers, decompositions, regular yaku, yakuman, checker aggregation, scoring, and evaluation; see the [upstream map](jpmj-upstream.md#shared-yaku-module-layout) |

Input and render entries assemble their method groups into the existing
`inputMixin` and `renderMixin`. `JpmjCmd` remains the state owner. Yaku's entry
retains all previously exported names, while internal modules import each
other directly. Rule bodies, scoring, and checker order are unchanged by the
directory split.

## Validating module moves

Check every moved file's syntax and relative imports, then exercise command
startup, selection dialogs, input, cancellation, and reuse in the browser.
For rendering moves, compare the 80×25 cells and attributes before and after
using the same initial state. Preserve class-method descriptors and exported
names, and check that the dependency graph has no new cycles. Follow the
[development checklist](development.md#manual-validation) for behavioral changes.
