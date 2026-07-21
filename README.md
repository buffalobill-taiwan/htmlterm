# HTMLTerm

[![Live Demo](https://img.shields.io/badge/demo-online-44cc11?style=flat-square)](https://buffalobill-taiwan.github.io/htmlterm/)

A pure HTML+CSS+JS 80×25 terminal emulator inspired by [term.ptt.cc](https://term.ptt.cc/).

Renders entirely via DOM `<span>` elements with CSS color classes — no Canvas.
Includes a demo shell with animated command output, interactive commands, draggable
dialogs, and TSR-style widgets.

## Features

### Terminal core

- Full ANSI escape sequence support (SGR colors, cursor positioning, scroll regions, etc.)
- 16-color ANSI palette with bold brightening
- 256-color and truecolor support
- Mouse tracking (normal, button-events, any-event, SGR 1006)
- Scrollback buffer (2000 lines) with mouse wheel navigation
- IME support for Chinese/Japanese input via hidden textarea
- CJK double-width character handling (buffer + rendering + input/delete)
- `\n` treated as CR+LF for proper newline behavior
- Viewport auto-scaling (maintains 80×25 aspect ratio, adjustable on resize)
- Bracketed paste mode
- Cursor blink animation
- CRT scanline overlay

### Demo shell

- Frame-stack command runner with rAF-based Typewriter output
- 21 built-in commands (games, widgets, interactive tests — see below)
- Dialog framework (`MenuDialog`, `InputDialog`, `ShowDialog`) with overlay compositing
- VirtualBuffer compositing abstraction for nested UI layout
- TSR widgets (clock, DVD logo) — draggable, position remembered
- Tab completion for command names; command history (Up/Down)
- Long multi-line input support with proper wrapping, backspace, and cursor navigation
- `Ctrl+C` aborts running commands, typewriter animation, `sleep`, and `flash`

## Architecture

> **Note on 256-color CSS classes:** The 480 `.q16`–`.q255`/`.b16`–`.b255` CSS rules in `style.css` are hand-maintained and intentionally kept static. Per-cell rendering in `Renderer.js` uses these classes for indexed colors and inline styles for truecolor. This avoids generating 80×25 inline style strings per frame and keeps the render hot path simple.

| Component | Approach |
|-----------|----------|
| **Core split** | `Screen.js` (buffer) · `Parser.js` (VT100 state machine) · `Renderer.js` (DOM grid) · `terminal.js` (coordinator) |
| **Rendering** | Pre-created 80×25 `<span>` grid; dirty-row updates via `.textContent` / `.className` / `.style.cssText` |
| **Buffer** | 2D cell array (`{ch, fg, bg, bold, italic, …, width}`) + scrollback; CJK uses `width: 2` + continuation cell |
| **Overlays** | Widgets (z=10), dialogs (z=100), and flash (z=200) own separate buffers; `Renderer._blendOverlays` composites at render time |
| **Shell** | `SystemManager` (singleton) + `sys.js` (Proxy exports for cmd code) + `ShellCmd` (persistent CmdBase subclass, REPL) |
| **Dialogs** | VirtualBuffer-based layout in `js/dialog/`; `DialogFrame` saves/restores cursor on open/close |
| **Input** | `keydown` on `document` (always captured) + hidden `<textarea>` for IME |
| **Focus** | Automatic refocus on `keyup` (ptt.cc pattern) |
| **Cursor** | Absolutely-positioned `<div>` with CSS `blink` animation |
| **Render loop** | `requestAnimationFrame` with dirty-row tracking |
| **Scaling** | `fitToViewport()` on init and debounced resize |

See [AGENTS.md](AGENTS.md) for detailed architecture, command authoring rules, and overlay lifecycle.

## Fonts

Uses [Unifont](https://unifoundry.com/unifont/) bitmap font, subsetted into five WOFF2 files:

- **eascii-core** — Basic Latin + common symbols (8px advance)
- **eascii-ext** — Extended symbols (⏎ ✓ ✖, 16px advance)
- **ja** — Hiragana + Katakana
- **zh-common** — Common CJK
- **zh-rare** — Rare CJK

## Usage

Open `index.html` in a modern browser, or visit the live demo:

<https://buffalobill-taiwan.github.io/htmlterm/>

### Commands

| Command | Description |
|---------|-------------|
| `anime` | Play 124-frame animation (30fps, Ctrl+C to stop) |
| `art` | Render pixel art from a random artwork |
| `ascii` | Show ANSI color chart (16-color + 256-color cube) |
| `astrology` | Today's horoscope for your zodiac sign |
| `5willow` | Print 五柳先生傳 (with `--big` for enlarged text) |
| `calc` | Evaluate arithmetic expression |
| `clear` | Clear screen |
| `clock` | Toggle TSR clock widget |
| `cowsay` | Let a cow speak |
| `date` | Show current date/time |
| `dvd` | Toggle bouncing DVD logo widget |
| `echo` | Print arguments |
| `flash` | Flash the screen N times (default 1). `--border` for border flash, `--art` for random artwork flash |
| `help` | List available commands |
| `menu` | Open command menu dialog |
| `mbti` | MBTI personality test (interactive) |
| `quiz` | Math quiz challenge |
| `sleep` | Wait for N seconds (default 1) |
| `sudoku` | Play Sudoku puzzle (interactive cursor navigation) |
| `time` | Measure execution time of a command |

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift++` / `Ctrl+Shift+=` | Scroll toward present |
| `Ctrl+-` | Scroll back through history |
| Mouse wheel | Scroll scrollback (3 lines per tick) |
| `Tab` | Command name completion |
| `Up` / `Down` | Command history |
| `Home` / `End` | Jump to start/end of input line |
| `Ctrl+A` / `Ctrl+E` | Jump to start/end of input line |
| `Ctrl+U` / `Ctrl+K` | Delete to start/end of input line |
| `Ctrl+W` | Delete word before cursor |
| `Ctrl+C` | Cancel input, abort command/typewriter |
| `Ctrl+D` | EOF on empty line |
| `Ctrl+L` | Clear screen and redraw prompt |

## Project layout

```
js/
├── main.js
├── terminal/    Screen.js Parser.js Renderer.js terminal.js   # VT100 core
├── system/      sys.js system.js CmdFrame.js LineEditor.js typewriter.js TextInputModel.js
├── util/        constants.js sgr.js unicode-width.js display-width.js VirtualBuffer.js drag.js tokenize.js calc-expr.js select-grid.js pixel-codec.js flash-helper.js random.js
├── dialog/      Dialog.js MenuDialog.js InputDialog.js ShowDialog.js ConfirmDialog.js write.js position.js  # Dialog framework
└── cmd/         CmdBase.js ShellCmd.js ... + widgets/        # Demo commands + widgets
css/style.css
index.html
tools/png2art.js                                          # Offline art converter
```

## License

MIT
