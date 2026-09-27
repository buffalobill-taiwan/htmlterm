# Architecture reference

## Rendering model

`js/terminal/` splits the emulator into four layers:

| Module | Responsibility |
|---|---|
| `Screen.js` | Cell buffer, cursor, scrollback, SGR state, dirty tracking, overlays |
| `Parser.js` | VT100 escape parsing and delegation to Screen |
| `Renderer.js` | Pre-created 80×25 span grid, cursor DOM, rAF rendering, overlay blending |
| `terminal.js` | Coordinator, event wiring, public delegations, `writeVB()` |

Cells are `{ ch, fg, bg, bold, dim, italic, underline, blink, inverse,
conceal, crossedOut, width }`. Wide glyphs occupy a `width: 2` cell plus a
continuation cell. Renderer updates individual spans only when visual content
changes; it uses clip CSS classes for partial wide-cell overlay coverage.

## Terminal compatibility

This is a demo terminal with selected ANSI/VT100 behavior, not full terminal
protocol conformance. The source of truth is [Parser](../js/terminal/Parser.js),
[Screen](../js/terminal/Screen.js), and [Renderer](../js/terminal/Renderer.js).

| Area | Current behavior and limits |
|---|---|
| Indexed colors | 16 colors with bold brightening and 256-color `38;5;n` / `48;5;n` rendering |
| RGB colors | Screen parses `38;2;r;g;b` / `48;2;r;g;b`, but Renderer maps them to fixed `.qhi` / `.bhi` fallback colors; arbitrary RGB is not rendered |
| Text attributes | Common SGR rendering includes bold brightening, dim, italic, underline, inverse, strikeout, and blink; conceal is stored but not applied by Renderer. Project-specific SGR 500/501 controls enlarged text |
| Cursor and editing | Common CSI cursor movement, positioning, erase, insert/delete, scrolling, scroll regions, save/restore, and status reports |
| Private modes | Cursor visibility, alternate buffer 1049, application cursor keys, and mouse modes 1000/1002/1003/1006; these are selected implementations, not general DEC compatibility |
| String controls | OSC/DCS/SOS/PM/APC strings are consumed without implementing their payloads |
| Paste | Text paste is supported; the parser uses private mode 2000 for its bracketed-paste flag, rather than standard 2004, so standard bracketed-paste compatibility is not claimed |
| Layout | Demo defaults to 80×25; scaling never drops below 1, so a viewport smaller than the base grid can overflow |
| Line endings | LF also performs carriage return; cursor forward/back can wrap across rows, which is a project-specific behavior |

