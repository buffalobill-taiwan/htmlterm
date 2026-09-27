# Development and validation

Start with the [README local server instructions](../README.md#usage). The runtime
is static HTML/CSS/JavaScript: no bundler, npm install, or backend is needed.
Use a browser with ES modules, top-level await, and Fetch support. The commands
below run in a host terminal from the repository root, not in the demo shell.

## Local troubleshooting

| Symptom | Check |
|---|---|
| Blank page after opening index.html | Use `http://127.0.0.1:8000/`, not a file URL |
| Banner/prompt never appears | Open browser Console and Network; check module errors and the Wordle dictionary request at `js/cmd/wordle/valid-words.json` |
| 404 for modules or fonts | Start the server in the directory containing index.html |
| Old behavior after an edit | Reload with browser cache disabled while DevTools is open |
| Clipped view in a narrow window | Scaling has a minimum of 1; the base 80×25 grid may exceed the viewport |
| Wrong colors for RGB escape sequences | See the [compatibility table](architecture.md#terminal-compatibility); RGB rendering is not implemented |

The browser entry uses `js/main.js`. Importing every command in Node is not a
runtime smoke test: Wordle fetches a relative JSON URL during module evaluation.
Validate browser imports over HTTP.

## Static checks

Use a recent Node version for JavaScript syntax checking. Node 24 was used for
the September 2026 lifecycle verification; this is a known working environment,
not a promised minimum version. Browser source files use ES modules; some offline
`.js` tools use CommonJS. Do not force one module mode on the entire repository.

Check each changed JavaScript file, for example:

```sh
node --check js/cmd/CmdBase.js
node --check js/system/CmdFrame.js
git diff --check
```

For documentation changes, check relative links and heading anchors, confirm
referenced paths exist, and check complete code samples with `node --check`.
Fragments intended for class bodies are not standalone modules. Run complete
command examples through a SystemManager frame or the browser; calling `execute()`
directly bypasses cleanup registration and lifecycle behavior.

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
| Overlays/widgets | Toggle `clock` and `dvd`; drag them, open/close menu, then toggle them off | Overlay order stays stable and underlying screen content is preserved |
| Rendering | Run `ascii`, `echo --big 中文`, and `anime`; resize the browser, then cancel animation | Indexed colors, wide/enlarged glyphs and scaling remain consistent; animation releases its overlay |
| Teardown | In browser Console run `window.system.dispose(); window.term.dispose();` twice, then reload | Teardown is idempotent; reload creates a working terminal |

For an error-path change, use a temporary command that throws in `execute()` and
one whose returned Promise rejects. Both should report an error and return to a
usable shell. Remove temporary registrations after validation. For performance
work, use the [measurement procedure](rendering-performance.md#measuring-changes).

## Offline tools

These tools run outside the browser and are not demo-shell commands. Read the
linked source before changing generated assets. Examples below use placeholder
input paths; replace them with your own files.

| Tool | Dependencies | Input and output |
|---|---|---|
| [png2art.js](../tools/png2art.js) | Node; ImageMagick `convert` on PATH | PNG to a 256-color artwork ES module on stdout |
| [png2anime.js](../tools/png2anime.js) | Node; ImageMagick `convert` on PATH | Directory of `frame1.png` … `frameN.png` to an uncompressed animation module at the chosen output path |
| [subset-font.js](../tools/subset-font.js) | Node; `pyftsubset` with WOFF2 support; Unifont OTF at `/usr/share/fonts/opentype/unifont/unifont.otf` | Unicode ranges to a WOFF2 file; output path is resolved against the repository root |
| [nurikabe-solve.mjs](../tools/nurikabe-solve.mjs) | Node with ES-module support | Seed/size to generated solution, optional puzzle/debug stages/clue list on stdout |
| [nurikabe-dupcheck.py](../tools/nurikabe-dupcheck.py) | Python 3; `ortools` installed in that environment | Dimensions and clue triplets to a full second-solution search; boards on stdout, status on stderr |
| [compress-anime.js](../tools/compress-anime.js) | Node for its conversion code; currently incomplete reporting code | Reads and overwrites the fixed `js/cmd/art/anime.js` path; see limitations below |

Artwork and frame conversion:

```sh
node tools/png2art.js /path/to/image.png --name "Example" > /tmp/example-art.js
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

### Animation compressor limitations

`compress-anime.js` expects an uncompressed `frames` array, but the checked-in
animation is already compressed. It has no input/output arguments and writes to
the source asset in place. Its final gzip report also invokes an undefined `$`
tag, so plain Node execution can fail after the file has already been rewritten.
It is therefore not a ready-to-run regeneration command. Repair the reporting
step and work with a copy of an uncompressed asset before using it; review the
generated diff and playback before replacing the checked-in asset. This document
records the limitation rather than implying that conversion tooling was repaired.
