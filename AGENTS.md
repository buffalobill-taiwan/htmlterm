# htmlterm — 80×25 HTML Terminal Emulator

## Goal
Pure HTML+CSS+JS 80×25 terminal emulator using Unifont monospace font, DOM `<span>` rendering.

## Project Status

Live demo: <https://buffalobill-taiwan.github.io/htmlterm/>

| Area | Status |
|---|---|
| Terminal core (Screen/Parser/Renderer) | Complete |
| Overlay compositing (widgets + dialogs) | Complete |
| Frame-stack shell + Typewriter | Complete |
| Demo commands | 22 registered (see Command Architecture) |
| Automated tests | Excluded — manual testing only |
| CI | Excluded — not planned |

Recent focus (Jun 2026): `anime` rewritten from `setInterval`+esc-seq to
rAF + buffer overlay compositing, centered like `flash --art`.
`js/util/pixel-codec.js` added — RLE+diff compression for pixel data;
tools/compress-anime.js offline script compresses frame 0 → RLE (492 vs 1800),
frames 1–123 → frame differencing (21376 vs 221400 raw entries).
Source size 523KB → 86KB (6.1×), gzip 18.5KB → 29KB.
flash refactored from CSS DOM overlay to buffer overlay
compositing (`OverlayZ.FLASH = 200`); `ARTWORKS` exported from `art.js` for reuse;
`flash --art` renders random artwork inline via same overlay pipeline.
`terminal.js` gained `markAllDirty()` proxy.
Frame stack moved from `DemoShell` to `SystemManager` (Jun 2026).
`SystemManager` became singleton, `DemoShell` absorbed as `ShellCmd` CmdBase subclass (Jun 2026).
Cmd ergonomics refactor (Jun 2026): `isTyping` → `_waitingForDrain`, `open()` method added,
`select-grid.js` moved to `js/util/`, `quiz.js` `_genQuestion()` extracted.
Directory restructure (Jun 2026): `js/` root split into `terminal/`, `system/`, `util/` subdirs.
LineEditor rewrite (Jul 2026): `_redraw()` handles multi-row wrapped lines via
`_cursorDisplayCol`/`_lastPromptRow` tracking, `\x1B[J` clear, and CUP positioning.
`Screen.cursorBack`/`cursorForward` now wrap across rows (standard terminal behavior).
System Proxy refactor (Jul 2026): `js/system/sys.js` added — Proxy-based `system` and
`term` exports replace direct `SystemManager.instance` access across all cmd files.
All 14 cmd/widget files updated; zero remaining `SystemManager.instance` references
in `js/cmd/`.
Flash extraction (Jul 2026): flash overlay logic extracted from `SystemManager` to
`js/util/flash-helper.js` — three standalone functions (`screenFlash`, `borderFlash`,
`artSequence`) take `cmd`+`term` parameters, reusable by any command without
`SystemManager` coupling. `system.js` shrunk by ~130 lines.
ConfirmDialog + Sudoku give-up (Jul 2026): `js/dialog/ConfirmDialog.js` added —
Yes/No dialog with ←→ navigation, used by `sudoku` give-up flow. Sudoku auto-check
switched from solution comparison to board-state conflict detection (`_hasConflict`).
Sudoku hint replaced with give-up (reveal full answer + Game Over).
VirtualBuffer (Jul 2026): `js/util/VirtualBuffer.js` added — compositing abstraction
for building UI layouts as nested cell buffers. `term.writeVB(vb, x, y)` blits a VB
to the screen buffer. Dialog migrated from raw `_buffer[][]` + `_writeStr()` to
VB-based layout (`this._vb`). Sudoku board/sidebar composition uses nested VBs.
Two-layer API: low-level (`writeStr`, `setCell`, `blit`, `render`) + high-level
(`centerRow`, `leftRow`, `rightRow`, `hline`, `embed`).
Tetris (Jul 2026): `js/cmd/tetris.js` added — full Tetris game with SRS rotation
system, wall kicks, T-Spin/T-Spin Mini detection, ghost piece, hold, combo,
back-to-back bonus, lock delay, line-clear flash animation, three difficulty
levels. 2×1 cell rendering via VirtualBuffer `setCell()` with colored backgrounds.
Tetris GC optimization (Jul 2026): Per-frame object allocations eliminated — static
sidebar text, board borders, pause overlay cells pre-rendered once at init into
cached cell arrays; `_renderSidebar` copies cached cells instead of calling
`writeStr()` (~200 cell objects saved per frame); score/level/lines only re-rendered
when values change; `_children` array reused via `.length = 0` instead of `= []`;
VB buffers and palettes persist across games (singleton instance reuse).

## Architecture

### Overlay compositing

Each visual layer owns its own cell buffer. Renderer blends them at render time:

```
Renderer._blendOverlays(Y):
  1. base = main buffer row Y (or scrollback)
  2. for each overlay (registration order, later wins):
       if Y in [ov.y, ov.y+ov.h):
         for c in [ov.x, ov.x+ov.w):
           cell = ov.getCell(relY, relC)
           if cell != null → blended[c] = cell
  3. per-cell: span.textContent / span.className / span.style.cssText
```

| Layer | Z | Buffer owner | Writes via |
|---|---|---|---|
| Main buffer (Screen) | 0 | Parser + shell | `term.write()` → Parser |
| Widget (TSR) | 10 | WidgetBase._buffer | `putc()` → fills own buffer |
| Dialog | 100 | Dialog._vb (VirtualBuffer) → flattened `_buffer` | `vb.writeStr()` → inline SGR→cell attrs |
| Flash (transient) | 200 | flash-helper.js | `screenFlash()` / `borderFlash()` / `artSequence()` |

No `saveArea`/`restoreArea`, no scroll region protection. Each layer is
independent; the main buffer is never touched by overlays.

### Screen / Parser / Renderer split

`js/terminal.js` was split into three files:

| File | Responsibility | Size |
|---|---|---|
| `Screen.js` | Cell buffer, cursor, scroll + SGR state, dirty tracking | pure data |
| `Parser.js` | VT100 escape state machine → delegates to Screen | no DOM |
| `Renderer.js` | Per-cell DOM grid (`cellEls[][]`), cursor element, render loop, overlay blend | DOM only |
| `terminal.js` | Thin coordinator (~100 lines) composing the three, `writeVB()` | event wiring |

All four files live in `js/terminal/`.

`Terminal` delegates public props/methods to `screen` and `renderer`:
```js
get curX() { return this.screen.curX; }
set curX(v) { this.screen.curX = v; }
markRowDirty(r) { this.screen.markRowDirty(r); }
```

### Per-cell DOM grid

`Renderer` pre-creates 80×25 `<span>` elements at init (`cellEls[row][col]`).
Each render cycle updates only `.textContent`, `.className`, and `.style.cssText`
on individual spans — no innerHTML string building, no node create/destroy.

