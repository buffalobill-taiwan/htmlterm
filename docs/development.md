# Development and validation

Start with the [README local server instructions](../README.md#usage). The runtime
is static HTML/CSS/JavaScript: no bundler, npm install, or backend is needed.
Use a browser with ES modules, top-level await, and Fetch support. The commands
below run in a host terminal from the repository root, not in the demo shell.

## Scope

The demo targets a desktop browser with a keyboard and a viewport large enough
for the 80×25 grid. Mobile and accessibility work are explicitly out of scope:

- No touch/pointer input and no responsive narrow-viewport layout. A viewport
  smaller than the grid clips content; this is a known, accepted limitation
  (see the troubleshooting row below), not a defect to fix.
- No ARIA/`role` markup, screen-reader support, or focus management beyond the
  existing keyboard model.
- No `prefers-reduced-motion` handling; animations such as cursor blink,
  Typewriter output, and `flash` always run.

Treat missing behavior in these areas as intentional when reviewing or
validating changes.

## Local troubleshooting

| Symptom | Check |
|---|---|
| Blank page after opening index.html | Use `http://127.0.0.1:8000/`, not a file URL |
| Banner/prompt never appears | Open browser Console and Network; check module errors. `wordle` fetches `js/data/wordle-valid-words.json` on first use, so a missing dictionary only affects that command |
| 404 for modules or fonts | Start the server in the directory containing index.html |
| Old behavior after an edit | Reload with browser cache disabled while DevTools is open |
| Clipped view in a narrow window | Scaling has a minimum of 1; the base 80×25 grid may exceed the viewport (accepted limitation, see [Scope](#scope)) |
| Wrong colors for RGB escape sequences | See the [compatibility table](architecture.md#terminal-compatibility); RGB rendering is not implemented |

The browser entry uses `js/main.js`. Importing every command in Node is not a
runtime smoke test: `tools/import-check.mjs` only proves that modules parse,
resolve their imports, and evaluate without touching browser globals. Validate
behavior over HTTP in a browser.

## Static checks

Use a recent Node version for JavaScript syntax checking. Node 24 was used for
the September 2026 lifecycle verification; this is a known working environment,
not a promised minimum version. Browser source files use ES modules; some offline
`.js` tools use CommonJS. Do not force one module mode on the entire repository.

```sh
./tools/check-syntax.sh     # ESM parse of every js/ module and ESM tool
node tools/import-check.mjs # dynamic import: paths, syntax, module side effects
git diff --check
```

`node --check file.js` alone is not reliable in this repository: with no
`package.json`, the file is checked in CommonJS mode, which accepts a
top-level `return`. `tools/check-syntax.sh` pipes each file to
`node --input-type=module --check` instead. Check one changed file the same
way:

```sh
node --input-type=module --check < js/cmd/CmdBase.js
```

`tools/import-check.mjs` reports modules that need browser globals (`self`,
`window`, `document`) as skipped; anything else fails the run. Use it to catch
a renamed import path or a module-evaluation side effect, not as a runtime
smoke test.

For documentation changes, check relative links and heading anchors, confirm
referenced paths exist, and run complete code samples through the same ESM
check. Fragments intended for class bodies are not standalone modules. Run
complete command examples through a SystemManager frame or the browser;
calling `execute()` directly bypasses cleanup registration and lifecycle
behavior.

## Manual validation

Run the rows relevant to the change. For shell/input/rendering changes, run the
core rows together. Record the commit or working-tree changes, browser/version,
viewport, steps, expected result, and any Console errors. There is no required
automated suite or CI pipeline; focused scripts can supplement these checks.

| Area | Steps | Expected result |
|---|---|---|
| Startup and output | Reload; run `help`, `help echo`, `echo 中文` | Banner, readable output, one prompt after output completes |
| Editing and IME | Compose Chinese/Japanese; edit a line that wraps; use arrows, Home/End, Backspace and Delete | Composition is committed once; wide glyphs and cursor stay aligned |
| Completion/history | Type `sud`, press Tab; execute `echo history`, then Up/Down | Completion and history restore editable text correctly |
| Cancellation | Run `mbti`, cancel with Ctrl+C during output; run `echo ready` | Output still works and no abandoned interaction resumes |
| Busy/nested commands | Run `time sleep 5`, cancel with Ctrl+C, then `echo ready`; also allow `time sleep 1` to finish | Cancelled wait produces no delayed completion; normal run prints timing once |
| Dialogs | Run `menu`, move selection and drag it; run `jpmj`, enter a settings submenu and cancel back out | Only the top dialog receives keys; closed overlays disappear; parent remains usable |
| Game cursor | Run `minesw --easy`, move with arrows, then Escape | Cursor follows the board and shell prompt returns below the layout |
| Sudoku seeds | Run `sudoku 123456 --hard`, compare with `node tools/sudoku-solve.mjs 123456 hard --puzzle` in a host terminal; try Restart, New, seed 0, and invalid seeds | Browser/tool clues and answer match; seed is visible; Restart retains it, New generates a random puzzle; invalid seeds report an error |
| Minesweeper seeds | Run `minesw 123456 --hard --start 0,0`, press Enter, and compare with `node tools/minesw-solve.mjs 123456 hard --start 0,0 --puzzle`; try flags before revealing, New, seed 0, and invalid coordinates | Same seed/difficulty/first reveal gives the same minefield; opening is safe; seed/start remain visible; New stops the old timer and chooses a random seed |
| Overlays/widgets | Toggle `clock` and `dvd`; drag them, open/close menu, then toggle them off | Overlay order stays stable and underlying screen content is preserved |
| Rendering | Run `ascii`, `echo --big 中文`, and `anime`; resize the browser, then cancel animation | Indexed colors, wide/enlarged glyphs and scaling remain consistent; animation releases its overlay |
| Teardown | In browser Console run `window.system.dispose(); window.term.dispose();` twice, then reload | Teardown is idempotent; reload creates a working terminal |

For an error-path change, use a temporary command that throws in `execute()` and
one whose returned Promise rejects. Both should report an error and return to a
usable shell. Remove temporary registrations after validation. For performance
work, use the [measurement procedure](rendering-performance.md#measuring-changes).

## Offline tools

Chinese chess: run `cchess`, select a mode, and exercise both human colors and
all three difficulties. Use arrows and Enter to select/move; Space deselects,
`r` restarts, `n` opens difficulty/level selection, and `q` exits. Verify two
blinks before every move, 50ms rook/cannon steps, instant cannon captures,
horse-leg/elephant-eye pauses, and immediate restart/exit during animation or
AI search. Verify both bundled endgames, red wins, black wins and cycles;
inspect Network to confirm only the selected puzzle JSON loads. Details and
the offline importer are in [Chinese chess integration](cchess-upstream.md).

These tools run outside the browser and are not demo-shell commands. Read the
linked source before changing generated assets. Examples below use placeholder
input paths; replace them with your own files.

| Tool | Dependencies | Input and output |
|---|---|---|
| [png2art.js](../tools/png2art.js) | Node; ImageMagick `convert` on PATH | PNG to a 256-color artwork JSON file on stdout |
| [png2anime.js](../tools/png2anime.js) | Node; ImageMagick `convert` on PATH | Directory of `frame1.png` … `frameN.png` to an uncompressed animation module at the chosen output path |
| [subset-font.js](../tools/subset-font.js) | Node; `pyftsubset` with WOFF2 support; Unifont OTF at `/usr/share/fonts/opentype/unifont/unifont.otf` | Unicode ranges to a WOFF2 file; output path is resolved against the repository root |
| [nurikabe-solve.mjs](../tools/nurikabe-solve.mjs) | Node with ES-module support | Seed/size to generated solution, optional puzzle/debug stages/clue list on stdout |
| [sudoku-solve.mjs](../tools/sudoku-solve.mjs) | Node with ES-module support | Seed/difficulty to the live game's solution, optional original puzzle and 81-digit clue string |
| [minesw-solve.mjs](../tools/minesw-solve.mjs) | Node with ES-module support | Seed/difficulty/first reveal to the live minefield, optional opening and mine coordinate list |
| [nurikabe-dupcheck.py](../tools/nurikabe-dupcheck.py) | Python 3; `ortools` installed in that environment | Dimensions and clue triplets to a full second-solution search; boards on stdout, status on stderr |
| [compress-anime.js](../tools/compress-anime.js) | Node for its conversion code; currently incomplete reporting code | Reads and overwrites the fixed `js/cmd/art/anime.js` path; see limitations below |

Artwork and frame conversion:

```sh
node tools/png2art.js /path/to/image.png --name "Example" > /tmp/example-art.json
node tools/png2anime.js /path/to/frames /tmp/example-anime.js
```

Font subsetting (requires the source font at the hard-coded path above):

```sh
node tools/subset-font.js U+2B00-2BFF /tmp/unifont-arrows.woff2
```

`pyftsubset` comes from FontTools; WOFF2 output also needs Brotli support. The
script header describes its system font package. These are offline dependencies,
not prerequisites for using the checked-in browser fonts.

Nurikabe generation and independent checking:

```sh
node tools/nurikabe-solve.mjs 123456 8 --puzzle --clues
python3 tools/nurikabe-dupcheck.py 8 8 "0,2,3 2,2,1 2,4,1 3,6,8 5,0,6 5,3,8 5,6,6 6,4,1 7,0,1" --timeout 60
```

The second command is a standalone clue-list example. To check the generated
puzzle instead, copy the dimensions and quoted clue list from the first command's
last line. Coordinates are zero-based. The generator may retry later seeds; use
the reported shipping seed when reproducing a board. Local one-/two-swap checks
do not prove global uniqueness.

The Python checker returns 0 for UNIQUE, 1 for duplicate solutions, and 2 for no
solution, invalid usage, or an inconclusive timeout. Do not interpret timeout as
uniqueness. It requires `ortools` in the Python environment used to run it.

Sudoku reproduction (uses the same generator as the browser):

```sh
node tools/sudoku-solve.mjs 123456 hard --puzzle --clues
```

Replay in the demo with `sudoku 123456 --hard`. Difficulty defaults to `medium`
in both interfaces when only a seed is supplied. Seeds include zero and range
through 2147483647. The tool always prints the solution; `--puzzle` appends the
original clues and `--clues` appends a row-major 81-digit string, using zero for
empty cells. `--help` describes all options. Invalid arguments exit with code 1.
The tool also accepts `--easy`, `--medium`, or `--hard` instead of a positional
difficulty, for example `node tools/sudoku-solve.mjs 0 --easy --puzzle`.
Clue counts are generation targets, so preserving uniqueness can leave extra
clues, especially on Hard.

Minesweeper reproduction:

```sh
node tools/minesw-solve.mjs 123456 hard --start 0,0 --puzzle --mines
```

Replay with `minesw 123456 --hard --start 0,0`, then press Enter before moving.
Coordinates are zero-based `row,col`. Omit the difficulty for Medium; omit
`--start` for the center (Easy `4,4`, Medium `6,8`, Hard `8,16`). The first revealed
cell is part of the board identity because generation protects its neighboring
cells. Flags placed before that reveal do not affect mine placement.

The tool always prints the solution (`*` = mine, `.` = zero). `--puzzle` adds
the opening after the first reveal, using `?` for hidden cells; `--mines` adds
a final row-major list of `row,col` mine coordinates. Difficulty flags work in
place of the positional difficulty. `--help` lists options; invalid arguments
exit with code 1.

Generation preserves the game's existing limit of 200 attempts, accepting the
first board solved by its logical checker. If no attempt passes, both browser
and tool use the last board. The tool reports this fallback explicitly; printing
the minefield is not a guarantee that it can be solved without guessing.

### Animation compressor

`compress-anime.js` compresses uncompressed frames into RLE0 + diffs. It supports
`--input <file>` and `--output <file>` arguments (defaulting to inspection when
given already-compressed files like `js/data/anime.json`), calculates gzip savings
using Node's built-in zlib, and generates diffs for animation playback.