The shared dialog text writer handles indexed-color SGR; parsing a sequence in
the main terminal does not imply that every VirtualBuffer text path supports it.
Use the [development checks](development.md#manual-validation) when changing
protocol behavior. Update this table alongside any change to compatibility.

## Overlay compositing

The main buffer is rendered first. Overlays are independent transparent cell
buffers and are blended by fixed group order; a non-null later cell wins.

| Render order | Owner |
|---|---|
| Main screen | Screen / Parser / shell |
| Command overlays | Commands and command-owned animations |
| Dialog overlays | Dialog VirtualBuffer flattened buffer |
| Widget overlays | `WidgetBase._buffer` |

Overlays are rendered in the fixed order command → dialog → widget. Within a
group, later registration renders over earlier registration. Never use
`saveArea`/`restoreArea` or modify base cells to implement an overlay. Widget
buffers are passive; dialogs own keyboard input through their frame.
`term.writeVB(vb, x, y)` blits a VirtualBuffer into the main buffer only when
permanent screen content is intended.

## Shell and frames

`SystemManager` is a singleton. Command code imports `system` or `term` from
`js/system/sys.js`; the proxies resolve the current singleton and preserve
method `this` binding. Property assignments are forwarded to the live instance.
The runtime binding in `sys.js` does not import SystemManager, avoiding a cycle
through command modules.
[CommandRegistry](../js/system/CommandRegistry.js) owns command instances and
registration metadata; [WidgetManager](../js/system/WidgetManager.js) owns widget
lifecycle and receives its system explicitly. Each registered command instance is
reused across executions; initialize per-run state in `execute()` or its helpers.

The frame stack always contains a persistent `ShellFrame`. Commands add a
`SyncCmdFrame`; dialogs add a `DialogFrame` above it. A frame controls input
while it is topmost and blocks while output, async work, busy state, or its
interactive command remains active.

```
ShellFrame → command SyncCmdFrame → optional DialogFrame
```

`_processStack()` is the sole gate for popping completed frames and showing a
prompt. The shell prompt is displayed only after the persistent frame becomes
topmost, its pending-activation flag is set, and Typewriter, busy state, and
readLine state are all clear. Do not add ad-hoc prompt writes to completion
paths.

## Lifecycle

`SystemManager.dispose()` stops input and async command activity, closes active
dialogs, destroys widgets, removes remaining overlays, clears frame hooks, and
releases the singleton. Call it before `Terminal.dispose()` when tearing down
the application. `Terminal.dispose()` is idempotent and removes event
listeners, pending resize/render RAF callbacks, and renderer-owned DOM nodes.

Frames own cleanup callbacks registered with `CmdBase.addCleanup(fn)`. Completion,
cancellation, and failure run them once. Cancellation finishes frames from top to
bottom; `_processStack()` still owns popping and prompt activation. Async command
rejections and synchronous exceptions enter `failFrame()`, which cancels that
frame and its descendants, reports the error, and resumes the stack. Late promise
settlements from finished frames cannot wake a disposed system.

`Typewriter.abort()` flushes queued output and drain callbacks; `cancel()` discards
queued output without running callbacks; `dispose()` permanently disables output.
Ctrl+C uses cancellation. Command-owned drain callbacks are removed by frame
cleanup, while the system's drain listener remains registered.

## Input and output

Input is routed, in order, to the top frame handler, active `readLine`, a
blocked frame (Ctrl+C abort remains available), Typewriter handling, then the
shell `LineEditor`. Dialogs own key handling while open. Mouse events are first
offered to `system.handleMouse`; overlay dragging consumes the event, otherwise
the terminal emits its normal mouse escape sequence.

Normal command output flows through:

```
CmdBase.print → system.print → Typewriter.enqueue
```

The Typewriter's rAF credit model charges wide glyphs two credits and half-width
glyphs one. Shell prompts, dialog/widget buffers, and intentionally immediate
terminal writes bypass it.

## Dialogs and VirtualBuffer

Dialogs render to `this._vb`, flatten it with `render()`, and expose the result
as an overlay. Inline SGR is parsed into cell attributes by `js/util/write.js`.
`DialogFrame` saves cursor state when opening and restores it when finishing.

Open dialogs only through `system.createDialog()` or `CmdBase.openDialog()`.
Those helpers construct the dialog, call `pushDialogFrame()` (which owns
`dialog.open()`), and route keyboard input through `DialogFrame`. Do not call
`dialog.open()` from command or nested-dialog code, and do not forward keys to a
dialog from `_onKey()` / `handleKey()`. Nested dialogs (for example a settings
submenu) push another `DialogFrame` on top of the parent; when the child closes,
the parent frame becomes topmost again.

`VirtualBuffer` has low-level `writeStr`, `setCell`, `blit`, and `render` APIs,
plus layout helpers such as `centerRow`, `hline`, and `embed`. For repeatedly
rendered composition, use preallocated `addChildSlot()` entries rather than
calling `embed()` every frame. `clearCells()` clears content while retaining child
slots; `clearChildren()` removes children. `clear()` retains its original combined
reset behavior for existing callers.

Commands with a persistent screen layout (games, grids, and animated boards)
should normally render through a root `VirtualBuffer` and child buffers:

```
command state → child VirtualBuffers → root VirtualBuffer → term.writeVB()
```

Use child slots to position boards, sidebars, and temporary command panels.
`term.writeVB()` is for permanent command content and blits cells into the main
screen; it does not move the terminal cursor or create a Terminal overlay.
Keep layout positions on the child slots so moving a complete board does not
require changing every draw operation. Direct `term.write()` remains suitable
for control sequences, shell prompts, and deliberately immediate output.

When an interactive command finishes, the command must position the cursor
before calling `close()`. `ShellFrame` writes the next prompt only after the
command frame is popped. Command layout coordinates are zero-based; use
`CmdBase.placeShellCursor(row, col)` to convert them to ANSI coordinates and
clamp them to the viewport. The helper positions the cursor only—the shell
still owns writing the prompt.

## Relevant helpers

- `BusyAsyncHelper.js`: abort-safe timeout and RAF guards.
- `InteractiveCommandHelper.js`: wraps an async interactive flow with command
  open/close lifecycle.
- `QuestionnaireHelper.js`: configurable multi-dimension scoring.
- `RAFAnimationHelper.js`: abort-aware overlay and buffer animation manager.
- `flash-helper.js`: reusable screen, border, and art flash overlays.

Read [command authoring](command-authoring.md) for API usage and
[rendering performance](rendering-performance.md) before changing hot paths.
