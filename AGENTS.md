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
| Demo commands | 18 registered (see Command Architecture) |
| Automated tests | None |
| CI | None |

Recent focus (Jun 2026): architecture refactors — frame stack model, dialog module split,
shared constants/helpers, `StateStack` merged into `DialogFrame`, CJK overlay clipping.

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
| Dialog | 100 | Dialog._buffer | `_writeStr()` → inline SGR→cell attrs |

No `saveArea`/`restoreArea`, no scroll region protection. Each layer is
independent; the main buffer is never touched by overlays.

### Screen / Parser / Renderer split

`js/terminal.js` was split into three files:

| File | Responsibility | Size |
|---|---|---|
| `Screen.js` | Cell buffer, cursor, scroll + SGR state, dirty tracking | pure data |
| `Parser.js` | VT100 escape state machine → delegates to Screen | no DOM |
| `Renderer.js` | Per-cell DOM grid (`cellEls[][]`), cursor element, render loop, overlay blend | DOM only |
| `terminal.js` | Thin coordinator (~100 lines) composing the three | event wiring |

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
    → this.onMouse(type, info)          // main.js wires shell.handleMouse
      → shell.handleMouse(type, info)
        → mousedown on overlay.owner?   → startDrag (widgets + dialogs)
        → mousemove/mouseup             → moveDrag/endDrag while _dragTarget set
        → else                          → return false (terminal sends mouse escapes)
```

Dialog menu navigation is keyboard-only (`MenuDialog.handleKey`). Mouse is used
for overlay drag repositioning, not item selection.

## Shell Architecture

### Frame stack

`DemoShell` uses a frame stack (`_cmdStack`) instead of a flat command queue.
Each executing entity is a `CmdFrame` that controls I/O while on top of the
stack:

| Frame | Source | `blocked` condition | I/O owner |
|---|---|---|---|---|
| `SyncCmdFrame` | `js/CmdFrame.js` | typewriter active, `_busy`, `_asyncPending`, or `!cmd.closed` | typewriter / `cmd.handleKey` |
| `DialogFrame` | `js/CmdFrame.js` | `!dialog.closed` | dialog's `handleKey`; cursor saved on push, restored on finish |

```
Empty stack                     → editor mode, LineEditor handles input
execute("help")                 → push SyncCmdFrame → handler runs
                                  → typewriter active → block
                                  → drain → finish → pop → prompt
execute("flash")                → push SyncCmdFrame → handler sets _busy=true
                                  → block on _busy → _busy=false → finish → prompt
execute("art")                  → push SyncCmdFrame → handler returns Promise
                                  → block on _asyncPending → promise resolves
                                  → typewriter active → block → drain → finish → prompt
execute("menu")                 → push SyncCmdFrame → handler calls _createDialog
                                  → push DialogFrame(menuDlg) atop SyncCmdFrame
                                  → SyncCmdFrame done (buried under DialogFrame)
                                  → dialog I/O until close → pop chain → prompt
SyncCmdFrame (interactive cmd)   → cmd.select() sets cmd.closed=false
                                  → frame blocks on !cmd.closed
                                  → SyncCmdFrame.handleInput routes to cmd.handleKey
                                  → cmd.close() → cmd.closed=true → frame unblocks → pop
```

### Execution flow

```
User input
  → terminal.js _onKeyDown → handleInput(data)
    → top = _cmdStack[last]
      → top.handleInput?          → frame handles (dialog, readLine, etc.)
      → top.blocked && Ctrl+C?    → _abortAll()
      → top.blocked?              → _queuedInput.push(data)
      → !top? && typewriter.active → _queuedInput or Ctrl+C
      → !top? && _readLinePending? → _handleReadLineInput
      → else                      → LineEditor.handleKey(data)
        → Enter: onExecute(line) → execute(line) → push SyncCmdFrame → _tick
