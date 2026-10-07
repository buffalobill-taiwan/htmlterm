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
- 256-color indexed rendering; RGB parsing has rendering limitations
- Mouse tracking (normal, button-events, any-event, SGR 1006)
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
- Dialog framework (`MenuDialog`, `InputDialog`, `ShowDialog`) with overlay compositing
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
opening `index.html` as a `file://` URL: the app loads ES modules and fetches the
Wordle dictionary JSON. See the [development guide](docs/development.md) for
troubleshooting and validation.

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
| `5willow` | Print 五柳先生傳 (with `--big` for enlarged text) |
| `calc` | Evaluate arithmetic expression |
| `clear` | Clear screen |
| `clock` | Toggle TSR clock widget |
| `cowsay` | Let a cow speak |
| `date` | Show current date/time |
| `dvd` | Toggle bouncing DVD logo widget |
| `echo` | Print arguments |
| `flash` | Flash the screen N times (default 1). `--border` for border flash, `--art` for random artwork flash |
| `gweled` | Play Gweled (Bejeweled match-3, space-select then arrow-swap, chain cascade, 5-7 colors) |
| `help` | Show command list; `help <cmd>` for details and usage |
| `klotski` | Play Klotski 華容道 sliding-block puzzle (11 fayaa layouts) |
| `jpmj` | Play Japanese Mahjong (14-tile riichi style, 6 AI personalities, riichi/dora/honba) |
| `memory` | Play a card-matching Memory game (flip to find matching pairs, three difficulty levels) |
| `menu` | Open command menu dialog |
| `mbti` | MBTI personality test (interactive) |
| `minesw` | Play Minesweeper (three difficulty levels, reproducible seed and first reveal) |
| `nurikabe` | Play Nurikabe logic puzzle (three difficulty levels, hold C to highlight sea) |
| `othello` | Play Othello/Reversi (8×8 board, hint dots, 3 AI difficulties) |
| `cchess` | 中國象棋：三種難度的人機對弈、先後手選擇、走棋動畫及 7 道內建殘局 |
| `puyo` | Play Puyo Puyo (column gravity, no floating puyos, chain elimination, 3-5 colors) |
| `quiz` | Math quiz challenge |
| `sleep` | Wait for N seconds (default 1) |
| `snake` | Play Snake (Nokia style) |
| `sudoku` | Play Sudoku puzzle (interactive cursor navigation, reproducible seed) |
| `tetris` | Play Tetris (SRS rotation, T-Spin, ghost piece, hold, line-clear flash) |
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
tools/              Offline converters, font subsetting, and puzzle diagnostics
```

## License

MIT
