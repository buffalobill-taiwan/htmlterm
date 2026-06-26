# htmlterm — 80×25 HTML Terminal Emulator

## Goal
Pure HTML+CSS+JS 80×25 terminal emulator using Unifont monospace font, DOM `<span>` rendering.

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
    → this.onMouse(type, info)
      → shell.handleMouse(type, info)
        → activeDialog.handleMouse(type, info)
          → Dialog._onMouse(type, info) — returns false by default
            → MenuDialog._onMouse: hover/click/wheel on item rows
```

## Shell Architecture

### Frame stack

`DemoShell` uses a frame stack (`_cmdStack`) instead of a flat command queue.
Each executing entity is a `CmdFrame` that controls I/O while on top of the
stack:

| Frame | Source | `blocked` condition | I/O owner |
|---|---|---|---|---|
| `SyncCmdFrame` | `js/CmdFrame.js` | typewriter active, `_busy`, `_asyncPending`, or `!cmd.closed` | typewriter / `cmd.handleKey` |
| `DialogFrame` | `js/CmdFrame.js` | `!dialog.closed` | dialog's `handleKey` |

```
Empty stack                     → editor mode, LineEditor handles input
execute("help")                 → push SyncCmdFrame → handler runs
                                  → typewriter active → block
                                  → drain → finish → pop → prompt
execute("blink")                → push SyncCmdFrame → handler sets _busy=true
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

`handleInput` checks conditions in strict order (shell.js:275):

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
| **Cmd** (`this.print()`) | `CmdBase.print()` → `shell.print()` → `Typewriter.enqueue()` | Animated (4ms half, 8ms wide) |
| **Dialog** (`_writeStr`) | Fills `_buffer[][]` → overlay z=100 | Instant |
| **Widget** (`putc`) | Fills `_buffer[][]` → overlay z=10 | Instant |
| **Shell prompt** (`showPrompt`) | `term.write(this.prompt)` (direct, no Typewriter) | Instant |
| **term.write()** (direct) | Bypasses Typewriter — renderer sees it next frame | Instant |

### Prompt scheduling — `_processStack`

`_processStack()` (shell.js:159) is the single gate for advancing the frame
stack and showing the next prompt. Called from every completion path via
`this._tick()`:

- `onExecute` after `execute()` pushes a frame
- `onShowPrompt` from LineEditor (Ctrl+C, Ctrl+D, Ctrl+L)
- `typewriter.onDrain` when animation finishes
- async handler `.then()` after async command completes
- `readLine` Enter handler
- dialog frame auto-unblock (dialog closed)
- `_busy` release in blink/smallblink

The loop pops done frames, starts new frames, and shows prompt only when the
stack is empty and all blocking conditions clear:

```js
_processStack() {
    this.promptShown = false;
    while (true) {
        while (top.done) pop();
        if (stack empty) {
            if (typewriter.active) return;  // wait for drain
            if (!_busy && !_readLinePending && !promptShown)
                this.showPrompt();
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
  if (stack) stack.push(y, h)  // cursor state save (optional)
  _drawFrame() + refreshContent()

Dialog.close():
  if (stack) stack.pop()       // cursor state restore, hooks fire
  term.removeOverlay(_overlay)
```

### SGR→cell attrs in dialogs

`_writeStr(buf, y, x, str, maxX)` parses SGR sequences inline:
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

## Changes Made This Session

