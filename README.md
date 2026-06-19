# HTMLTerm

[![Live Demo](https://img.shields.io/badge/demo-online-44cc11?style=flat-square)](https://buffalobill-taiwan.github.io/htmlterm/)

A pure HTML+CSS+JS 80×25 terminal emulator inspired by [term.ptt.cc](https://term.ptt.cc/).

Renders entirely via DOM `<span>` elements with CSS color classes — no Canvas.

## Features

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

## Architecture

| Component | Approach |
|-----------|----------|
| **Rendering** | DOM `<span>` elements grouped by CSS color classes (`q{0-255} b{0-255}`, truecolor via `qhi`/`bhi` + inline style) |
| **Buffer** | 2D array of cell objects (`{ch, fg, bg, bold, italic, ..., width}`) + scrollback array; CJK chars have `width: 2` with a `width: 0` continuation cell |
| **Dialog** | Reusable dialog framework (`Dialog`, `MenuDialog`, `InputDialog`) in `dialog.js` with `StateStack` for nested state management |
| **StateStack** | Each dialog push saves buffer area, cursor position, and cursor visibility; pop restores all three — handles arbitrary nesting |
| **Input** | `keydown` on `document` (always captured) + hidden `<textarea>` for IME |
| **Focus** | Automatic refocus on `keyup` (ptt.cc pattern) |
| **Cursor** | Absolutely-positioned `<div>` with CSS `blink` animation |
| **Render loop** | `requestAnimationFrame` with dirty-row tracking |
| **Scaling** | `_setScale()` adjusts font-size, line-height, row heights, and wrapper dimensions; `fitToViewport()` picks max scale on init and debounced resize |

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
| `help` | List available commands |
| `menu` | Open command menu dialog |
| `clear` | Clear screen |
| `echo` | Print arguments |
| `date` | Show current date/time |
| `fortune` | Display a random fortune |
| `ascii` | Show ANSI color chart (16 color + 256 color cube) |
| `neofetch` | Display system info |
| `cowsay` | Let a cow speak |
| `calc` | Evaluate arithmetic expression |
| `whoami` | Show user name |
| `exit` | Exit the demo shell |

**Ctrl+Shift++ / Ctrl+-** — Scroll back/forward through history.

## License

MIT
