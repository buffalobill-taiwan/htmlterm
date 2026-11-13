# HTMLTerm

[![Live Demo](https://img.shields.io/badge/demo-online-44cc11?style=flat-square)](https://buffalobill-taiwan.github.io/htmlterm/)

Live demo: <https://buffalobill-taiwan.github.io/htmlterm/>

Licensed under the [MIT License](LICENSE).

Renders entirely via DOM `<span>` elements with CSS color classes — no Canvas.
Includes a demo shell with animated command output, interactive commands, draggable
dialogs, and TSR-style widgets.

## Features

### Terminal core

- Common ANSI/VT100 escape sequences (SGR colors, cursor positioning, scroll regions)
- 16-color ANSI palette with bold brightening
- 256-color indexed rendering; 24-bit RGB is approximated to the closest palette entry
- Insert mode (IRM), scroll regions, alternate screen (1049), and robust input decoding (surrogate pairs, `DEL` ignored, `CAN`/`SUB` abort in-progress sequences)
- Mouse tracking (event types 1000/1002/1003 combinable with either X10 or SGR 1006 encoding)
- Scrollback buffer (2000 lines) with mouse wheel navigation
- IME support for Chinese/Japanese input via hidden textarea
- CJK double-width character handling (buffer + rendering + input/delete)
- `\n` treated as CR+LF for proper newline behavior
- Viewport auto-scaling (maintains 80×25 aspect ratio, adjustable on resize)
- Paste input (see the [compatibility limits](docs/architecture.md#terminal-compatibility))
- Cursor blink animation
- CRT scanline overlay

### Demo shell

- Frame-stack command runner with rAF-based Typewriter output
- Built-in commands (games, widgets, interactive tests — see below)
- Configurable dialog framework with overlay compositing: `SelectDialog`
  shares horizontal, list, and grid selection; `ConfirmDialog`, `InputDialog`,
  `ShowDialog`, `FieldPickerDialog`, `SettingsDialog`, and `InfoDialog` cover
  confirmation, input, text, forms, settings, and custom buffer content
- Selection dialogs support wraparound arrows, Home/End and paging; optional
  Tab peek temporarily hides a dialog while held (used by Japanese Mahjong).
  See [dialog configuration](docs/command-authoring.md#selection-configuration)
- VirtualBuffer compositing abstraction for nested UI layout
- TSR widgets (clock, DVD logo) — draggable, position remembered
- Tab completion for command names; command history (Up/Down)
- Long multi-line input support with proper wrapping, backspace, and cursor navigation
- `Ctrl+C` aborts running commands, typewriter animation, `sleep`, and `flash`

## Architecture

The terminal separates its cell buffer, escape parser, DOM renderer, and event
coordinator. Commands run on a frame stack; dialogs and widgets use independent
overlays. Indexed-color CSS classes are static, and rendering updates dirty rows
in the pre-created span grid.

See [architecture and compatibility](docs/architecture.md) for module ownership,
supported control sequences, and current rendering limitations.

| Task | Reference |
|---|---|
| Run locally, validate a change, or use offline tools | [Development guide](docs/development.md) |
| Locate or split command modules | [Command modules](docs/command-modules.md) |
| Update Chinese chess rules, AI, or endgames | [Chinese chess integration](docs/cchess-upstream.md) |
| Understand modules, lifecycle, and terminal compatibility | [Architecture](docs/architecture.md) |
| Add a command, dialog, or widget | [Command authoring](docs/command-authoring.md) |
| Work on rendering, animation, or character widths | [Rendering performance](docs/rendering-performance.md) |
| Update Japanese Mahjong rules or AI | [Upstream synchronization](docs/jpmj-upstream.md) |
| Understand past changes | [Project history](docs/project-history.md) |
| Check repository constraints for agent work | [Agent guide](AGENTS.md) |

## Fonts

Uses [Unifont](https://unifoundry.com/unifont/) bitmap font, subsetted into five WOFF2 files:

- **eascii-core** — Basic Latin + common symbols (8px advance)
- **eascii-ext** — Extended symbols (⏎ ✓ ✖, 16px advance)
- **ja** — Hiragana + Katakana
- **zh-common** — Common CJK
- **zh-rare** — Rare CJK

## Usage

Visit the [live demo](https://buffalobill-taiwan.github.io/htmlterm/), or run a
static HTTP server from the repository root. With Python 3 installed:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/>. You should see the HTML Term banner and a `$ `
prompt; try `help`, `echo 中文`, or `menu`. Stop the server with Ctrl+C in the
host terminal.

No build or package installation is needed to run the demo. Use HTTP rather than
opening `index.html` as a `file://` URL: the app loads ES modules, and `wordle`
fetches its dictionary JSON on first use. See the [development
guide](docs/development.md) for troubleshooting and validation.

The demo targets a desktop browser with a keyboard. Touch input, narrow/mobile
viewports, and accessibility (ARIA, screen readers, reduced motion) are out of
scope; a window narrower than the 80×25 grid clips content by design.

The shell is a stateless demo: it has no filesystem, redirection, globbing,
script execution, external binaries, or process/job control. Widget positions
are remembered only within the running application.

When embedding the terminal, tear it down in this order:

```js
system.dispose();
term.dispose();
```

`SystemManager.dispose()` must run first so active commands, dialogs, widgets,
and overlays can release their resources. Both dispose methods are safe to call
more than once.

### Commands

| Command | Description |
|---------|-------------|
| `2048` | Play 2048 puzzle (slide/merge animation, undo) |
| `anime` | Play 124-frame animation (30fps, Ctrl+C to stop) |
| `art` | Render pixel art from a random artwork |
| `ascii` | Show ANSI color chart (16-color + 256-color cube) |
| `astrology` | Today's horoscope for your zodiac sign |
| `5willow` | Print 五柳先生傳 (with `--x2`–`--x10` for enlarged text; `--big` aliases `--x2`) |
| `calc` | Evaluate arithmetic expression |
| `clear` | Clear screen |
| `clock` | Toggle TSR clock widget |
| `cowsay` | Let a cow speak |
| `date` | Show current date/time |
| `dvd` | Toggle bouncing DVD logo widget |
| `echo` | Print arguments (with leading `--x2`–`--x10` or `--big` to enlarge the next argument) |
| `flash` | Flash the screen N times (default 1). `--border` for border flash, `--art` for random artwork flash |
| `gweled` | Play Gweled (Bejeweled match-3, space-select then arrow-swap, chain cascade, 5-7 colors) |
| `help` | Show command list; `help <cmd>` for details and usage |
| `klotski` | Play Klotski 華容道 sliding-block puzzle (11 fayaa layouts) |
| `jpmj` | Play Japanese Mahjong (14-tile riichi style, 6 AI personalities, riichi/dora/honba) |
| `cardgames` | Play Blackjack, FreeCell, Texas Hold’em, Regicide, or Card Capture |
| `memory` | Play a card-matching Memory game (flip to find matching pairs, three difficulty levels) |
| `menu` | Open command menu dialog |
| `mbti` | MBTI personality test (interactive) |
| `minesw` | Play Minesweeper (three difficulty levels, reproducible seed and first reveal) |
| `nurikabe` | Play Nurikabe logic puzzle (three difficulty levels, hold C to highlight sea) |
| `othello` | Play Othello/Reversi (8×8 board, hint dots, 3 AI difficulties, pick your side) |
| `cchess` | 中國象棋：人機對弈、內建殘局、休閒暗棋及四人象棋麻將 |
| `puyo` | Play Puyo Puyo (column gravity, no floating puyos, chain elimination, 3-5 colors) |
| `quiz` | Math quiz challenge |
| `sleep` | Wait for N seconds (default 1) |
| `snake` | Play Snake (Nokia style) |
| `maze` | Play Maze (wall-blocked three-tile vision, three difficulties, reproducible seeds, completion trail) |
| `sudoku` | Play Sudoku puzzle (interactive cursor navigation, reproducible seed) |
| `tetris` | Play Tetris (SRS rotation, T-Spin, ghost piece, hold, line-clear flash, Speed 1–30 display) |
| `time` | Measure execution time of a command |
| `wordle` | Play Wordle (fullwidth grid, big-glyph keyboard, 16k guess dictionary) |

### Sudoku seeds

Run `sudoku` to choose a difficulty, or use `sudoku 123456 --hard` to reproduce
a puzzle. `sudoku --seed 123456 --hard` is equivalent. Seeds range from 0 to
2147483647; a seed without a difficulty defaults to Medium. Random games also
display their seed beside the board. The same seed **and difficulty** reproduce
the same clues and answer. `[r]estart` keeps the puzzle; `[n]ew` selects a new
difficulty and generates a fresh random seed.

From a host terminal, `node tools/sudoku-solve.mjs 123456 hard --puzzle` prints
the matching answer and original puzzle. See [offline tools](docs/development.md#offline-tools).

### Minesweeper seeds

Run `minesw 123456 --hard` or `minesw --seed 123456 --hard` for a seeded game.
Seed range and default difficulty match Sudoku. Without arguments, `minesw`
still opens the difficulty menu; `[n]ew` chooses a new random seed.

Mine placement happens on the first reveal and protects that cell and its
neighbors. Reproduction requires the same **seed, difficulty, and first revealed
cell**. The header displays the seed and actual `start` after revealing a cell.
Use `--start R,C` to position the initial cursor, with zero-based row and column,
then press Enter before moving. For example, `minesw 123456 --hard --start 0,0`
starts at the top-left corner. Without `--start`, the cursor starts in the center
(Easy: `4,4`; Medium: `6,8`; Hard: `8,16`). Moving before the first reveal changes
the generated board; placing a flag does not generate it.

From a host terminal, run
`node tools/minesw-solve.mjs 123456 hard --start 0,0 --puzzle` to print the matching
minefield and opening. Add `--mines` for a list of mine coordinates.

### Maze seeds

Run `maze` to choose Easy (20×10), Medium (40×15), or Hard (60×20), or run
`maze 123456 --hard` to reproduce a maze. `maze --seed 123456 --hard` is
equivalent. Seeds range from 0 to 2147483647; a seed alone defaults to Medium.
The same seed and difficulty reproduce the maze with the current generator.

Move from the top-left to the bottom-right with arrows or WASD. Each tile uses
two terminal columns; walls block vision within a three-tile Manhattan radius,
and a doorway beside a visible corridor end shows even around the bend.
Hard scrolls horizontally to follow the player. R resets position, steps and
visited tiles while keeping the maze and seed. N opens the difficulty picker;
confirming generates a random seed, while cancelling preserves the current game.
Q/Escape exits. Finishing reveals the maze and visited trail; use Left/Right or
A/D to inspect the completed Hard maze.

From a host terminal, `node tools/maze-solve.mjs 123456 hard --puzzle --path`
prints the solution, ordered zero-based `row,col` route and original maze.
Add `--ptt` for PTT fullwidth output. The game's position display instead uses
one-based `(x,y)` coordinates. See [Maze reproduction](docs/development.md#maze-reproduction).

### Card games

Run `cardgames` to choose Blackjack, FreeCell, Texas Hold’em, Regicide, or Card Capture. In Blackjack, arrows select Hit/Stand; Enter confirms or
starts the next round. N returns to the game menu; Q/Escape or Ctrl+C quits. Each round
uses a freshly shuffled 52-card deck. Aces count as 1 or 11; the dealer stands
on all 17s, including soft 17. Two-card Blackjack beats other 21s. There is no
betting, splitting, doubling or insurance. Session win/loss/draw counts reset
when the command is restarted. Cards occupy 5×3 cells with fullwidth ranks
except `10`; the shared renderer also supports jokers (` 〠`), unused here.

Blackjack hits and the dealer's hole-card reveal use a left-to-right flip, like
Memory (40ms per column). Dealer draws are shown one at a time. During a flip,
Hit/Stand is locked; N, Q/Escape and Ctrl+C still cancel immediately.

Card Capture also opens directly with `cardgames capture`. The solo game uses a
personal deck of all 2s, 3s, 4s and two jokers against the remaining 40 cards.
Each turn, discard any unwanted hand cards, draw up to four, then choose one
action: spend same-suit cards worth at least the selected enemy card to capture
it, let the first enemy card and one hand card be removed, or sacrifice two
non-face cards to send an enemy card to the bottom of its deck. If an Ace or
face card enters the enemy's removal pile, you lose immediately. You win by
clearing the enemy deck and row without losing. Aces are worth 14; J/Q/K are
worth 11/12/13. The first row shows all 16 enemy targets grouped by suit
(J/Q/K/A) in gray;
captured targets turn white for spades/clubs and red for hearts/diamonds.
During the discard phase, arrows select cards, Space marks discards, and Enter
continues. At the start of the action phase, Left/Right selects 捕獲, 犧牲, or
投降; unavailable actions are dark red and skipped by selection. Enter confirms.
During capture, only enemies that can be captured with the current hand show
`[ ]`; other enemies are gray and Left/Right skips them. While selecting hand
cards, off-suit non-jokers are gray and cannot be marked. Confirm with Enter.
Captured hand cards first fly into contact below, left, right, then above the
enemy card as needed; they pause together for 0.3 seconds, then fly to the
personal discard pile. Escape returns to the action choices.
If no action is available, all options darken before the ×4
GAME OVER message; Enter starts a new game. At the game-over prompt, N returns
to the menu and Q exits.
After a win, a Regicide-style settlement screen shows rounds played, capture,
sacrifice and yield counts, and the final zones of all 14 player cards. Enter
starts a new game; N returns to the menu and Q/Escape exits.
Dealing, discarding, drawing, capture, sacrifice, recycling, and enemy-row
shifts all animate the moving cards. A centered ×2「遊戲開始」banner holds for
0.5 seconds, then slides into the enemy phase. Each phase transition takes
0.5 seconds; its card animations or controls begin only after its banner settles.

Texas Hold’em opens directly with `cardgames holdem`. Play no-limit Hold’em against
five computer players: each starts with 1,000 chips, with fixed 5/10 blinds and no
rake. Arrows select Fold, Check/Call, Bet/Raise or All-in; Enter confirms. The
raise dialog takes the **total for this betting round**, including chips already
put in, and shows the legal range. Escape cancels the amount entry.
Calls, raises and folds show a Mahjong-style announcement at the acting seat
for 0.5 seconds before play continues; menu and exit keys remain available. N returns to
the game menu; Q/Escape or Ctrl+C leaves the table. No progress is saved.

The button rotates each hand. Short all-ins, reopening raises, side pots, split
pots and uncalled-bet refunds are handled automatically. Opponent cards are
hidden until showdown; folded hands stay hidden. R opens the settlement details,
and Enter starts the next hand. Busted computers automatically rebuy to 1,000
before the next deal; a busted player can rebuy or leave. The AI samples 1,000
possible deals per decision in a background worker, using only its own cards and
public information. It estimates opponents' unknown hands uniformly; it does not
model opponents or use a poker solver. If the worker fails, Enter retries and N
returns to the menu.

FreeCell can also be opened with `cardgames freecell [seed]`. Seeds are integers
0–2147483647. Deals now use the Microsoft-compatible shuffle; positive deal
numbers reproduce Microsoft layouts within this range. Seed 0 is an extension.
Existing seeds produce different boards than the previous custom generator.
Deals are not filtered for solvability (for example, Microsoft #11982 is unsolvable).
The worker and offline tool share the same generator:
`node tools/freecell-generate.mjs <seed>`.

Use arrows to move the cyan cursor and Enter to select a card or alternating,
descending suffix, then Enter at its destination. Selected cards are yellow.
Desktop mouse dragging uses the same rules. Four free cells and eight tableau
columns determine multi-card capacity; an empty destination column is excluded.
Foundations collect A through K by suit, with conservative automatic collection.
Foundation cards cannot be taken back except through undo.

Space/Escape cancels selection; U undoes a move including its automatic
collection. R replays the same initial deal; N asks for a seed (blank is random);
M returns to the menu; Q/Escape exits. Replacing a played deal asks for
confirmation; Ctrl+C exits immediately. Home/End selects the first/last card;
PageUp/PageDown navigates long columns. Scroll arrows beside each column are
clickable; dragging near the top/bottom scrolls that column. Covered cards retain
their suit and rank in a one-row header. A win remains available for undo/replay.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift++` / `Ctrl+Shift+=` | Scroll toward present |
| `Ctrl+-` | Scroll back through history |
| Mouse wheel | Scroll scrollback (3 lines per tick) |
| `Tab` | Command name completion |
| `Up` / `Down` | Command history |
| `Home` / `End` | Jump to start/end of input line |
| `Ctrl+A` / `Ctrl+E` | Jump to start/end of input line |
| `Ctrl+U` / `Ctrl+K` | Delete to start/end of input line |
| `Ctrl+W` | Delete word before cursor |
| `Ctrl+C` | Cancel input, abort command/typewriter |
| `Ctrl+D` | EOF on empty line |
| `Ctrl+L` | Clear screen and redraw prompt |

## Project layout

```text
index.html          Browser entry point
css/                Fonts, colors, grid geometry, and visual effects
js/main.js          Application startup and callback wiring
js/terminal/        Screen, parser, DOM renderer, and event coordinator
js/system/          Command registry, frames, input, Typewriter, widgets, and helpers
js/cmd/             Commands, games, command exports, and widget implementations
js/dialog/          Buffered dialog implementations
js/util/            Shared buffers, text/color/layout helpers, and game utilities
fonts/              Subsetted browser fonts
docs/               Architecture, development, authoring, and historical references
tools/              Offline converters, font subsetting, syntax/import checks, puzzle diagnostics
LICENSE             MIT license
```

## License

MIT