```

### Input routing priority

`handleInput` checks conditions in strict order (`shell.js`):

| Priority | Condition | Handler |
|---|---|---|
| 1 | `top.handleInput` (DialogFrame / SyncCmdFrame) | `frame.handleInput(data)` → auto-unblock → pop |
| 2 | `_readLinePending` | `_handleReadLineInput(data)` |
| 3 | `top.blocked` | Ctrl+C → `_abortAll()`; else queue |
| 4 | No frame + typewriter active | Ctrl+C → `_abortAll()`; else queue |
| 5 | No frame + `_readLinePending` | `_handleReadLineInput(data)` |
| 6 | (normal) | `editor.handleKey(data)` |

### Output routing

| Producer | Path | Animation |
|---|---|---|
| **Cmd** (`this.print()`) | `CmdBase.print()` → `shell.print()` → `Typewriter.enqueue()` | Animated (rAF; half=1, wide=2 frame credits) |
| **Dialog** (`_writeStr`) | Fills `_buffer[][]` → overlay z=100 | Instant |
| **Widget** (`putc`) | Fills `_buffer[][]` → overlay z=10 | Instant |
| **Shell prompt** (`showPrompt`) | `term.write(this.prompt)` (direct, no Typewriter) | Instant |
| **term.write()** (direct) | Bypasses Typewriter — renderer sees it next frame | Instant |

### Prompt scheduling — `_processStack`

`_processStack()` (`shell.js`) is the single gate for advancing the frame
stack and showing the next prompt. Called from every completion path via
`this._tick()`:

- `onExecute` after `execute()` pushes a frame
- `onShowPrompt` from LineEditor (Ctrl+C, Ctrl+D, Ctrl+L)
- `typewriter.onDrain` when animation finishes
- async handler `.then()` after async command completes
- `readLine` Enter handler
- dialog frame auto-unblock (dialog closed)
- `_busy` release in flash

The loop pops done frames, starts new frames, and shows prompt only when the
stack is empty and all blocking conditions clear:

```js
_processStack() {
    while (true) {
        while (top.done) pop();
        if (stack empty) {
            if (typewriter.isActive()) return;  // wait for drain
            if (!_busy && !_readLinePending) this.showPrompt();
            return;
        }
        frame = top;
        if (!frame.started) { frame.start(); continue; }
        if (frame.blocked) return;
        frame.finish();  // done → loop pops it
    }
}
```

### How commands control I/O

| Need | Use | Effect |
|---|---|---|
| Animated output | `this.print(text)` | Enqueues via Typewriter; frame blocks on it |
| Instant output | `this.term.write(text)` | Bypasses Typewriter — use with care |
| Interactive input | `this.readLine(callback)` | Callback receives trimmed string; frame blocks via `_readLinePending` |
| **Interactive select** | `this.select()` | Sets `cmd.closed=false`; SyncCmdFrame routes keys via `cmd.handleKey` |
| Create overlay | `WidgetBase.start()` | Own buffer, composited by renderer |
| Async handler | `async execute()` | SyncCmdFrame blocks on `_asyncPending` until Promise resolves |

**Critical rules for cmd authors:**
1. Output → `this.print()`, not `this.term.write()`. The Typewriter animation is
   what gates the frame lifecycle. Bypassing it risks prompt timing bugs.
2. Interactive input → `this.select()` or `this.selectAsync()`. These set
   `cmd.closed=false`, causing `SyncCmdFrame.handleInput` to route keyboard
   events to `cmd.handleKey()` — no `this.open()` needed.
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

| Property | Widget (z=10) | Dialog (z=100) |
|---|---|---|
| Buffer | `WidgetBase._buffer[][]` via `putc()` | `Dialog._buffer[][]` via `_writeStr()` |
| Draggable | Yes (`startDrag`/`moveDrag`/`endDrag` on WidgetBase) | Yes (built into Dialog) |
| Position remembered | Yes — `ShellWidgetManager._savedPos` keyed by `constructor.name` | Yes — cursor saved/restored by `DialogFrame` |
| Reopen at last position | Automatic via manager | Via cursor state on `DialogFrame` |
| Input handling | None (TSR only) | Yes — `handleKey()` (keyboard); drag via overlay `owner` |
| Update mechanism | `setInterval()` / `requestAnimationFrame` (self-driven) | Event-driven (keyboard/mouse) |

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

## POSIX Compliance Scope

`DemoShell` is a demo shell for a web-based 80×25 terminal emulator, not a
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
| Automated tests | No unit/integration tests; manual browser testing only |
| Virtual `cd`/`pwd` | May add CWD string state for prompt/UX — no filesystem needed |
| Command history search | LineEditor has up/down history only, no incremental search |
| Tab completion | Command names only; no argument completion |
| Copy on select | Relies on browser/OS; no terminal-native selection model |
| Artwork pipeline | Pixel data is static ES modules in `js/cmd/art/`; `tools/png2art.js` is offline only |

## Command Architecture

```
js/cmd/
├── index.js           Barrel export — shell auto-registers all exported command classes
├── CmdBase.js         execute(args) | print(text) | readLine(cb) | select() | prompt()
├── help.js            Help        — iterates shell.cmdList dynamically
├── clear.js           Clear
├── echo.js            Echo
├── date.js            DateCmd
├── cowsay.js          Cowsay
├── ascii.js           Ascii
├── calc.js            Calc        — delegates to safeEval (calc-expr.js)
├── goodbye.js         GoodbyeCmd
├── menu.js            MenuCmd     — delegates to shell.menuCmd()
├── mbti.js            MbtiCmd     — interactive MBTI test (select())
├── astrology.js       AstrologyCmd — zodiac grid selection + horoscope
├── clock.js           ClockCmd    — toggle TSR clock (replaces removed widget cmd)
├── quiz.js            Quiz        — math quiz via readLine()
├── dvd.js             DvdCmd      — toggle bouncing DVD logo
├── flash.js           Flash       — screen/border flash; `--border` flag; Ctrl+C abort
├── art.js             Art         — async pixel-art renderer (random artwork)
├── sleep.js           Sleep       — wait N seconds; Ctrl+C abort
├── art/               Static pixel data modules (adam, blacklotus, glaneuses, …)
└── widgets/
    ├── ClockWidget.js
    └── DVDWidget.js