### Done
- **Frame stack model (`CmdFrame.js`)**: Replaced `_cmdQueue` + `_executing` + `activeDialog` guard with a unified `_cmdStack`. `SyncCmdFrame` for synchronous/async commands, `DialogFrame` for dialogs. `_processStack()` loop handles the lifecycle (pop done → start → check blocked → finish). `handleInput()` routes via stack top. `_busy` and `_readLinePending` remain as shell-level blocking conditions checked by `SyncCmdFrame.blocked`. Fixed `_requestPrompt()` → `_tick()` in blink/smallblink. Fixed async handler race (art/mbti) via `_asyncPending` flag.
- **Prompt scheduling unified**: `_checkTypewriterDrain()` renamed to `_schedulePrompt()` with four guards (`_busy`, `activeDialog`, `_readLinePending`, `typewriter.isActive()`). `_pendingPrompt` flag removed — typewriter drain calls `_schedulePrompt()` directly. `_pendingAction` indirection eliminated — menu executes commands directly, calc/quiz open ShowDialog inline. blinks/smallblink/mbti cleanup call `_schedulePrompt()`. Single gate for all prompt timing.
- **Clock command refactored**: `clock` at shell prompt uses `ClockWidget` overlay instead of `shell.clockMode()` (CSI-based). Widget left-aligned (x=0), no background (bg=0). ClockWidget constructor accepts `opts.bg`. Ctrl+C also triggers `_clockCleanup`.
- **Menu clock uses ClockWidget**: `ClockDialog` frame renders at z=100; `ClockWidget` registered second (overlay array order → widget processes after dialog → time text wins over spaces). Dialog opens first, widget starts second. Clock centered within dialog (content width 20 − widget width 8 = offset 6), bg=0.
- **`isCovered` removed entirely**: `StateStack.isCovered()` method deleted. `ShellWidgetManager.redrawAll()` and `ClockWidget` interval no longer check `isCovered` — render order in `_blendOverlays` is the only mechanism for visual layering.
- **Overlay compositing architecture**: Widgets and dialogs now own their own cell buffers. Renderer blends them over the main buffer at render time via `_blendOverlays()` in `Renderer.js`. No more `saveArea`/`restoreArea` or scroll region protection.
- **Screen/Parser/Renderer split** (`js/terminal.js` → `Screen.js` + `Parser.js` + `Renderer.js`): Terminal data model, escape parser, and DOM renderer separated into independent files. Terminal stays as thin coordinator (~100 lines).
- **LineEditor extraction** (`js/LineEditor.js`): Shell line editing (history, tab completion, key dispatch) extracted from `shell.js` into its own class.
- **WidgetBase buffer rewrite** (`js/cmd/WidgetBase.js`): Now owns `_buffer`, `putc()`, and overlay lifecycle (`_overlay`). `start()`/`stop()` register/unregister overlay on the terminal. No more `_saveBacking`/`_restoreBacking`.
- **Dialog buffer rewrite** (`js/dialog/Dialog.js`): All rendering now fills `_buffer` via `_writeStr()` (inline SGR→cell attrs) instead of `term.write()` with CSI sequences. `open()`/`close()` manage overlay registration. StateStack simplified to cursor-only (no buffer save/restore).
- **ShellWidgetManager simplified** (`js/shell.js`): No `_setScrollTop()`, no scrollTop/scrollBottom management. Widgets register overlays independently via WidgetBase.
- **Per-cell DOM grid** (`js/Renderer.js`): Pre-creates 80×25 `<span>` elements at init (`cellEls[row][col]`). Each render cycle updates only `.textContent`/`.className`/`.style.cssText` on individual spans — no innerHTML string building, no node create/destroy. `_rowToHTML()` removed.
- **DVD bouncing logo widget** (`js/cmd/widgets/DVDWidget.js`): 7×3 color background block with black "D V D" text, 120ms interval bounce, color change on edge hit. Uses solid fill (bg = color, fg = black for letters) instead of box-drawing border.
- **Mouse routing for dialogs** (`terminal.js`/`shell.js`/`dialog.js`): `onMouse` callback on Terminal → `shell.handleMouse` → `dialog.handleMouse` → `MenuDialog._onMouse`. Supports hover (update selection), click (select item), wheel (scroll). If callback returns `true`, no escape sequence is sent.
- **Startup text** changed to `AEIOUÀÈÌÒÙ金木水火土鑫森淼焱垚あいうえおアイウエオ`
- **Quiz dialog fixes**: `const a` → `let a` (Assignment to constant variable); InputDialog cursor shows inverse space instead of duplicating last character.
- **Shared SGR module** (`js/sgr.js`): Extracted `defaultAttr()`, `applySGR()`, `makeCell()` from Screen/dialog/WidgetBase into shared file. `Screen.setSGR` loop index bug fixed (extended color params no longer corrupt attr state).
- **Terminal.dispose()**: Unregisters 11 event listeners + resize handler; stops render loop.
- **Key handler split**: `_onKeyDown` split into `_handleCopyPaste`, `_handleCtrlLetter`, `_handleFunctionKeys` (main method 121→45 lines).
- **Encapsulation**: WidgetBase `setPosition(x,y)`/`getPosition()`; drag guards (`_dragOffX === undefined`); dialog drag guards; `WidgetBase.stop()` marks rows dirty before overlay removal.
- **Clock position preserved**: `ShellWidgetManager.add()` uses `setPosition` preserving `widget._x`; DVDWidget uses `setPosition` in `_tick`.
- **LineEditor prompText**: Returns `this._prompt` instead of hardcoded `'$ '`.
- **`readLine` guard**: Warns on duplicate call before overwriting.
- **rAF resize debounce**: Replaced `setTimeout(80ms)` with `requestAnimationFrame` debounce.
- **Scrollback indicator**: ` (MORE)` overlay via `.scroll-indicator` CSS class, toggled when `viewOffset > 0`.
- **Screen.getCellAt**: Encapsulated overlay/buffer cell lookup in Screen. `_renderCursor` now calls `screen.getCellAt(curX, curY)` instead of directly accessing `screen.overlays` and `screen.buffer`.
- **Inline styles → CSS classes**: Moved redundant `container.position/top/left` (already in `#screen` CSS); scroll indicator static props moved to `.scroll-indicator` CSS, `display` toggle uses `classList.toggle('visible')`; cursor `text-align` and `font-family` moved to `#cursor` CSS; copy textarea uses `.clip-helper` class. Reduced inline style assignments from 30 to 23.
- **XTERM_COLORS removed**: Replaced 46-line array with CSS classes `.b<N>`/`.q<N>` directly — cursor colors set via `className = 'b' + fg + ' q' + bg`. No color hex lookup table or algorithmic function in JS anymore.
- **`select()` 2D options**: `select()` accepts 2D `options[row][col]` array, default `_defaultGridMove` (↑↓←→ no wrap, auto clamp col) and `_defaultGridRender` (column-aligned `▶` + green bold). `move`/`render` optional overrides. `onPick(row, col, value)`. `ask()` removed.
- **MbtiCmd/AstrologyCmd simplified**: Both use default move/render from `select()`. MbtiCmd passes `[[aText, bText]]`, AstrologyCmd passes `3×4` grid. Custom render/move removed.
- **AstrologyCmd registered**: 12-zodiac 4×3 grid selection via `select()`, seed-based fortune generation (mulberry32, dayOfYear + signIdx), 5 categories × 5 score levels × 3 descriptions.
- **Removed neofetch, uname, whoami**: Three fileless commands removed — no filesystem dependency to justify them, and their output was trivial.
- **InteractiveCmd merged into CmdBase**: All interactive methods (`select()`, `prompt()`, `open()/close()`, `handleKey()`) moved into `CmdBase`. `InteractiveCmd.js` deleted. `mbti.js`/`astrology.js` now import `CmdBase` directly.