```
_renderRow(rowIdx):
  1. dataRow = _getDataRow(rowIdx)
  2. blended = _blendOverlays(rowIdx, dataRow)
  3. for c in [0, cols):
       cell = blended[c]
       if cell.width === 0 → empty span, skip
       span.textContent = cell.ch
       span.className    = _spanClass(fg, bg, italic, ...)
       span.style.cssText = '' or clip-CSS
```

**Clip CSS** (when overlay covers half of a wide-char pair):

| Flag | Style |
|---|---|
| `_clipRight` | `display:inline-block;width:8px;overflow:hidden;vertical-align:top` |
| `_clipLeft` | `display:inline-block;width:8px;overflow:hidden;text-indent:-8px;vertical-align:top` |

`_setScale()` sets `charWidth`/`charHeight`; render uses dynamic values for clip sizes.

## Mouse event routing

`terminal.js` fires `onMouse(type, {btn, col, row, deltaY})` on mouse
down/up/move/wheel. If the callback returns `true`, no escape sequence is sent.

```
Mouse event
  → terminal._onMouseDown/Up/Move/Wheel
    → this.onMouse(type, info)          // main.js wires shell.system.handleMouse
      → shell.system.handleMouse(type, info)
        → mousedown on overlay.owner?   → startDrag (widgets + dialogs)
        → mousemove/mouseup             → moveDrag/endDrag while _dragTarget set
        → else                          → return false (terminal sends mouse escapes)
```

Dialog menu navigation is keyboard-only (`MenuDialog.handleKey`). Mouse is used
for overlay drag repositioning, not item selection.

## Shell Architecture

### System Proxy — `js/system/sys.js`

`SystemManager.instance` is no longer accessed directly from command code.
Instead, two Proxy objects (`system`, `term`) are exported from `js/system/sys.js`:

```js
export const system = new Proxy({}, {
    get(_, prop) {
        const s = instance();  // SystemManager.instance
        const v = s[prop];
        return typeof v === 'function' ? (...args) => v.apply(s, args) : v;
    }
});
```

The proxy wraps every property access with a live `SystemManager.instance` lookup,
so it works correctly regardless of initialization order. Method calls on the proxy
preserve `this` binding to `SystemManager`. All cmd files use these proxies;
`SystemManager` is no longer imported in `js/cmd/`.

`CmdBase` methods (`this.print()`, `this.readLine()`, `this.select()`, etc.) use
the proxies internally. CmdBase subclass code imports `system` or `term` directly from
`'../system/sys.js'` (or uses `this.print()`/`this.select()` for CmdBase-provided APIs).
Files outside `CmdBase` (widgets, ShellCmd, static menu helpers) also import `system` or `term`
directly from `'../system/sys.js'`.

### System Helpers — `js/system/`

Additional helper modules in `js/system/` reduce boilerplate for common command patterns.
Import them directly from their source files as needed:

| Helper | Source | API | Used by |
|---|---|---|---|
| **Abort-safe async** | `BusyAsyncHelper.js` | `createAbortGuard(getEpoch)` → guard func; `scheduleWithAbort(getEpoch, cb, ms)` → timeoutId; `createRAFGuard(getEpoch, loopFn, cleanup)` → `{start, stop}` | `sleep.js`, `flash.js` (via flash-helper) |
| **Interactive flow** | `InteractiveCommandHelper.js` | `wrapInteractiveFlow(cmd, async flowFn, opts)` — wraps `cmd.open()`/`cmd.close()` automatically | `mbti.js` |
| **Questionnaire scoring** | `QuestionnaireHelper.js` | `DimensionalAggregator({dimensions, scoringMap})` — `recordAnswer(dim, key)`, `getDominant(dim)`, `getFinalResult(dims)`, `getScores()` | `mbti.js` |
| **RAF animation** | `RAFAnimationHelper.js` | `RAFAnimationManager(cmd, opts)` — `initOverlay(getCell)`, `start(updateFn, cleanup)`; `startBufferAnimation(cmd, getCell, updateFn, opts)` → manager | `anime.js` |

**Usage rules:**
- `BusyAsyncHelper` and `RAFAnimationHelper` take a `getAbortEpoch` / `cmd` parameter to support Ctrl+C abort. Always pass `() => cmd.abortEpoch` or `this` (the command instance).
- `InteractiveCommandHelper.wrapInteractiveFlow` automatically manages the `open()`/`close()` lifecycle — the flow function can use `this.selectAsync()`, `this.readLineAsync()`, etc. without manual lifecycle calls.
- `DimensionalAggregator` supports arbitrary answer keys per dimension (not just A/B pairs), configurable weights, and tie-breaking via random selection.

### Frame stack — persistent ShellFrame

`SystemManager` owns the frame stack (`cmdStack`). A persistent `ShellFrame`
(`CmdFrame` subclass) always sits at the bottom — the stack is never empty
during normal operation. Each executing entity is a `CmdFrame` that controls
I/O while on top of the stack:

| Frame | Source | `blocked` condition | I/O owner |
|---|---|---|---|---|
| `ShellFrame` | `js/system/CmdFrame.js` | always `true` (persistent) | `ShellCmd.handleKey` → LineEditor |
| `SyncCmdFrame` | `js/system/CmdFrame.js` | typewriter active, `_busy`, `_asyncPending`, or `!cmd.closed` | typewriter / `cmd.handleKey` |
| `DialogFrame` | `js/system/CmdFrame.js` | `!dialog.closed` | dialog's `handleKey`; cursor saved on push, restored on finish |

```
ShellFrame at bottom         → always present, REPL mode
execute("help")              → push SyncCmdFrame → handler runs
                               → typewriter active → block
                               → drain → finish → pop → ShellFrame shows prompt
execute("flash")             → push SyncCmdFrame → handler sets _busy=true
                               → block on _busy → _busy=false → finish → pop → prompt
execute("flash --art")       → push SyncCmdFrame → async handler loads artwork
                               → block on _asyncPending → promise resolves
                                → block on _busy → artSequence cycle
                                → _busy=false → finish → pop → prompt
execute("art")               → push SyncCmdFrame → handler returns Promise
                               → block on _asyncPending → promise resolves
                               → typewriter active → block → drain → finish → pop → prompt
execute("menu")              → push SyncCmdFrame → handler calls createDialog
                               → push DialogFrame(menuDlg) atop SyncCmdFrame
                               → SyncCmdFrame done (buried under DialogFrame)
                               → dialog I/O until close → pop chain → ShellFrame shows prompt
SyncCmdFrame (interactive)   → cmd.select() sets cmd.closed=false
                               → frame blocks on !cmd.closed
                               → SyncCmdFrame.handleInput routes to cmd.handleKey
                               → cmd.close() → cmd.closed=true → frame unblocks → pop → prompt
```

