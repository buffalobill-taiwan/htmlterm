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
| [minesweeper](../js/cmd/minesweeper/index.js) | `MinesweeperCmd` | `solver.js`: board helpers and logical solvability checks |
| [nurikabe](../js/cmd/nurikabe/index.js) | `NurikabeCmd` | `analysis.js`: clue groups, pools, and sea connectivity; puzzle generation stays in `js/util/nurikabe-engine.js` |
| [othello](../js/cmd/othello/index.js) | `OthelloCmd` | `board.js`: legal moves and flips; `ai.js`: evaluation and search |
| [puyo](../js/cmd/puyo/index.js) | `PuyoCmd` | `board.js`: group detection, gravity, and chain scores |
| [snake](../js/cmd/snake/index.js) | `SnakeCmd` | Movement and food placement stay with the command |
| [sudoku](../js/cmd/sudoku/index.js) | `SudokuCmd` | `solver.js`: solving, uniqueness checks, and puzzle generation |
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
