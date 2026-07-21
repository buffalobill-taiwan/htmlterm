# Copilot Instructions for htmlterm

This document helps Copilot work effectively in the htmlterm repository (80×25 HTML terminal emulator). For detailed architecture, see [AGENTS.md](../AGENTS.md).

## Development Model

**No build, test, or lint pipeline.** This is a pure HTML+CSS+JS project with manual browser testing only. The live demo is the primary validation mechanism:

- **Demo**: <https://buffalobill-taiwan.github.io/htmlterm/>
- **Testing**: Open `index.html` in a browser; test manually
- **No CI**: Deployment is manual (commit to default branch triggers GitHub Pages rebuild)
- **No automated tests**: Excluded by design

## Project Structure

### File Organization

```
js/
├── main.js                          // Entry point: Terminal init + SystemManager setup
├── terminal/                        // VT100 core (no shell dependencies)
│   ├── Screen.js                   // Cell buffer, cursor, scrollback, SGR state, dirty tracking
│   ├── Parser.js                   // VT100 escape state machine (no DOM)
│   ├── Renderer.js                 // Pre-created 80×25 <span> grid, overlay blending, render loop
│   └── terminal.js                 // Thin coordinator composing the three (~100 lines)
├── system/                          // Shell system layer
│   ├── system.js                   // SystemManager singleton: frame stack, typewriter, editor, dialogs, widgets, prompt, command registry
│   ├── CmdFrame.js                 // Frame types: CmdFrame, SyncCmdFrame, DialogFrame, ShellFrame
│   ├── LineEditor.js               // Line editing, history, tab completion
│   ├── typewriter.js               // rAF-based animated command output
│   └── TextInputModel.js           // Low-level text model (used by LineEditor + InputDialog)
├── dialog/                          // Dialog framework
│   ├── Dialog.js                   // Base class, frame drawing, drag, overlay lifecycle
│   ├── MenuDialog.js               // Menu-style selection dialog
│   ├── InputDialog.js              // Text input dialog
│   ├── ShowDialog.js               // Read-only display dialog
│   ├── write.js                    // _writeStr(): SGR parsing → cell attributes
│   └── position.js                 // Dialog positioning helpers
├── cmd/                             // Commands + shell REPL
│   ├── index.js                    // Barrel export (auto-registration entry point)
│   ├── CmdBase.js                  // Abstract base for all commands
│   ├── ShellCmd.js                 // Persistent shell REPL (extends CmdBase)
│   ├── WidgetBase.js               // Overlay-based TSR widget base class
│   ├── [cmd].js                    // Individual command implementations
│   ├── art/                        // Static pixel art data modules
│   └── widgets/                    // TSR widgets (ClockWidget, DVDWidget)
└── util/                            // Pure utilities (no DOM, no side effects)
    ├── constants.js                // Shared constants (CHAR_WIDTH, CHAR_HEIGHT, etc.)
    ├── sgr.js                      // SGR helpers, color shortcuts, OverlayZ levels
    ├── unicode-width.js            // CJK double-width detection (isWide())
    ├── display-width.js            // bufWidth() — visible string width skipping SGR
    ├── VirtualBuffer.js            // Compositing abstraction — nested cell buffer
    ├── calc-expr.js                // Safe recursive-descent calculator
    ├── tokenize.js                 // Shell tokenizer (quotes, backslash escapes)
    ├── select-grid.js              // Grid navigation helpers for CmdBase.select()
    ├── drag.js                     // Shared drag helpers (Dialog + WidgetBase)
    ├── pixel-codec.js              // RLE + frame-diff compression (anime frames)
    ├── flash-helper.js             // Standalone flash utilities (no SystemManager dependency)
    └── random.js                   // shuffle, pickRandom, pickRandomN
```

### CSS & Fonts