### Execution flow

```
User input
  → terminal.js _onKeyDown → handleInput(data)
    → shell.handleInput(data)
      → system.handleInput(data)
        → top = cmdStack[last]
          → top.handleInput?          → frame handles (dialog, readLine, etc.)
          → top.blocked && Ctrl+C?    → _abortAll()
          → top.blocked?              → _queuedInput.push(data)
          → !top? && typewriter.active → _queuedInput or Ctrl+C
          → !top? && readLineState? → _handleReadLineInput
          → else                      → LineEditor.handleKey(data)
            → Enter: onExecute(line) → system.execute(line) → push SyncCmdFrame → tick
```

### Input routing priority

`handleInput` checks conditions in strict order (`system.js`):

| Priority | Condition | Handler |
|---|---|---|
| 1 | `top.handleInput` (DialogFrame / SyncCmdFrame) | `frame.handleInput(data)` → auto-unblock → pop |
| 2 | `readLineState` active | `_handleReadLineInput(data)` |
| 3 | `top.blocked` | Ctrl+C → `_abortAll()`; else queue |
| 4 | No frame + typewriter active | Ctrl+C → `_abortAll()`; else queue |
| 5 | No frame + `readLineState` active | `_handleReadLineInput(data)` |
| 6 | (normal) | `editor.handleKey(data)` |

### Output routing

| Producer | Path | Animation |
|---|---|---|
| **Cmd** (`this.print()`) | `CmdBase.print()` → `system.print()` → `Typewriter.enqueue()` | Animated (rAF; half=1, wide=2 frame credits) |
| **Dialog** (`_writeStr`) | Fills `_vb` (VirtualBuffer) → flattened `_buffer` → overlay z=100 | Instant |
| **Widget** (`putc`) | Fills `_buffer[][]` → overlay z=10 | Instant |
| **Flash** (flash-helper) | Inline getCell → overlay z=200 | Instant (stepped via setTimeout cycle) |
| **Shell prompt** (`showPrompt`) | `term.write(system.prompt)` (direct, no Typewriter) | Instant |
| **term.write()** (direct) | Bypasses Typewriter — renderer sees it next frame | Instant |

### Prompt scheduling — `_processStack`

`_processStack()` (`system.js`) is the single gate for advancing the frame
stack and showing the next prompt. Called from every completion path via
`this.tick()`:

- `onExecute` after `execute()` pushes a frame
- `onShowPrompt` from LineEditor (Ctrl+C, Ctrl+D, Ctrl+L)
- `typewriter.onDrain` when animation finishes
- async handler `.then()` after async command completes
- `readLine` Enter handler
- dialog frame auto-unblock (dialog closed)
- `_busy` release in flash

The loop pops done frames and shows the `$` prompt only when **all** of:
1. ShellFrame is top of the frame stack
2. `_pendingActivate` flag is set (ShellFrame became top after a frame pop, or `execute('')` re-armed it)
3. No typewriter animation running, no `_busy`, no `readLineState`

Condition 3's guard prevents the prompt from showing too early (e.g., during
readLine input or command output animation). If a guard blocks the prompt,
`_pendingActivate` is **NOT consumed** — it stays `true` and fires on the
next `_processStack` call when conditions clear:

```js
_processStack() {
    while (true) {
        while (top.done) { pop(); if (new top && top.persistent) top._pendingActivate = true; }
        if (stack empty) return;
        if (!frame.started) { frame.start(); continue; }
        if (frame.blocked) return;
        if (frame.persistent) {
            if (frame._pendingActivate) {
                if (typewriter || _busy || readLineState) return;  // guard — don't consume flag
                frame.onActivate();
                frame._pendingActivate = false;
            }
            return;
        }
        frame.finish();
    }
}
```

**Why this matters:** The prompt flag (`_pendingActivate`) is a one-shot bridge
between two independent state machines: the frame stack lifecycle (frames
popping) and transient shell states (readLine, typewriter, busy). By checking
all transient guards BEFORE consuming the flag, we eliminate the need for
ad-hoc re-set calls everywhere — the flag naturally persists until the shell
is actually ready for input.

**The only explicit re-arm:** `execute('')` (empty Enter at shell prompt) sets
`_pendingActivate = true` because no frame pops to trigger it naturally.

### How commands control I/O

| Need | Use | Effect |
|---|---|---|---|
| Animated output | `this.print(text)` | Enqueues via Typewriter; frame blocks on it |
| Instant output | `term.write(text)` | Bypasses Typewriter — use with care |
| Interactive input | `this.readLine(callback)` | Callback receives trimmed string; frame blocks via `readLineState` |
| **Interactive select** | `this.select()` | Calls `open()` internally; SyncCmdFrame routes keys via `cmd.handleKey` |
| Busy-wait / async | `this.holdBusy()` / `this.releaseBusy()` | Frame blocks via `_busy` until released |
| Cancel-safe async | `this.abortGeneration` | Compare on re-entry to detect Ctrl+C abort |
| Create overlay | `WidgetBase.start()` | Own buffer, composited by renderer |
| Async handler | `async execute()` | SyncCmdFrame blocks on `_asyncPending` until Promise resolves |

**Critical rules for cmd authors:**
1. Output → `this.print()`, not `term.write()`. The Typewriter animation is
   what gates the frame lifecycle. Bypassing it risks prompt timing bugs.
2. Interactive input → `this.select()` or `this.selectAsync()`. These call
   `this.open()` internally, causing `SyncCmdFrame.handleInput` to route keyboard
   events to `cmd.handleKey()`. Do NOT set `this.closed = false` directly.
3. `this.close()` sets `cmd.closed=true`, which unblocks the SyncCmdFrame and
   eventually pops it — no DialogFrame involved.
4. Dialogs and widgets are the exception to rule 1: they own cell buffers and
   render instantly via overlays (z=100 / z=10).

### Overlay lifecycle

```
WidgetBase.start():
  _buffer = createEmptyBuffer(w, h)
  _overlay = { y, x, w, h, z:10, getCell }
  term.addOverlay(_overlay)

WidgetBase.stop():
  term.removeOverlay(_overlay)
  _buffer = _overlay = null

Dialog.open():
  _initBuffer()
  _overlay = { y, x, w, h, z:100, getCell }
  term.addOverlay(_overlay)
  _drawFrame() + refreshContent()

DialogFrame (owns cursor lifecycle):
  pushDialogFrame() → frame._saveCursor() → dlg.open()
  finish()          → restore cursor from saved state → fire hooks
```

### Widget vs Dialog

Widgets and dialogs are both buffer-overlay elements:

The only architectural difference: widgets do not intercept user input. They
update purely via TSR (timers). Dialogs own the input path while open.

Both share the same overlay compositing — their cell buffers are blended over
the main terminal buffer at render time, in registration order within the same
Z level.