```

**17 registered commands:** `art`, `ascii`, `astrology`, `calc`, `clear`, `clock`,
`cowsay`, `date`, `dvd`, `echo`, `flash`, `goodbye`, `help`, `menu`,
`mbti`, `quiz`, `sleep`

**CmdBase contract:**

| Member | Purpose |
|---|---|
| `constructor(shell)` | Receives DemoShell instance; `this.term` available |
| `execute(args)` | Command logic, called with parsed arg array |
| `print(text)` | Enqueues text to shell's Typewriter |
| `readLine(callback)` | Request next line of input; callback receives trimmed string |
| `static get commandName()` | Command name string, e.g. `'cowsay'` |
| `static get help()` | Description shown in `help` output |
| `static get menu()` | Menu description or `null` to hide from menu |

### CmdBase.select() — 2D grid selection

Grid navigation helpers extracted to `js/select-grid.js` (`defaultGridMove`,
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

**Registration flow** (`shell.js` iterates `js/cmd/index.js` exports):

```js
_registerCommands() {
    for (const Cls of Object.values(cmdModule)) {
        if (typeof Cls !== 'function' || !Cls.commandName) continue;
        const cmd = new Cls(this);
        this.commands[Cls.commandName] = cmd.execute.bind(cmd);
        this.cmdList.push({ name: Cls.commandName, help: Cls.help });
        if (Cls.menu) this.menuItems.push({ name: Cls.commandName, desc: Cls.menu });
    }
}
```

Non-command exports (`CmdBase`, `WidgetBase`, widget classes) are skipped because
they lack `commandName`.

### readLine — Interactive Input for Commands

Commands that need multi-line interaction (e.g. `quiz`) use `readLine`:

```
CmdBase.readLine(callback)
  → shell.readLine(callback)    // sets this._readLinePending + this._readLineBuffer = ''
  → handleInput checks _readLinePending (priority 3, see Shell Architecture)
  → characters accumulated in _readLineBuffer (NOT this.line)
  → Enter: callback(_readLineBuffer.trim()), then _tick()
  → Ctrl+C: cancel, showPrompt()