- **style.css**: 480 hand-maintained color classes (`.q16`–`.q255`, `.b0`–`.b255` for indexed colors). NOT generated at runtime.
- **fonts/**: Five WOFF2 subsets of Unifont (eascii-core, eascii-ext, ja, zh-common, zh-rare)

## Architecture

### Terminal Core: Screen / Parser / Renderer Split

| Component | Responsibility |
|-----------|---|
| **Screen.js** | Cell buffer `[row][col]` with `{ch, fg, bg, bold, italic, …, width}`, cursor, scrollback, SGR state, dirty tracking. Pure data — no DOM, no I/O. |
| **Parser.js** | VT100 escape sequence state machine. Delegates actions to `screen.*` methods. No DOM, no I/O. |
| **Renderer.js** | Pre-allocated 80×25 `<span>` grid (`cellEls[][]`), cursor `<div>`, render loop via rAF, overlay compositing (`_blendOverlays`). Dirty-row optimization: only update changed rows per frame. |
| **terminal.js** | Thin ~100-line coordinator: composes Screen/Parser/Renderer, wires events (`onData`, `onMouse`, `onResize`), delegates public methods, `writeVB()`. |

**Key insight**: `Terminal` proxies most getters/setters/methods to `screen` and `renderer` to maintain a clean public API while keeping concerns separated.

### Overlay Compositing

Each visual layer owns its own cell buffer (`_buffer[][]`). At render time, `Renderer._blendOverlays()` composites them over the main buffer:

```
Renderer._blendOverlays(rowIdx):
  1. base = screen buffer row (or scrollback)
  2. for each registered overlay (z-order):
       if rowIdx in overlay bounds:
         for each cell in overlay row:
           if overlay.getCell(relY, relC) != null:
             base[col] = cell  (overwrites)
  3. span.textContent, span.className, span.style.cssText updated per cell
```

| Layer | Z Level | Owner | Buffer | Blending | Write Method |
|-------|---------|-------|--------|----------|--------------|
| Main buffer | 0 | Screen (Parser writes) | `Screen._buffer[][]` | Base layer | `term.write()` → Parser |
| Widget (TSR) | 10 | WidgetBase subclass | `_buffer[][]` | Composited over main | `putc(x, y, ch, fg, bg, …)` |
| Dialog | 100 | Dialog subclass | `_vb` (VirtualBuffer) → flattened `_buffer[][]` | Composited over main | `vb.writeStr()` (SGR parsing inline) |
| Flash | 200 | flash-helper.js | Inline `getCell()` | Highest priority | `screenFlash()`, `borderFlash()`, `artSequence()` |

**Critical**: Overlays never modify the main buffer. The main buffer is only touched by the Parser (via Screen methods). This ensures clean state separation.

### Per-Cell DOM Grid

`Renderer` pre-creates 80×25 `<span>` elements at init. Each render cycle **updates only dirty rows**, modifying `.textContent`, `.className`, and `.style.cssText` per cell:

- No `innerHTML` string building
- No node create/destroy per frame
- Dirty-row tracking avoids redundant updates
- **Clip CSS** for wide-char pairs covered by overlays: `display:inline-block; width:8px; overflow:hidden; text-indent:±8px`

### Shell System: Frame Stack & Execution Model

`SystemManager` (singleton) owns a persistent frame stack (`_cmdStack`). A `ShellFrame` always sits at the bottom — the stack is **never empty** during normal operation.

#### Frame Types

| Frame Type | Owner | Persistent | Blocked When | I/O Handler |
|-----------|-------|-----------|---|---|
| **ShellFrame** | SystemManager | ✓ Yes | Never (persistent) | LineEditor: prompt + command parsing |
| **SyncCmdFrame** | Command executing | ✗ No | Typewriter active, `_busy`, async pending, or `cmd.closed === false` | `cmd.handleKey()` for interactive cmds, or awaits command completion |
| **DialogFrame** | Dialog instance | ✗ No | Dialog still open | `dialog.handleKey()` for menu/input navigation |

#### Execution Flow

```
User types "help" + Enter
  ↓ handleInput("help") → SystemManager
    ↓ LineEditor processes command
      ↓ onExecute("help") → system.execute("help")
        ↓ push SyncCmdFrame(HelpCmd)
        ↓ _processStack(): frame not started yet → frame.start()
        ↓ HelpCmd.execute() runs → this.print(text) → Typewriter.enqueue()
        ↓ SyncCmdFrame blocked on typewriter animation
        ↓ Typewriter drains → onDrain fires → _tick() → _processStack()
        ↓ SyncCmdFrame done → pop → ShellFrame becomes top
        ↓ _processStack() sees ShellFrame._pendingActivate = true and no guards
        ↓ show prompt "$"
```

#### Prompt Scheduling: `_processStack()`

The **single gate** for advancing the frame stack and showing the next prompt. Called from:
- `onExecute()` after `execute()` pushes a frame
- `typewriter.onDrain()` when animation finishes
- async handler `.then()`
- `readLine()` Enter handler
- dialog close handler
- `_busy` release

The prompt shows **only when ALL** of these are true:
1. `ShellFrame` is top of the stack
2. `_pendingActivate` flag is set
3. No typewriter animation, no `_busy`, no `_readLineState`

If condition 3 blocks, the flag is **NOT consumed** — it persists until conditions clear. This eliminates ad-hoc re-set calls and keeps timing logic centralized.

### How Commands Control I/O

| Need | Method | Frame Blocks | Animation |
|------|--------|---|---|
| Animated output | `this.print(text)` | On typewriter | rAF-animated (half=1 credit, wide=2 credits per character) |
| Instant output | `this.term.write(text)` | No | Instant (next render frame) |
| Interactive input | `this.readLine(callback)` | On `_readLinePending` | Input appears instantly in buffer; callback receives trimmed string on Enter |
| **Interactive select** | `this.select({…})` | On `cmd.closed===false` | Calls `open()` internally; SyncCmdFrame routes keys to `cmd.handleKey()` |
| Async work | `async execute()` → Promise | On `_asyncPending` | Frame blocks until Promise resolves |
| Busy-wait | `this.holdBusy()` / `releaseBusy()` | On `_busy` | Manual control for long-running work (flash, sleep) |
| Cancel detection | Compare `this.abortGeneration` | — | Monotonically-increasing counter incremented on Ctrl+C; loop tests to detect abort |
| Overlay widget | `WidgetBase.start()` | No | TSR-style updates via `putc()`, composited at render time |

**Critical rules for command authors:**
1. **Prefer `this.print()`** for output. It enqueues via Typewriter, which gates the frame lifecycle. Bypassing it risks prompt timing bugs.
2. **Use `this.select()` or `this.selectAsync()`** for interactive input. These call `open()` internally; SyncCmdFrame routes keys to `cmd.handleKey()`. Never set `this.closed = false` directly.
3. **`this.close()` ends interactive mode.** Sets `cmd.closed=true`, unblocks the frame, eventually pops it.
4. **Dialogs and widgets are exceptions**: they own cell buffers and render instantly via overlays (z=100 / z=10).

## Command Architecture

### Registering a Command

Commands are auto-registered from `js/cmd/index.js`. To add a command:

1. Create `js/cmd/mycommand.js`:
   ```js
   import { CmdBase } from './CmdBase.js';

   export class MyCommand extends CmdBase {
       execute(args) {
           this.print('Hello, World!\n');
       }

       static get commandName() { return 'mycommand'; }
       static get help() { return 'My custom command'; }
       static get menu() { return 'My Command'; }  // or null to hide from menu
   }
   ```

2. Export it from `js/cmd/index.js`:
   ```js
   export { MyCommand } from './mycommand.js';
   ```

3. Test in browser: type `mycommand` at the shell prompt.

**Auto-registration**: `SystemManager._registerCommands()` iterates all exports from `index.js`, filters by `Cls.commandName` presence, instantiates, and registers in `this.commands` and `this.cmdList`.

### CmdBase API

| Method/Property | Purpose |
|---|---|
| `execute(args)` | Command entry point. `args` is `string[]` from shell tokenization. |
| `print(text)` | Enqueue text to Typewriter. Use for **all animated output**. |
| `readLine(callback)` | Request next line of user input. Callback receives trimmed string. |
| `select(options)` | 2D grid selection with arrow keys. See Grid Selection below. |
| `term` | Direct access to Terminal instance for escape sequences (use sparingly). |
| `system` | Direct access to SystemManager singleton. |
| `holdBusy()` / `releaseBusy()` | Hold/release the frame's `_busy` flag. For long-running/async work. |
| `abortGeneration` | Monotonically-increasing counter for Ctrl+C detection. Loop must re-check each iteration. |
| `cmdList` | `this.system.cmdList` — available for help/discovery. |
| `open()` / `close()` | Mark command as interactive. Routes keys to `handleKey()` via SyncCmdFrame. |
| `static commandName` | Command name (required for auto-registration). |
| `static help` | Help text shown in `help` command. |
| `static menu` | Menu description; `null` to hide from `menu` command. |

### Grid Selection: `this.select()`

2D grid navigation with arrow keys, Enter to select, Escape to cancel:

```js
this.select({
    text: 'Pick your favorite:\n',      // Printed via Typewriter
    options: [                          // 2D array: options[row][col]
        ['A', 'B', 'C'],
        ['D', 'E', 'F'],
    ],
    onPick: (row, col, value) => {
        this.print(`You picked: ${value}\n`);
        this.close();
    },
    onCancel: () => this.close(),       // Optional, defaults to this.close()
    move: customMove,                   // Optional, defaults to defaultGridMove
    render: customRender,               // Optional, defaults to defaultGridRender
});
```

**Default navigation**: ↑↓←→ with no wrap-around; CJK-aware column alignment; selected cell marked with `▶` + bold green.

### Interactive Input: `readLine()`

For multi-line or multi-prompt interactions:

```js
this.readLine((line) => {
    this.print(`You entered: ${line}\n`);
    // Continue or close
    if (done) this.close();
    else this.readLine(nextPrompt);  // Recursive prompt
});
```

**Critical rule**: Input arrives **only in the callback parameter**. Do NOT access `this.system.editor.line` or `this.line` — they are reserved for the shell prompt and will cause input conflicts.

## Design Constraints & Decisions

### Static CSS Color Classes

`.q0`–`.q255` and `.b0`–`.b255` in `style.css` are **hand-maintained and intentionally static**. They are independent from the `colToHex()` algorithmic palette in `Renderer.js`:

- `.q16`–`.q255` are for ANSI 256-color palette rendering
- Per-cell rendering uses these classes for indexed colors and inline `style` for truecolor
- **Do NOT propose generating these classes at runtime** — the design explicitly avoids this.

### Native UTF-8 Strings

All string literals use **native UTF-8 characters**, never `\uXXXX` escape sequences:
- ✓ Good: `'↑↓←→'`, `'✓✖'`, `'…'`, Chinese/Japanese text
- ✗ Bad: `'\u2191\u2193'`, `'\u270e'` (destroys readability)

### No Filesystem

This is a **stateless demo terminal**. No features requiring file I/O:
- ❌ Redirections (`>`, `<`, `>>`, `2>`)
- ❌ Globbing (`*`, `?`)
- ❌ Script execution (`source`, `sh file.sh`)
- ❌ File commands (`cat`, `less`)
- ❌ `PATH` for external binaries

Virtual `cd`/`pwd` (CWD string state only, no actual filesystem) may be added in the future for prompt/UX purposes.

### Font Metrics

- **eascii-core** (basic Latin + common symbols): advance = 32 units = 8px at 16px font-size
- **eascii-ext** (⏎, ✓, ✖, etc.): advance = 64 units = 16px at 16px font-size
- **CJK fonts** (ja, zh-common, zh-rare): double-width characters use `cell.width = 2`

Wide-character handling:
- Buffer: continuation cell with `width = 0` marks second half of a double-width char
- Rendering: skip cells with `width === 0`
- Input/delete: treat as single logical unit in text models

## Key Files for Navigation

- **Command execution entry point**: `js/main.js` → `SystemManager.handleInput()` → `system.js`
- **Terminal core entry point**: `js/main.js` → `new Terminal()` → `js/terminal/terminal.js`
- **Command registration**: `js/cmd/index.js` (barrel export) → `SystemManager._registerCommands()`
- **Overlay compositing**: `Renderer.js` → `_blendOverlays()` → `_renderRow()`
- **Frame scheduling**: `system.js` → `_processStack()` (called on every state change)
- **Animated output**: `Typewriter.js` → `requestAnimationFrame` loop with per-frame credit budgeting

## Testing & Validation

1. **Manual browser testing**: Open `index.html` or visit the live demo
2. **Command testing**: Type command name at `$` prompt
3. **Shell state**: Type `help` to list all commands
4. **Menu test**: Type `menu` to see dialog overlay + keyboard navigation
5. **Scrollback**: Mouse wheel or Ctrl+Shift++ / Ctrl+- to navigate
6. **Animation inspection**: Type `anime` or `art` to test rAF loops and overlay rendering

No automated test suite. Validation is by manual interaction + visual inspection.

## Git Commit Trailers

Include the Copilot co-author trailer in commit messages:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Related Documentation

- **[AGENTS.md](../AGENTS.md)** — Comprehensive architecture, command authoring rules, overlay lifecycle, prompt scheduling, POSIX scope, and critical constraints
- **[README.md](../README.md)** — Project overview, features, keyboard shortcuts, command reference