### SGR→cell attrs in dialogs

`js/dialog/write.js` — `_writeStr(buf, y, x, str, maxX)` parses SGR sequences inline:
- `\x1B[1m` → `cell.bold = true`
- `\x1B[36m` → `cell.fg = 6`
- `\x1B[0m` → reset to defaults
- Non-SGR chars become `_makeCell(ch, attr)` entries in `buf[y]`

Dialogs use VirtualBuffer (`this._vb`) for layout composition. `_writeStr` is called
via `vb.writeStr()`. The overlay reads a flattened copy (`this._buffer = vb.render()`).

### Custom SGR — Big mode

`js/util/sgr.js:27-28` — two nonstandard SGR parameters for large text:

| Code | Effect |
|---|---|
| `\x1B[500m` | `attr.big = true` (renders text at larger size) |
| `\x1B[501m` | `attr.big = false` |

Used by `echo --big` and other commands that support the `--big` flag to display
a heading or title in enlarged type.

## POSIX Compliance Scope

`SystemManager` + `ShellCmd` (CmdBase subclass) is a demo shell for a web-based 80×25 terminal emulator, not a
POSIX-compliant shell. The following documents which POSIX features are
intentionally excluded.

### Excluded — requires filesystem

| Feature | Reason |
|---|---|
| Redirections `>`/`<`/`>>`/`2>` | ❌ No file I/O |
| Globbing `*`/`?` | ❌ No directory listing |
| Script execution (`source`, `sh file.sh`) | ❌ No file reading |
| File-reading commands (`cat`, `less`) | ❌ No filesystem |
| `PATH` external binary resolution | ❌ All commands are registered JS classes |
| fork/exec process model / job control | ❌ Web context |

### Deferred — no filesystem dependency, but low priority or architectural conflict

| Feature | Status |
|---|---|
| Pipe (`\|`) | Architectural conflict with Typewriter animation |
| `eval` builtin | Security concern (already covered by `calc`) |

### Current limitations (not ruled out)

These are recognised gaps with no filesystem dependency that remain
unaddressed:

| Gap | Notes |
|---|---|
| Automated tests | Excluded — manual browser testing only |
| Virtual `cd`/`pwd` | May add CWD string state for prompt/UX — no filesystem needed |
| Command history search | LineEditor has up/down history only, no incremental search |
| Tab completion | Command names only; no argument completion |
| Copy on select | Relies on browser/OS; no terminal-native selection model |
| Artwork pipeline | Pixel data is static ES modules in `js/cmd/art/`; `tools/png2art.js` is offline only |

## Command Architecture

```
js/cmd/
├── index.js           Barrel export — shell auto-registers all exported command classes
├── CmdBase.js         execute(args) | print(text) | readLine(cb) | select() | holdBusy/releaseBusy | cmdList
├── help.js            Help        — iterates this.cmdList (via CmdBase convenience)
├── clear.js           Clear
├── echo.js            Echo
├── date.js            DateCmd
├── cowsay.js          Cowsay
├── ascii.js           Ascii
├── ShellCmd.js        Persistent shell REPL (CmdBase subclass, not in help)
├── calc.js            Calc        — delegates to safeEval (calc-expr.js)
├── menu.js            MenuCmd     — delegates to system.menuCmd()
├── mbti.js            MbtiCmd     — interactive MBTI test (select())
├── astrology.js       AstrologyCmd — zodiac grid selection + horoscope
├── clock.js           ClockCmd    — toggle TSR clock (replaces removed widget cmd)
├── quiz.js            Quiz        — math quiz via readLine()
├── dvd.js             DvdCmd      — toggle bouncing DVD logo
├── flash.js           Flash       — screen/border/art flash; `--border`, `--art` flags; Ctrl+C abort (buffer overlay)
├── art.js             Art         — async pixel-art renderer (random artwork)
├── anime.js           Anime       — play 124-frame animation (rAF + buffer overlay, pixel-codec)
├── minesweeper.js     MinesweeperCmd — Minesweeper game with 2×1 fullwidth cells, three difficulty levels, screen-clear on start
├── sleep.js           Sleep       — wait N seconds; Ctrl+C abort
├── time.js            TimeCmd     — measure execution time of a command
├── sudoku.js          Sudoku      — play Sudoku puzzle (custom _onKey, grid rendering, auto-check, timer)
├── tetris.js          Tetris      — play Tetris (SRS rotation, wall kicks, T-Spin, ghost, hold, combo, B2B, lock delay, line-flash)
├── minesweeper.js     MinesweeperCmd — Minesweeper game (2×1 fullwidth cells, backtracking mine gen, BFS reveal, first-click safe)
├── art/               Static pixel data modules (adam, blacklotus, glaneuses, anime, …)
└── widgets/
    ├── ClockWidget.js
    └── DVDWidget.js
```

**22 registered commands:** `5willow`, `anime`, `art`, `ascii`, `astrology`, `calc`, `clear`, `clock`,
`cowsay`, `date`, `dvd`, `echo`, `flash`, `help`, `menu`,
`mbti`, `minesweeper`, `quiz`, `sleep`, `sudoku`, `tetris`, `time`

**CmdBase contract:**

| Member | Purpose |
|---|---|
| `constructor()` | No parameters — `system` / `term` proxies imported from `js/system/sys.js` |
| `execute(args)` | Command logic, called with parsed arg array |
| `print(text)` | Enqueues text to Typewriter via `system.print()` |
| `readLine(callback)` | Request next line of input; callback receives trimmed string |
| `open()` | Open cmd for interactive input — sets `closed=false`; paired with `close()` |
| `close()` | End interactive mode — sets `closed=true`, shows cursor, ticks frame stack |
| `holdBusy()` | Hold busy flag (for async/busy-wait commands like flash, sleep) |
| `releaseBusy()` | Release busy flag |
| `parseArgs(args, opts?)` | Arg parser with `opts.flags` type declarations (`Boolean`/`Number`); returns `{hasHelp, rest, flag(long, short)}` |
| `get abortGeneration()` | Monotonically increasing counter for Ctrl+C detection |
| `get cmdList()` | `system.cmdList` — registered command list for help etc. |
| `static get commandName()` | Command name string, e.g. `'cowsay'` |
| `static get help()` | Description shown in `help` output |
| `static get menu()` | Menu description or `null` to hide from menu |
| `static openMenuDialog()` | (optional) Creates a menu dialog; import `system` from `'../system/sys.js'` |

### CmdBase.select() — 2D grid selection

Grid navigation helpers extracted to `js/cmd/select-grid.js` (`defaultGridMove`,
`displayWidth`). `CmdBase` imports and uses them as defaults.