### Removed
- `_cmdQueue`, `_executing`, `activeDialog` — replaced by `_cmdStack` / `CmdFrame`
- `saveArea()`, `restoreArea()`, `saveCursor()`, `restoreCursor()` — no longer needed
- `ask()` — unused dead code, removed
- `neofetch`, `uname`, `whoami` — three fileless commands removed
- `InteractiveCmd.js` — merged into `CmdBase.js`
- `CmdBase.open()` — replaced by `select()` auto-setting `cmd.closed=false`;
  keyboard routed via `SyncCmdFrame.handleInput()` directly, no DialogFrame needed
- `WidgetBase._saveBacking()`, `_restoreBacking()`
- `ShellWidgetManager._setScrollTop()`
- `shell.clockMode()` — replaced by ClockWidget-based ClockCmd.execute()
- `StateStack.isCovered()` — render order is the only visual layering mechanism
- `formatTime` import from `shell.js` and `dialog.js` — no longer used
- `isCovered` check from `ShellWidgetManager.redrawAll()` and `ClockWidget` interval
- `Renderer._rowToHTML()` — replaced by per-cell span rendering
- `Renderer.js` redundant `container.style.position/top/left` — already in `#screen` CSS
- `Renderer.js` scroll-indicator `style.cssText` — replaced by `.scroll-indicator` CSS class
- `Renderer.js` cursor `textAlign`/`fontFamily` inline — moved to `#cursor` CSS
- `XTERM_COLORS` array from `Screen.js` — CSS classes `.q<N>`/`.b<N>` handle all color rendering
- `colToHex()` from `Renderer.js` — cursor colors use CSS classes directly, no algorithmic lookup needed
- `Renderer.js` cursor `style.backgroundColor`/`style.color` inline — replaced by `className = 'b' + fg + ' q' + bg`
- `terminal.js` copy textarea `style.position`/`style.opacity` inline — replaced by `.clip-helper` CSS class

## Command Architecture

```
js/cmd/
├── CmdBase.js         # execute(args) | print(text) | readLine(cb) | select() | prompt() | static commandName/help/menu
├── help.js            Help      — iterates shell._cmdList dynamically
├── clear.js           Clear
├── echo.js            Echo
├── date.js            Date
├── cowsay.js          Cowsay
├── ascii.js           Ascii
├── fortune.js         Fortune
├── calc.js            Calc
├── exit.js            Exit
├── menu.js            MenuCmd   — execute delegates to shell._menuCmd()
├── mbti.js            MbtiCmd   — MBTI personality test (interactive)
├── astrology.js       AstrologyCmd — daily horoscope with zodiac grid selection
├── widget.js          WidgetCmd — toggle TSR clock
├── clock.js           ClockCmd
├── quiz.js            Quiz      — uses prompt() for math challenge
├── dvd.js             DvdCmd    — toggle bouncing DVD logo
└── widgets/
    ├── ClockWidget.js
    └── DVDWidget.js
```

