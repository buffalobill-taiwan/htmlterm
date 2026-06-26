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

> **Note on 256-color CSS classes:** The 480 `.q16`–`.q255`/`.b16`–`.b255` CSS rules in `style.css` could theoretically be replaced by inline styles (since `_rowToHTML` already uses inline `style` for truecolor), but this is intentionally not pursued. Keeping class-based rendering avoids generating 80×25 inline style strings per frame, improves browser style invalidation, and keeps the render hot path simple. If CSS rule count ever becomes a concern, rules can be generated dynamically via `CSSStyleSheet.insertRule()` instead of a static file.

| Component | Approach |
|-----------|----------|
| **Rendering** | DOM `<span>` elements grouped by CSS color classes (`q{0-255} b{0-255}`, truecolor via `qhi`/`bhi` + inline style) |
| **Buffer** | 2D array of cell objects (`{ch, fg, bg, bold, italic, ..., width}`) + scrollback array; CJK chars have `width: 2` with a `width: 0` continuation cell |
| **Dialog** | Reusable dialog framework (`Dialog`, `MenuDialog`, `InputDialog`, `ShowDialog`) in `js/dialog/` with overlay lifecycle |
| **Cursor state** | `DialogFrame` saves cursor position + visibility on open, restores on close — nested dialogs handled correctly via LIFO frame stack |
| **Shell** | Frame-stack command runner with animated Typewriter output, interactive command input, dialogs, and TSR-style widgets |
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
| `art` | Render ASCII art from a random artwork |
| `ascii` | Show ANSI color chart (16 color + 256 color cube) |
| `astrology` | Today's horoscope for your zodiac sign |
| `calc` | Evaluate arithmetic expression |
| `clear` | Clear screen |
| `clock` | Toggle TSR clock widget (replaces old `widget` command) |
| `cowsay` | Let a cow speak |
| `date` | Show current date/time |
| `dvd` | Toggle bouncing DVD logo widget |
| `echo` | Print arguments |
| `flash` | Flash the screen N times (default 1). Use `--border` for border flash |
| `fortune` | Display a random fortune |
| `goodbye` | Print farewell message |
| `help` | List available commands |
| `menu` | Open command menu dialog |
| `mbti` | MBTI personality test (interactive) |
| `quiz` | Math quiz challenge |
| `sleep` | Wait for N seconds (default 1) |

**Ctrl+Shift++ / Ctrl+-** — Scroll back/forward through history.

## License

MIT