```js
select({
    text: 'Pick one:\n',           // printed via Typewriter before grid
    options: [                     // 2D array: options[row][col]
        ['A', 'B', 'C'],
        ['D', 'E'],
    ],
    move: customMove,              // optional, default = defaultGridMove
    render: customRender,          // optional, default = _defaultGridRender
    onPick: (row, col, value) => { /* called on Enter */ },
    onCancel: () => {},            // optional, default = this.close()
});
```

**Default move (`defaultGridMove`):**

| Key | Behavior |
|---|---|
| `↑` | `row > 0` → prev row, `col = min(current, prev.len-1)`; else no-op |
| `↓` | `row < rows-1` → next row, `col = min(current, next.len-1)`; else no-op |
| `←` | `col > 0` → col-1; else no-op |
| `→` | `col < cur.len-1` → col+1; else no-op |

No wrap-around, no cross-dimension movement.

**Default render (`_defaultGridRender`):**
- Column-aligned grid with `▶` + green bold for selected, `  ` for unselected
- CJK-aware column width calculation
- Re-render positions cursor via `\x1B[N-1 A` (N = row count)

**Custom move signature:** `(data, row, col, options)` → `{row, col}`
**Custom render signature:** `(selRow, selCol, options, term)` → (writes to term)

**Registration flow** (`SystemManager._registerCommands` iterates `js/cmd/index.js` exports):

```js
_registerCommands(cmdModule) {
    for (const Cls of Object.values(cmdModule)) {
        if (typeof Cls !== 'function' || !Cls.commandName) continue;
        const cmd = new Cls();
        this.commands[Cls.commandName] = cmd.execute.bind(cmd);
        this.cmdList.push({ name: Cls.commandName, help: Cls.help });
        if (Cls.menu) this.menuItems.push({ name: Cls.commandName, desc: Cls.menu });
    }
    this.cmdList.sort((a, b) => a.name.localeCompare(b.name));
    this.menuItems.sort((a, b) => a.name.localeCompare(b.name));
}
```

Non-command exports (`CmdBase`, `WidgetBase`, widget classes) are skipped because
they lack `commandName`.

### readLine — Interactive Input for Commands

Commands that need multi-line interaction (e.g. `quiz`) use `readLine`:

```
CmdBase.readLine(callback)
  → system.readLine(callback)    // sets readLineState = { editor }
  → handleInput checks readLineState (priority 2, see Shell Architecture)
  → characters accumulated in editor buffer (NOT this.line)
  → Enter: callback(_readLineBuffer.trim()), then tick()
  → Ctrl+C: cancel, showPrompt via tick()
```

**Critical rule:** `_readLineBuffer` is completely independent from `this.line`.
A cmd using `readLine` must NOT access `this.line` or `system.editor.line` — the
input arrives only through the callback parameter.

### Typewriter — animated command output

`Typewriter` uses `requestAnimationFrame` with per-frame credit budgeting
(`_speed`: half=1, wide=2 frame credits per character):

| Token | Cost | Example |
|---|---|---|
| Wide/CJK char | 2 credits | 漢字 |
| Half-width char | 1 credit | a, b, $ |
| Escape seq | instant | `\x1B[31m` |
| `seqtext` pair | sum of text credits | SGR prefix + following text batched atomically |
| Newline | 1 credit (as char) | `\n` |

- `CmdBase.print()` → `system.print()` → `Typewriter.enqueue()`
- Shell defers prompt until typewriter drain (via `tick` → `_processStack`)
- Only `Ctrl+C` passes through during animation (aborts + shows prompt)
- Dialog rendering, widget buffers, and shell prompt bypass typewriter

## Key Constraints
- DOM rendering (not Canvas)
- 80×25 viewport, auto-scaled
- When handling keyboard input in `_onKey`, **every escape sequence must be
  explicitly matched**. Unmatched sequences (Delete `\x1B[3~`, Insert `\x1B[2~`,
  Home `\x1B[H`, End `\x1B[F`, PageUp/Down `\x1B[5~`/`\x1B[6~`) fall through
  to the bare-ESC handler and cause unintended exits. Always list all expected
  sequences before the fallback `this.close()`.
- When rendering grids or box-drawing layouts via `term.write()`, **verify every
  character's display width with `isWide(ch)`** from `unicode-width.js` before
  committing column arithmetic. Box-drawing chars (U+2500–U+257F) are single-width;
  CJK/fullwidth chars are double-width. Mismatched widths cause misaligned borders.

## Design Decisions

- **CSS color classes stay static**: `.q0`-`.q255` / `.b0`-`.b255` in `style.css` are
  hand-maintained and will NOT be generated from JS at runtime. They are independent
  from the `colToHex()` algorithmic palette in Renderer.js. Do not propose generating
  these classes dynamically.

- **Native UTF-8 strings only**: All string literals in JS source use native
  UTF-8 characters (e.g. `'↑↓'`), not `\uXXXX` escape sequences. `\uXXXX`
  destroys readability and is never used.

- **No filesystem**: This project is a stateless demo terminal. There is no
  virtual filesystem, no file I/O, no script execution from disk. Features
  requiring a real or virtual filesystem (redirections `>`/`<`/`>>`, globbing
  `*`/`?`, script execution, `cat`, `PATH` for external binaries) will NOT
  be implemented. `cd`/`pwd` may still be added as purely virtual path state
  (CWD string only) for prompt/UX purposes.

## Buffer & Memory Management

The render loop runs at 60fps (rAF). Every allocation inside the hot path
(_renderRow → _blendOverlays → _spanClass → _swapInverse) compounds to
~55K cell reads/sec × 60fps = 3.3M operations/sec. Patterns below keep
the render loop near zero GC pressure.

### Reused objects in Renderer

| Object | Lifetime | Purpose |
|---|---|---|
| `_blendRow` | Permanent; grows once, never shrinks | Reused across all rows in `_blendOverlays`. Element-by-element copy (`.slice()` on first use, then direct assignment) — no `.map()` |
| `_swapFg` / `_swapBg` | Per-cell write target | `_swapInverse()` writes to these properties instead of returning `{fg, bg}` — eliminates ~3.3M small objects/sec |
| `_classParts` | Per-call, length reset to 0 | Reused array for building CSS class strings with SGR flags. Avoids per-cell `[]` + `.join()` allocation |
| `_classCache` | Permanent Map | Keyed on `fg * 256 + bg` for cells without SGR flags. ~65K entries max. Cache hit skips string concatenation + `.join()` entirely |

**Rule:** The render hot path must not allocate objects, arrays, or strings on
every cell. Reuse instance properties (`this._foo`) for per-frame scratch data.

### Cell objects — immutable after placement

Cell objects (`{ ch, fg, bg, bold, dim, italic, underline, blink, inverse,
conceal, crossedOut, width }`) are created once and never mutated after being
placed in a buffer. The Renderer reads them directly — no defensive copies.

