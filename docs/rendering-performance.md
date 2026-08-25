# Rendering and performance reference

## Hot-path rules

The render loop runs at rAF cadence. Avoid per-cell and per-frame allocations
in `_renderRow`, `_blendOverlays`, span-class construction, and animation
updates. Reuse instance scratch objects, arrays, cells, buffers, and palettes.

- Cells are immutable after placement; place reusable references rather than
  spreading attributes into newly allocated cells.
- Iterate overlay arrays with indexed loops and dirty-row sets with `Set.forEach`.
- Renderer value comparisons are the DOM-write skip mechanism; do not add a
  reference-only shortcut that misses visual changes.
- Dirty only rows affected by an overlay; use `markAllDirty()` for resize,
  scrolling, and other global changes.

## Renderer details

Renderer pre-creates `cellEls[25][80]`. Standard cells compare text, class, and
clip state before a write. Clip cells use `clip-right`, `clip-left`, and
`clip-cell` classes and keep `_clipText`, `_ox`, and `_oy` on the span to avoid
per-frame style-string churn. Cursor rendering uses a reusable ping-pong pair.

Overlay blending normally returns direct buffer cell references. It can create a
temporary clip cell only when overlay coverage splits a wide character; this is
an unavoidable exceptional allocation, not a pattern for regular drawing.

## VirtualBuffer and overlays

`clear()` should null existing slots in place. `render()` uses shallow row copies
because placed cells are immutable. `blit()` writes directly into its destination
instead of creating an intermediate rendered buffer.

For children that remain present across frames, call `addChildSlot()` once and
mutate the returned slot; set `active = false` to hide it. Do not repeatedly
clear `_children` and call `embed()` in an animation frame.

An overlay `getCell` should return the direct backing-buffer reference. Never
call `map`, `slice`, or make a copied overlay buffer per frame.

## Animation lifecycle

Use `RAFAnimationHelper` or `BusyAsyncHelper` with the command abort epoch.
For a large decoded frame/pixel structure captured by an rAF callback, set the
captured variable to `null` from `onCleanup`; cancellation alone may retain the
closure chain until a later GC. Predecode or cache reusable data outside the
frame update and update only rows whose cells changed.

## Layout and font metrics

Use `isWide(ch)` for terminal-cell arithmetic and `bufWidth(str)` for visible
strings containing SGR. Box drawing is single-width; CJK/full-width glyphs are
double-width. Core font glyphs advance 8px at 16px; extended glyphs such as
`⏎`, `✓`, and `✖` advance 16px. Arrow glyphs `↑` and `↓` are core-width.

When composing a dialog frame of width `W`, content is at most `W - 2` visible
cells. Place borders with `setCell` if content may be wide: concatenated strings
can silently push the right border past the buffer limit.
