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

## Overlay compositing

The main buffer is layer 0. Overlays are independent transparent cell buffers
and are blended by registration order within a z-layer; a non-null later cell
wins.

| Layer | Z | Owner |
|---|---:|---|
| Main screen | 0 | Screen / Parser / shell |
| Widget | 10 | `WidgetBase._buffer` |
| Dialog | 100 | Dialog VirtualBuffer flattened buffer |
| Flash | 200 | `flash-helper.js` |

Never use `saveArea`/`restoreArea` or modify base cells to implement an
overlay. Widget buffers are passive; dialogs own keyboard input through their
frame. `term.writeVB(vb, x, y)` blits a VirtualBuffer into the main buffer only
when permanent screen content is intended.

## Shell and frames

`SystemManager` is a singleton. Command code imports `system` or `term` from
`js/system/sys.js`; the proxies resolve the current singleton and preserve
method `this` binding.

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
as an overlay. Inline SGR is parsed into cell attributes by `js/dialog/write.js`.
`DialogFrame` saves cursor state when opening and restores it when finishing.

`VirtualBuffer` has low-level `writeStr`, `setCell`, `blit`, and `render` APIs,
plus layout helpers such as `centerRow`, `hline`, and `embed`. For repeatedly
rendered composition, use preallocated `addChildSlot()` entries rather than
calling `embed()` every frame.

## Relevant helpers

- `BusyAsyncHelper.js`: abort-safe timeout and RAF guards.
- `InteractiveCommandHelper.js`: wraps an async interactive flow with command
  open/close lifecycle.
- `QuestionnaireHelper.js`: configurable multi-dimension scoring.
- `RAFAnimationHelper.js`: abort-aware overlay and buffer animation manager.
- `flash-helper.js`: reusable screen, border, and art flash overlays.

Read [command authoring](command-authoring.md) for API usage and
[rendering performance](rendering-performance.md) before changing hot paths.