```js
// ✗ Bad — allocates a new object per cell per frame
buffer[y][x] = { ...cellAttrs, ch: char };

// ✓ Good — create once, place reference
const cell = makeCell(char, attr, 1);
buffer[y][x] = cell;
```

Exception: `_blendOverlays` creates clip cells (`{ ...ovCell, width:1, _clipRight:true }`)
when a wide-char overlay cell covers half of a base wide-char pair. These are
unavoidable (need distinct `width`/`_clipRight` properties) but only created for
actual overlay coverage, not every cell.

### VirtualBuffer — in-place operations

| Method | Anti-pattern | Correct pattern |
|---|---|---|
| `clear()` | `this._buffer = createEmptyBuffer(w, h)` | Null cells in-place: `for row: for col: row[col] = null` — reuses row arrays |
| `render()` | `row.map(c => c ? { ...c } : null)` | `row.slice()` — shallow copy is sufficient since cells are immutable |
| `blit(dest)` | `const tmp = this.render(); ... tmp[y][x]` | Write directly to `destBuffer` — skip intermediate `render()` allocation |

**Rule:** Prefer in-place mutation of existing arrays over creating new ones.
`createEmptyBuffer()` is expensive (2,000+ cell slots for a typical dialog);
reuse the buffer and null individual cells instead.

### RAF animation — closure lifecycle

RAF animations (`startBufferAnimation`) create closures that capture local
variables from `execute()`. When the animation stops (Ctrl+C), the RAF loop
cancels, but **V8 may not immediately GC the closure chain**. Large objects
captured by these closures (e.g., pre-decoded frame arrays) can remain in
memory for seconds or until a major GC.

**Required pattern — `onCleanup` callback:**

```js
async execute(args) {
    // Large data — ~33MB for 124 pre-decoded frames
    let cellFrames = decodeAllFrames(data);

    const animation = startBufferAnimation(
        this, getCell,
        (ts, frameIdx) => { /* uses cellFrames */ },
        {
            y, x, w, h,
            frameDuration: 1000 / 30,
            onCleanup: () => { cellFrames = null; },  // ← breaks closure chain
        }
    );
}
```

Without `onCleanup`, the closure chain `RAFAnimationManager.start → loop →
updateFn → copyFrame → cellFrames` keeps the entire array alive. V8's async
Promise scope does not promptly release these references. Setting `cellFrames
= null` explicitly dereferences the data, allowing GC to reclaim it.

**Rule:** Any RAF animation command with a large data structure (frame arrays,
pixel buffers, pre-computed lookup tables) MUST null it out via `onCleanup`.

### Dirty-row tracking — per-overlay, not markAllDirty

`term.markAllDirty()` forces the Renderer to re-blend and re-render every
row — even rows no overlay touches. For overlays covering a subset of rows,
mark only the affected rows:

```js
// ✓ Good — only 34 rows re-rendered (overlay height)
for (let r = oy; r < oy + overlayH; r++) term.markRowDirty(r);

// ✗ Bad — all 25 rows re-rendered, most unchanged
term.markAllDirty();
```

**Exception:** `markAllDirty()` is correct when the entire screen changes
(e.g., after a resize, scroll, or terminal write). Use it for global state
changes, not per-overlay updates.

### Mergeable overlay buffers — no per-frame copy

When an overlay's cell buffer is modified in-place by the command (e.g.,
`WidgetBase.putc()` fills its own `_buffer`), the overlay's `getCell`
callback should return direct references to the buffer — no `.map()` or
`.slice()` per frame:

```js
// ✓ Good — getCell returns direct buffer reference
const getCell = makeOverlayGetCell(() => buffer, w, h);

// Also acceptable — arrow closure (no allocation)
const getCell = (y, x) => buffer[y][x];
```

This works because the overlay and main buffer are composited at render time
by the Renderer — the overlay never writes into the main buffer, so there is
no aliasing conflict.

## Critical Font Metrics
- core font (eascii-core): all glyphs have advance=32 units = 8px at 16px font-size
- ext font (eascii-ext): glyphs like ⏎, ✓, ✖ have advance=64 units = 16px at 16px font-size
- U+2191 (↑), U+2193 (↓) are in core at 8px — only ⏎ was problematic

## Dialog Frame & Item Positioning (buffer-based)

Dialogs render into their own `_buffer[][]` via `_writeStr()`, not `term.write()`.
Each dialog also owns a `VirtualBuffer` (`this._vb`) for layout composition; the
overlay callback reads from the flattened `_buffer` produced by `vb.render()`.

```js
_t(row, s) {  // row = 0-indexed offset from dialog.y
    _writeStr(this._buffer, row, 0, s, this.width);
}
```

**Frame width formula (for width W):**

| Element | Content | Width |
|---|---|---|
| Top/bottom border | `┌` + `─`×(W-2) + `┐` | W |
| Separator | `├` + `─`×(W-2) + `┤` | W |
| Content row | `│` + content(W-2) + `│` | W |

**Centering:** `_centerRow(row, content)` builds one string with SGR inline
and writes it via `_writeStr`:

```js
_centerRow(row, content) {
    pad = W - 2 - _bufWidth(content)
    _writeStr(buf, row, 0, '│' + spaces + content + spaces + '│', W)
}
```

**⚠️ `_centerRow` content width:** The `content` parameter's **visible width**
(measured by `_bufWidth`) must be ≤ `width - 2`. `_centerRow` adds `│` on both
sides internally. If content is too wide, the right `│` falls off the buffer
and the border silently disappears — `_writeStr` does NOT warn on overflow.

**Dialog height formula:** `_drawFrame` lays out rows as:

| Row | Content | Condition |
|---|---|---|
| 0 | `┌` + `─`×(W-2) + `┐` | always |
| 1 | title (centered) | if `this.title` |
| 2 | `├` + `─`×(W-2) + `┤` | if `this.title` |
| 3 … h-4 | content rows | filled by `_renderContent()` |
| h-3 | `├` + `─`×(W-2) + `┤` | always |
| h-2 | footer (centered) | always |
| h-1 | `└` + `─`×(W-2) + `┘` | always |

For a dialog with title and N lines of content: `h = N + 6`.
Without title: `h = N + 4`.
Footer row occupies h-2; content rows are 3 to h-4 inclusive.

**Highlight bar (inverted item):** SGR embedded directly in the string:

```js
s = '│';
if (sel) s += '\x1B[7m\x1B[1m';
s += content + ' '.repeat(pad);
if (sel) s += '\x1B[0m';
_writeStr(buf, row, 0, s, W);
```

**CJK safety:** `_bufWidth(str)` skips SGR sequences and sums cell widths
(`isWide(ch) ? 2 : 1` from `unicode-width.js`). Used for centering and cursor positioning.

**`_bufWidth` ANSI skip:** `_bufWidth` detects `[` (0x5B) as a CSI introducer
(not a terminator), so param bytes like `1`, `;`, `32`, `m` in `\x1B[1;32m`
are not counted as visible chars.

