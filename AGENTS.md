# htmlterm — agent guide

## Purpose

Pure HTML, CSS, and JavaScript 80×25 terminal emulator. It uses Unifont and a
pre-created DOM `<span>` grid; it is not canvas-based and has no runtime
filesystem.

Live demo: <https://buffalobill-taiwan.github.io/htmlterm/>

## Start here

Read the document that matches the work being done before changing that area.

| Work | Required reference |
|---|---|
| Terminal, renderer, overlay, shell, dialogs, or input routing | [Architecture](docs/architecture.md) |
| Adding or changing a command, widget, dialog, or keyboard interaction | [Command authoring](docs/command-authoring.md) |
| Render-loop, animation, VirtualBuffer, dirty-row, or font-metric work | [Rendering performance](docs/rendering-performance.md) |
| Why a current design exists or past project milestones | [Project history](docs/project-history.md) |

## Non-negotiable constraints

- Keep DOM `<span>` rendering, the 80×25 viewport, and automatic scaling.
- The demo is stateless: do not add a real or virtual filesystem, redirection,
  globbing, script execution, external binary lookup, or process/job control.
- Do not generate `.q0`–`.q255` or `.b0`–`.b255` CSS classes at runtime.
- Use native UTF-8 JavaScript literals; do not replace visible text with
  `\uXXXX` escapes.
- Do not commit or push unless the user explicitly asks.
- There is no automated-test or CI requirement. Validate browser-facing changes
  manually and run appropriate syntax/static checks.

## Core invariants

- `Screen` owns the main cell buffer; `Parser` mutates it; `Renderer` owns the
  DOM. Do not mix those responsibilities.
- Widgets, dialogs, and flash own separate overlay buffers. They are composited
  by `Renderer._blendOverlays()` and must never save/restore or write over the
  main buffer.
- Command code accesses the live shell through `system` and `term` proxies from
  `js/system/sys.js`, never through `SystemManager.instance`.
- Commands use `this.print()` for normal output. Use `term.write()` only when
  deliberately bypassing the Typewriter (overlay rendering and shell prompt are
  valid exceptions).
- Use `this.select()` / `this.selectAsync()` / `this.readLine()` for interactive
  command input; do not set `closed = false` directly. Call `close()` to finish.
- Treat cells as immutable after they enter a buffer. Rendering and animation
  hot paths must reuse buffers, cells, scratch objects, and child slots.

## High-risk details

- A custom `_onKey()` must explicitly match every supported escape sequence
  before bare Escape closes the command. Delete, Insert, Home, End, and
  PageUp/PageDown otherwise accidentally fall through to quit.
- Check all terminal layout arithmetic with `isWide()` / `bufWidth()`. Box
  drawing is single-width; CJK and full-width glyphs are double-width.
- A dialog reference becoming `null` does not remove its overlay: call
  `dialog.close()` first. Parent handlers must null-check child dialogs after
  callbacks.
- `writeStr()` overwrites only the cells it touches; clear a shorter replacement
  row first. Dialog buffer overflow is silent.
- For a partial overlay update, mark only its affected rows dirty; reserve
  `markAllDirty()` for global changes.

## Repository map

- `js/terminal/`: Screen, Parser, Renderer, and terminal coordinator.
- `js/system/`: frame-stack shell, input editor, Typewriter, and helpers.
- `js/dialog/`: buffered draggable dialog implementations.
- `js/cmd/`: commands, games, widgets, and command registration.
- `js/util/`: side-effect-free shared utilities, including SGR and VirtualBuffer.
- `tools/`: offline art/font processing scripts, never runtime features.

## Working conventions

This repository has a `.codegraph/` index. Use CodeGraph before grep/find when
locating or understanding application code. Keep this file limited to rules and
navigation: put durable implementation detail in the linked `docs/` files.