**CmdBase contract:**

| Member | Purpose |
|---|---|
| `constructor(shell)` | Receives DemoShell instance; `this.term` available |
| `execute(args)` | Command logic, called with parsed arg array |
| `print(text)` | Enqueues text to shell's Typewriter |
| `readLine(callback)` | Request next line of input; callback receives trimmed string |
| `static get commandName()` | Command name string, e.g. `'fortune'` |
| `static get help()` | Description shown in `help` output |
| `static get menu()` | Menu description or `null` to hide from menu |

### CmdBase.select() — 2D grid selection

`InteractiveCmd` (merged into `CmdBase`) provides keyboard-driven selection
for commands that need interactive input (MbtiCmd, AstrologyCmd).

```js
select({
    text: 'Pick one:\n',           // printed via Typewriter before grid
    options: [                     // 2D array: options[row][col]
        ['A', 'B', 'C'],
        ['D', 'E'],
    ],
    move: customMove,              // optional, default = _defaultGridMove
    render: customRender,          // optional, default = _defaultGridRender
    onPick: (row, col, value) => { /* called on Enter */ },
    onCancel: () => {},            // optional, default = this.close()
});
```

**Default move (`_defaultGridMove`):**

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

**Registration flow:**

```js
_registerCommands() {
    const classes = [Help, Clear, Echo, ..., MenuCmd];
    for (const Cls of classes) {
        const cmd = new Cls(this);
        this.commands[name] = cmd.execute.bind(cmd);
        this._cmdList.push({ name, help });
        if (menu) this.menuItems.push({ name, desc: menu });
    }
}
```

### readLine — Interactive Input for Commands

Commands that need multi-line interaction (e.g. `quiz`) use `readLine`:

```
CmdBase.readLine(callback)
  → shell.readLine(callback)    // sets this._readLinePending + this._readLineBuffer = ''
  → handleInput checks _readLinePending (priority 3, see Shell Architecture)
  → characters accumulated in _readLineBuffer (NOT this.line)
  → Enter: callback(_readLineBuffer.trim()), then _schedulePrompt()
  → Ctrl+C: cancel, showPrompt()
```

**Critical rule:** `_readLineBuffer` is completely independent from `this.line`.
A cmd using `readLine` must NOT access `this.line` or `this.shell.line` — the
input arrives only through the callback parameter.

### Typewriter — animated command output

`Typewriter` buffers text and releases one token per tick:

| Token | Speed | Example |
|---|---|---|
| Wide/CJK | 8ms | 漢字 |
| Half-width | 4ms | a, b, $ |
| Escape seq | instant | `\x1B[31m` |
| Newline | instant | `\n` |

- `CmdBase.print()` → `shell.print()` → `Typewriter.enqueue()`
- Shell defers prompt until typewriter drain (via `_schedulePrompt`)
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
(`_isWide(ch) ? 2 : 1`). Used for centering and cursor positioning.

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

## relevant Files

- `js/Screen.js`: Cell buffer, cursor, scroll/SGR state, dirty tracking, overlays[]
- `js/sgr.js`: Shared SGR helpers (`defaultAttr`, `applySGR`, `makeCell`)
- `js/Parser.js`: VT100 escape state machine
- `js/Renderer.js`: Per-cell DOM grid (`cellEls[][]`), cursor element, render loop, overlay blend, `colToHex()` color palette
- `js/terminal.js`: Thin coordinator composing Screen/Parser/Renderer
- `js/LineEditor.js`: Line editing, history, tab completion
- `js/shell.js`: DemoShell orchestrates editor/typewriter/stateStack/dialogs/widgets
- `js/dialog/index.js`: Barrel export
- `js/dialog/Dialog.js`: Dialog base class, `_writeStr`
- `js/dialog/StateStack.js`: StateStack (nested cursor/state management)
- `js/dialog/MenuDialog.js`: Menu dialog
- `js/dialog/InputDialog.js`: Input dialog
- `js/dialog/ShowDialog.js`: Show message dialog
- `js/typewriter.js`: Animated text output
- `js/CmdFrame.js`: Frame stack types (CmdFrame, SyncCmdFrame, DialogFrame)
- `js/cmd/WidgetBase.js`: Overlay lifecycle, `_buffer`, `putc()`
- `js/cmd/widgets/ClockWidget.js`: TSR clock using `putc()`
- `js/cmd/widgets/DVDWidget.js`: Bouncing DVD logo — 7×3 color block, 120ms interval