**⚠️ `_writeStr` overflow is silent:** `_writeStr(buf, y, x, str, maxX)` stops
writing when `cx >= maxX` (or when a wide char would exceed `maxX`). Characters
beyond the limit are silently dropped — no warning, no error. This means if the
string you pass is wider than `maxX`, the right side is truncated with no visual
indication. Always verify `bufWidth(str) ≤ maxX` when building strings manually.

### WidgetBase buffer

```js
this._buffer[y][x] = null  →  transparent (overlay skips this cell)
this._buffer[y][x] = cell  →  opaque (overlays main buffer)

putc(x, y, ch, fg, bg, attrs) {
    cell = { ch, fg, bg, bold, dim, italic, underline, inverse, ... }
    this._buffer[y][x] = cell;
    term.markRowDirty(this._y + y);
}
```

ClockWidget uses `putc()` to fill 8 cells with time chars (fg=7, bg from `opts.bg`, default 4):

```js
draw() {
    const time = formatTime(new Date());
    for (let i = 0; i < this._w; i++)
        this.putc(i, 0, time[i] || ' ', 7, this._bg);
}
```

## Relevant Files

### `js/terminal/` — VT100 core (no shell)

- `Screen.js`: Cell buffer, cursor, scroll/SGR state, dirty tracking, overlays[]
- `Parser.js`: VT100 escape state machine
- `Renderer.js`: Per-cell DOM grid (`cellEls[][]`), cursor element, render loop, overlay blend, `colToHex()` color palette
- `terminal.js`: Thin coordinator (~100 lines) composing Screen/Parser/Renderer, `writeVB()`

### `js/system/` — Shell system layer

- `sys.js`: `system` / `term` Proxy exports — single access point for all cmd code (replaces direct `SystemManager.instance`)
- `system.js`: SystemManager (singleton, typewriter, editor, mouse/drag, dialog positions, frame stack, execute, input routing, command registry, prompt) + WidgetManager (uses `system` proxy from `sys.js`)
- `CmdFrame.js`: Frame stack types (CmdFrame, SyncCmdFrame, DialogFrame, ShellFrame — cursor save/restore in `DialogFrame._saveCursor`/`finish`; uses `system`/`term` proxies from `sys.js`)
- `LineEditor.js`: Line editing, history, tab completion; `_redraw()` uses `_cursorDisplayCol`/`_lastPromptRow` tracking + CUP for multi-row wrapped line support
- `TextInputModel.js`: Low-level text input model (used by LineEditor + InputDialog)
- `typewriter.js`: rAF-based animated command output
- **`BusyAsyncHelper.js`**: Abort-safe setTimeout/RAF — `createAbortGuard`, `scheduleWithAbort`, `createRAFGuard`
- **`InteractiveCommandHelper.js`**: `wrapInteractiveFlow(cmd, flowFn)` — auto `open()`/`close()` lifecycle
- **`QuestionnaireHelper.js`**: `DimensionalAggregator` — multi-dimension scoring and result calculation
- **`RAFAnimationHelper.js`**: `RAFAnimationManager` + `startBufferAnimation` — RAF loop with overlay compositing

### `js/util/` — Pure utilities (no DOM, no side-effects)

- `constants.js`: Shared constants (`CHAR_WIDTH`, `CHAR_HEIGHT`, `TAB_WIDTH`, `CSI_INTRODUCER`, `DEFAULT_DIALOG_WIDTH`, `SCROLLBACK_MAX`)
- `sgr.js`: SGR helpers (`defaultAttr`, `applySGR`, `makeCell`, `makeCursorCell`, color shortcuts), `createEmptyBuffer`, `isFinalByte`, `warn`, `CURSOR_HIDE`/`CURSOR_SHOW`, `OverlayZ`, `formatTime`
- `unicode-width.js`: Font-metric `isWide(ch)` for CJK/double-width detection
- `display-width.js`: `bufWidth(str)` — measures visible string width skipping SGR sequences (used by VirtualBuffer)
- `VirtualBuffer.js`: Compositing abstraction — nested cell buffer with `writeStr`, `centerRow`, `leftRow`, `rightRow`, `hline`, `embed`, `render`, `blit`, `setCell`
- `drag.js`: Shared drag helpers used by Dialog and WidgetBase
- `tokenize.js`: Shell command tokenizer (backslash escaping, quotes)
- `calc-expr.js`: Safe recursive-descent expression evaluator (`safeEval`)
- `select-grid.js`: Grid navigation helpers (`defaultGridMove`, `displayWidth`) used by `CmdBase.select()`
- `pixel-codec.js`: RLE + frame-diff pixel codec (`decodeRLE`, `applyDiff`, `computeRLE`, `computeDiff`)
- `flash-helper.js`: Standalone buffer overlay flash utilities (`screenFlash`, `borderFlash`, `artSequence`) — reusable by any command, no `SystemManager` dependency
- `random.js`: `shuffle`, `pickRandom`, `pickRandomN` — random array utilities

### `js/dialog/`

- `index.js`: Barrel export
- `Dialog.js`: Base class, frame drawing, drag, overlay lifecycle
- `MenuDialog.js`, `InputDialog.js`, `ShowDialog.js`: Concrete dialogs
- `ConfirmDialog.js`: Yes/No confirm dialog — ←→ switch, Enter confirm, ESC cancel
- `write.js`: `_writeStr(buf, y, x, str, maxX)` — writes string with inline SGR→cell attrs; `bufWidth(str)` — measures visible width skipping SGR
- `position.js`: `centeredDialogPos(term, w, h)` — returns `{x, y}` for centering

### `js/cmd/`

- `index.js`: Barrel export for auto-registration
- `CmdBase.js`: Command base class (no constructor params — `system` / `term` proxies imported from `js/system/sys.js`)
- `ShellCmd.js`: Persistent shell REPL (CmdBase subclass)
- `WidgetBase.js`: Overlay lifecycle, `_buffer`, `putc()`
- `widgets/ClockWidget.js`: TSR clock (8 cells, 1s interval)
- `widgets/DVDWidget.js`: Bouncing DVD logo (7×3, 120ms interval)
- `art.js` + `art/*.js`: Pixel-art renderer and static artwork data; exports `ARTWORKS` for reuse by `flash --art`
- `anime.js`: 124-frame animation player (rAF + buffer overlay, pixel-codec)
- `sudoku.js`: Sudoku puzzle game (backtracking generator, grid rendering, custom `_onKey`, auto-check, timer)
- `tetris.js`: Tetris game (SRS rotation, wall kicks, T-Spin detection, ghost piece, hold, combo, B2B, lock delay, line-clear flash, 2×1 cell rendering)

## Command Development Templates

