# htmlterm — 80×25 HTML Terminal Emulator

## Goal
Pure HTML+CSS+JS 80×25 terminal emulator using Unifont monospace font, DOM `<span>` rendering.

## Changes Made This Session

### Done
- **`_processCSI` private marker `?` fix** (`terminal.js`): `?` (0x3F) was being swallowed by parameter range `0x30-0x3F` before private marker check, breaking `\x1B[?25h/l`. Changed to collect all bytes into `n`, strip private marker at final-byte time.
- **Menu save/restore off-by-one** (`shell.js`): Save started at `buffer[Y]` (0-indexed for buffer) but drawing used `Y` as 1-indexed CSI param, offsetting by 1 row. First menu row was never saved, persisted after restore. Fixed by saving from `Y-1` and passing `Y+1, X+1` to CSI H in `_drawMenu()`.
- **Cursor position not restored after menu** (`shell.js`): After menu drawing, `curX/curY` left at menu's last position; `showPrompt()` wrote `$ ` there. Fixed by saving/restoring cursor in `_exitMenu()`.
- **Box-drawing `_isWide` false positive** (`terminal.js` + `shell.js`): U+2500-25FF rendered at 16px in Unifont's Canvas measureText due to font metrics, causing menu drawing to wrap past saved rows. Fixed by returning `false` for 0x2500-0x25FF, 0x2190-0x21FF, 0x2300-0x23FF before canvas check.
- **`showPrompt()` unconditional after `execute('menu')`** (`shell.js`): `handleInput` called `showPrompt()` even after menu activation. Fixed with `if (!this.menuMode)` guard.
- **Footer ⏎ glyph width misalignment** (`shell.js`): `\u23CE` (⏎) only exists in the ext font with advance 64 units (16px at 16px font-size), while all core glyphs are 32 units (8px). This caused the footer span to render 8px wider than expected, shifting the right border `│` rightward. Fixed by replacing `\u23CE` (⏎) with `\u21A9` (↩) which is in core at 8px — standard Return/Enter key symbol.
- **Menu scrolling + scroll bar** (`shell.js`): Menu now shows max 5 items at a time; arrow keys scroll the window when selection reaches top/bottom edge. Right side of each item row has a scroll bar column with `█` (thumb) and `░` (track). Content width reduced by 1 (W-3) to make room. Added `menuScrollOffset`, `menuVisibleCount`, `_drawScrollBar()`, `_redrawItemArea()`.
- **Dialog extraction + InputDialog** (`dialog.js` + `shell.js`): Extracted dialog framework into reusable `dialog.js` with `Dialog` base class, `MenuDialog`, and `InputDialog`. `shell.js` now delegates all dialog lifecycle to these classes. Added `calc` item to menu: opens an `InputDialog` for typing an expression; Enter closes both dialogs and runs `calc`, ESC returns to menu.
- **`_bufWidth()` CJK padding fix** (`dialog.js`): All `padEnd()/.length` in dialog frame title, footer, items, and input field replaced with `_bufWidth()` via `term._isWide()` — right border `│` no longer shifts when content contains CJK fullwidth chars.
- **StateStack for nested dialog state** (`dialog.js` + `shell.js`): New `StateStack` class saves buffer area + cursor position + cursor visibility in one push; nested dialogs (menu → input) properly restore cursor-hidden when returning to parent. ESC from InputDialog no longer shows blinking cursor on the menu.
- **InputDialog blinking cursor** (`dialog.js`): `_showCursor()` positions the terminal cursor at the input field end after every render. Replaces the hidden-cursor default of dialogs.
- **256-color CSS classes** (`style.css` + `terminal.js`): Added `.q16`–`.q255` and `.b16`–`.b255` (480 CSS rules) for the xterm 256-color palette (6×6×6 cube + grayscale ramp). `_spanClass` now outputs `qN`/`bN` for N ≤ 255 instead of just 15; `XTERM_COLORS` expanded from 16 to 256 entries for cursor rendering.
- **Directory restructure**: `style.css` → `css/`; `terminal.js`, `dialog.js`, `shell.js` → `js/`. All paths updated in `index.html` and font URLs in CSS.
- **Help updated**: Added `menu` to the command list.
- **Command extraction + CmdBase** (`js/cmd/`): All 13 inline command handlers extracted from `shell.js` into individual files under `js/cmd/`. New `CmdBase` abstract class with `execute(args)`, `print(text)`, and static metadata (`commandName`, `help`, `menu`). Shell exposes `_registerCommands()` which iterates a `classes` array — adding a new command = 1 file + 1 `<script>` tag + 1 entry in the array. `help` command dynamically iterates `_cmdList` instead of hardcoding text.

### Command Architecture

```
js/cmd/
├── CmdBase.js    # execute(args) | print(text) | static commandName/help/menu
├── help.js       Help      — iterates shell._cmdList dynamically
├── clear.js      Clear
├── echo.js       Echo
├── date.js       Date
├── uname.js      Uname
├── neofetch.js   Neofetch
├── cowsay.js     Cowsay
├── ascii.js      Ascii
├── fortune.js    Fortune
├── calc.js       Calc
├── exit.js       Exit
├── whoami.js     Whoami
└── menu.js       MenuCmd   — execute delegates to shell._menuCmd()
```

**CmdBase contract:**

| Member | Purpose |
|---|---|
| `constructor(shell)` | Receives DemoShell instance; `this.term` available |
| `execute(args)` | Command logic, called with parsed arg array |
| `print(text)` | Alias for `this.term.write(text)` |
| `static get commandName()` | Command name string, e.g. `'fortune'` |
| `static get help()` | Description shown in `help` output |
| `static get menu()` | Menu description or `null` to hide from menu |

**Registration flow:**

```js
// shell.js
_registerCommands() {
    const classes = [Help, Clear, Echo, ..., MenuCmd];
    for (const Cls of classes) {
        const cmd = new Cls(this);
        this.commands[name] = cmd.execute.bind(cmd);
        this._cmdList.push({ name, help });  // help iterates this
        if (menu) this.menuItems.push({ name, desc: menu });  // menu dialog uses this
    }
}
```

Only `menu` command is special (invokes `shell._menuCmd()` dialog flow). `calc` command itself is stateless — the InputDialog → calc pipe is handled entirely by shell's dialog lifecycle and `_pendingAction`.

### Key Constraints
- DOM rendering (not Canvas)
- 80×25 viewport, auto-scaled
- inline-block span width fix would be needed for any span mixing 32-unit and 64-unit glyphs

### Critical Font Metrics
- core font (eascii-core): all glyphs have advance=32 units = 8px at 16px font-size
- ext font (eascii-ext): glyphs like ⏎, ✓, ✖ have advance=64 units = 16px at 16px font-size
- U+2191 (↑), U+2193 (↓) are in core at 8px — only ⏎ was problematic