```

**Critical rule:** `_readLineBuffer` is completely independent from `this.line`.
A cmd using `readLine` must NOT access `this.line` or `this.shell.line` — the
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

- `CmdBase.print()` → `shell.print()` → `Typewriter.enqueue()`
- Shell defers prompt until typewriter drain (via `_tick` → `_processStack`)
- Only `Ctrl+C` passes through during animation (aborts + shows prompt)
- Dialog rendering, widget buffers, and shell prompt bypass typewriter

## Key Constraints
- DOM rendering (not Canvas)
- 80×25 viewport, auto-scaled

## Design Decisions

- **CSS color classes stay static**: `.q0`-`.q255` / `.b0`-`.b255` in `style.css` are
  hand-maintained and will NOT be generated from JS at runtime. They are independent
  from the `colToHex()` algorithmic palette in Renderer.js. Do not propose generating
  these classes dynamically.

- **No filesystem**: This project is a stateless demo terminal. There is no
  virtual filesystem, no file I/O, no script execution from disk. Features
  requiring a real or virtual filesystem (redirections `>`/`<`/`>>`, globbing
  `*`/`?`, script execution, `cat`, `PATH` for external binaries) will NOT
  be implemented. `cd`/`pwd` may still be added as purely virtual path state
  (CWD string only) for prompt/UX purposes.

## Critical Font Metrics
- core font (eascii-core): all glyphs have advance=32 units = 8px at 16px font-size
- ext font (eascii-ext): glyphs like ⏎, ✓, ✖ have advance=64 units = 16px at 16px font-size
- U+2191 (↑), U+2193 (↓) are in core at 8px — only ⏎ was problematic

## Dialog Frame & Item Positioning (buffer-based)

Dialogs render into their own `_buffer[][]` via `_writeStr()`, not `term.write()`.

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

### Core terminal

- `js/constants.js`: Shared constants (`CHAR_WIDTH`, `CHAR_HEIGHT`, `TAB_WIDTH`, `CSI_INTRODUCER`, `DEFAULT_DIALOG_WIDTH`, `SCROLLBACK_MAX`)
- `js/Screen.js`: Cell buffer, cursor, scroll/SGR state, dirty tracking, overlays[]
- `js/Parser.js`: VT100 escape state machine
- `js/Renderer.js`: Per-cell DOM grid (`cellEls[][]`), cursor element, render loop, overlay blend, `colToHex()` color palette
- `js/terminal.js`: Thin coordinator composing Screen/Parser/Renderer
- `js/unicode-width.js`: Font-metric `isWide(ch)` for CJK/double-width detection

### Shared utilities

- `js/sgr.js`: SGR helpers (`defaultAttr`, `applySGR`, `makeCell`, `makeCursorCell`, color shortcuts), `createEmptyBuffer`, `isFinalByte`, `warn`, `CURSOR_HIDE`/`CURSOR_SHOW`, `OverlayZ`, `formatTime`
- `js/drag.js`: Shared drag helpers used by Dialog and WidgetBase
- `js/tokenize.js`: Shell command tokenizer (backslash escaping, quotes)
- `js/calc-expr.js`: Safe recursive-descent expression evaluator (`safeEval`)

### Shell

- `js/shell.js`: DemoShell + ShellWidgetManager — editor, typewriter, dialogs, widgets, frame stack
- `js/LineEditor.js`: Line editing, history, tab completion
- `js/typewriter.js`: rAF-based animated command output
- `js/CmdFrame.js`: Frame stack types (CmdFrame, SyncCmdFrame, DialogFrame — cursor save/restore in `DialogFrame._saveCursor`/`finish`)
- `js/select-grid.js`: Grid navigation helpers (`defaultGridMove`, `displayWidth`)

### Dialogs (`js/dialog/`)

- `index.js`: Barrel export
- `Dialog.js`: Base class, frame drawing, drag, overlay lifecycle
- `MenuDialog.js`, `InputDialog.js`, `ShowDialog.js`: Concrete dialogs
- `write.js`: `_writeStr`, `_bufWidth`, SGR→cell attrs for dialog buffers
- `position.js`: Dialog positioning helpers

### Commands (`js/cmd/`)

- `index.js`: Barrel export for auto-registration
- `CmdBase.js`: Command base class
- `WidgetBase.js`: Overlay lifecycle, `_buffer`, `putc()`
- `widgets/ClockWidget.js`: TSR clock (8 cells, 1s interval)
- `widgets/DVDWidget.js`: Bouncing DVD logo (7×3, 120ms interval)
- `art.js` + `art/*.js`: Pixel-art renderer and static artwork data

### Tools

- `tools/png2art.js`: Offline PNG → art module converter (not used at runtime)