Use these templates as starting points for new commands. Register the command by adding its
export to `js/cmd/index.js` (auto-registered by `SystemManager._registerCommands`).

### Template A — Simple output command

```js
import { CmdBase } from './CmdBase.js';
import { bold, yellow } from '../util/sgr.js';

export class MyCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, {
            flags: { '--verbose': Boolean, '-v': Boolean },
        });
        if (p.hasHelp) return this.showHelp();
        this.print(bold(yellow('Hello!')) + '\n');
    }

    static get commandName() { return 'mycmd'; }
    static get help() { return 'Short description'; }
    static get menu() { return null; }       // null = hide from menu dialog
    static get usage() { return 'mycmd [--verbose]'; }
}
```

### Template B — Async command (Promise-based, e.g. data loading)

```js
import { CmdBase } from './CmdBase.js';

export class MyAsyncCmd extends CmdBase {
    async execute(args) {
        const data = await import('./data.js');
        let out = '';
        // ... build output string ...
        this.print(out);
    }

    static get commandName() { return 'myasync'; }
    static get help() { return 'Async command description'; }
    static get menu() { return null; }
}
```

### Template C — Interactive select command

```js
import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { cyan, bold } from '../util/sgr.js';

export class MyInteractiveCmd extends CmdBase {
    execute(args) {
        this.select({
            text: bold(cyan('Pick one:')) + '\n',
            options: [['Option A', 'Option B'], ['Option C']],
            onPick: (row, col, value) => {
                this.print('You picked: ' + value + '\n');
                this.close();
            },
        });
    }

    static get commandName() { return 'mypick'; }
    static get help() { return 'Interactive selection'; }
    static get menu() { return 'Pick one'; }
}
```

### Template D — Async interactive (Promise-based select, e.g. multi-step)

```js
import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { wrapInteractiveFlow } from '../system/InteractiveCommandHelper.js';
import { cyan, bold } from '../util/sgr.js';

export class MyFlowCmd extends CmdBase {
    async execute(args) {
        await wrapInteractiveFlow(this, async (cmd) => {
            const r1 = await cmd.selectAsync({
                text: bold(cyan('First question:')) + '\n',
                options: [['Yes', 'No']],
            });
            if (!r1) return;
            const r2 = await cmd.selectAsync({
                text: bold(cyan('Second question:')) + '\n',
                options: [['Red', 'Blue', 'Green']],
            });
            if (!r2) return;
            cmd.print(`You chose ${r1.value} then ${r2.value}\n`);
        });
    }

    static get commandName() { return 'myflow'; }
    static get help() { return 'Multi-step interactive flow'; }
    static get menu() { return 'Multi-step'; }
}
```

### Template E — Animation / overlay command

```js
import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { startBufferAnimation } from '../system/RAFAnimationHelper.js';
import { createEmptyBuffer, makeOverlayGetCell, makeCell, defaultAttr } from '../util/sgr.js';

export class MyAnimCmd extends CmdBase {
    async execute(args) {
        const w = 20, h = 10;
        const ox = Math.floor((term.cols - w) / 2);
        const oy = Math.floor((term.rows - h) / 2);
        const buffer = createEmptyBuffer(w, h);

        // Initialize frame 0
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++)
                buffer[y][x] = makeCell('.', defaultAttr(), 1);

        const getCell = makeOverlayGetCell(() => buffer, w, h);
        let frame = 0;

        startBufferAnimation(this, getCell, (ts, frameIdx) => {
            // Update buffer per frame
            const ch = '⣀⣤⣶⣿'[frameIdx % 4];
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++)
                    buffer[y][x] = makeCell(ch, { ...defaultAttr(), fg: frameIdx % 16 }, 1);
            frame++;
            term.markAllDirty();
            if (frame >= 60) return true;  // stop after 60 frames
        }, {
            y: oy, x: ox, w, h,
            frameDuration: 1000 / 30,  // 30fps
        });
    }

    static get commandName() { return 'myanim'; }
    static get help() { return 'Play an animation'; }
    static get menu() { return 'Animation demo'; }
}
```

### Template F — Custom key handler (cursor navigation)

For commands needing real-time cursor movement (sudoku, crossword, etc.).
Override `_onKey(data)` directly. **All escape sequences must be explicitly
matched** — unmatched sequences fall through to the default action (quit).

```js
import { term } from '../system/sys.js';
import { CmdBase } from './CmdBase.js';
import { bold, cyan, CURSOR_HIDE, CURSOR_SHOW } from '../util/sgr.js';

export class MyCursorCmd extends CmdBase {
    execute(args) {
        this.open();
        term.write(CURSOR_HIDE);
        this._render();
    }

    _onKey(data) {
        const code = typeof data === 'string' ? data.charCodeAt(0) : data;

        if (code === 0x1B) {
            const s = typeof data === 'string' ? data : '';
            if (s === '\x1B[A')  { this._move(0, -1); return; }  // ↑
            if (s === '\x1B[B')  { this._move(0,  1); return; }  // ↓
            if (s === '\x1B[D')  { this._move(-1, 0); return; }  // ←
            if (s === '\x1B[C')  { this._move(1,  0); return; }  // →
            if (s === '\x1B[3~') { /* Delete */ return; }
            if (s === '\x1B[2~') { /* Insert */ return; }
            if (s === '\x1B[H')  { /* Home   */ return; }
            if (s === '\x1B[F')  { /* End    */ return; }
            this.close();  // bare ESC → exit
            return;
        }

        if (code === 0x03) { this.close(); return; }  // Ctrl+C
        if (code === 0x08 || code === 0x7F) { /* Backspace */ return; }
        // ... handle other keys ...
    }

    _move(dx, dy) { /* update cursor, redraw */ }
    _render() { /* initial draw */ }

    static get commandName() { return 'mycursor'; }
    static get help() { return 'Cursor navigation demo'; }
    static get menu() { return null; }
}
```

**Escape sequence reference** (common keys):

| Key | Sequence | Notes |
|---|---|---|
| Arrow ↑↓←→ | `\x1B[A` `\x1B[B` `\x1B[D` `\x1B[C` | Always 3 bytes |
| Delete | `\x1B[3~` | 4 bytes |
| Insert | `\x1B[2~` | 4 bytes |
| Home | `\x1B[H` or `\x1B[1~` | Terminal-dependent |
| End | `\x1B[F` or `\x1B[4~` | Terminal-dependent |
| PageUp/Down | `\x1B[5~` `\x1B[6~` | 4 bytes |
| Backspace | `0x08` or `0x7F` | Single byte, not escape |
| Ctrl+C | `0x03` | Single byte |
| Tab | `0x09` | Single byte |

### Tools

- `tools/png2art.js`: Offline PNG → art module converter (not used at runtime)
- `tools/compress-anime.js`: Offline script to compress anime pixel data (RLE + frame-diff)