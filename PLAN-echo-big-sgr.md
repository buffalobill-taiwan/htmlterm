# Plan: Custom SGR escape sequence for `echo --big`

## Overview

Replace `echo --big`'s current pre-write-to-buffer approach with a custom SGR
escape sequence integrated into the standard VT100 SGR pipeline.

Instead of echo.js directly writing clip cells to `screen.buffer` and then
outputting cursor-forward sequences to skip past them, the **Screen.writeChar**
method auto-expands each character into a 2×n grid of clip cells when a `big`
SGR attribute is active. The Renderer already has a `cell.clip` rendering path.

## Architecture refresher — data flow

```
echo._bigEcho → this.print() → system.print() → Typewriter.enqueue()
  → rAF loop → terminal.write(data)
    → parser.write(data)
      → parser._feedGround(ch) for each char
        → screen.writeChar(ch)     ← HERE: auto-expand if attr.big
          → screen.buffer[row][col] = cell
    → Renderer._render()
      → _renderRow() → _blendOverlays() → cell.clip check → inline styles
```

The Typewriter outputs characters. The Parser processes them. When `attr.big`
is true, `writeChar` expands one input character into 4 (or 8 for CJK) cells
in the buffer. The Renderer picks up the dirty rows and renders them.

## Current state (before changes)

### `js/cmd/echo.js`

```js
_bigEcho(args) {
    const bigText = args[1];
    const rest = args.slice(2).join('');
    const chars = [...bigText];
    const screen = this.term.screen;
    const cw = this.term.charWidth;
    const cellH = this.term.charHeight;

    if (this.term.curY >= screen.rows - 2) {
        screen._scrollUp(2);
        this.term.curY = screen.rows - 2;
    }
    const startX = this.term.curX;
    const startY = this.term.curY;

    let row1 = '';
    let row2 = '';
    let col = startX;

    for (const ch of chars) {
        const nCols = screen.isWide(ch) ? 4 : 2;
        for (let r = 0; r < 2; r++) {
            const rowIdx = startY + r;
            if (rowIdx >= screen.rows) break;
            for (let c = 0; c < nCols; c++) {
                if (col + c >= screen.cols) break;
                screen.buffer[rowIdx][col + c] =
                    this._makeBigCell(screen, ch, c * -cw, r * -cellH);
            }
            screen.markRowDirty(rowIdx);
        }
        const skip = '\x1B[' + nCols + 'C';
        row1 += skip;
        row2 += skip;
        col += nCols;
    }
    this.print(row1 + '\x1B[B\x1B[G' + row2 + rest + '\n');
}

_makeBigCell(screen, ch, offsetX, offsetY) {
    const attr = screen.attr;
    return {
        ch, fg: attr.fg, bg: attr.bg,
        bold: attr.bold, dim: attr.dim,
        italic: attr.italic, underline: attr.underline,
        blink: attr.blink, inverse: attr.inverse,
        conceal: attr.conceal, crossedOut: attr.crossedOut,
        width: 1,
        clip: true,
        clipOffsetX: offsetX,     // pixel values — scale-dependent
        clipOffsetY: offsetY,
    };
}
```

**Problems with this approach:**
1. Direct `screen.buffer` access from echo.js — breaks encapsulation
2. Pixel offset values (`clipOffsetX`/`clipOffsetY`) are scale-dependent
3. No auto-wrap for long strings
4. Typewriter outputs cursor-forward sequences, not actual characters —
   confusing and fragile
5. Two separate code paths (pre-write + cursor-skip) for what should be
   simple character output
6. Manually handles scroll for 2-row big text

### `js/terminal/Renderer.js` (clip path, lines 143-147 currently)

```js
} else if (cell.clip) {
    const ox = cell.clipOffsetX || 0;   // pixel values
    const oy = cell.clipOffsetY || 0;
    span.innerHTML = '<span style="position:absolute;left:' + ox + 'px;top:' + oy + 'px">' + ch + '</span>';
    span.style.cssText = 'position:relative;display:inline-block;width:' + cw + 'px;height:' + chDim + 'px;font-size:' + (chDim * 2) + 'px;line-height:' + (chDim * 2) + 'px;overflow:hidden;vertical-align:top';
}
```

## Escape sequence design

| Sequence | Effect |
|---|---|
| `\x1B[500m` | Enable big mode (`attr.big = true`) |
| `\x1B[501m` | Disable big mode (`attr.big = false`) |

- 500/501 are well outside the standard SGR parameter range (0–107)
- `\x1B[0m` (SGR reset) also clears `big` via `Object.assign(attr, defaultAttr())`
- Param 0 inside `\x1B[500;0m` would reset ALL attributes (including big) —
  so this sequence is effectively a reset. Use separate sequences:
  `\x1B[500m` to enable, `\x1B[501m` to disable.

## Changes by file

### 1. `js/util/sgr.js`

**`defaultAttr()`** — Add `big: false`:
```js
export function defaultAttr() {
    return { fg: DEFAULT_FG, bg: DEFAULT_BG, bold: false, dim: false,
             italic: false, underline: false, blink: false, inverse: false,
             conceal: false, crossedOut: false, big: false };
}
```

**`applySGR()`** — Add handling for params 500/501:
```js
else if (p === 500) attr.big = true;
else if (p === 501) attr.big = false;
```

Insert these after the existing `else if (p === 29)` block, before the
color-handling block (p >= 30).

### 2. `js/terminal/Screen.js`

#### `writeChar(ch)` — new big-mode branch

Insert at the top of the method, before the existing logic:

```js
writeChar(ch) {
    if (this.attr.big) {
        return this._writeBigChar(ch);
    }
    // ... existing writeChar logic unchanged ...
}
```

Or inline the logic. The big-mode branch:

```js
_writeBigChar(ch) {
    const nCols = this.isWide(ch) ? 4 : 2;

    // Auto-wrap: not enough columns left
    if (this.curX + nCols > this.cols) {
        this.curX = 0;
        this.lineFeedEdge();
    }

    // Ensure 2 rows available for vertical span
    if (this.curY >= this.rows - 1) {
        this._scrollUp(1);
        this.curY = this.rows - 2;
    }

    // Write 2 × nCols clipped cells
    for (let r = 0; r < 2; r++) {
        for (let c = 0; c < nCols; c++) {
            const cell = makeCell(ch, this.attr, 1);
            cell.clip = true;
            cell.clipOffX = -c;   // cell-relative: 0, -1, -2, -3
            cell.clipOffY = -r;   // cell-relative: 0 or -1
            this.buffer[this.curY + r][this.curX + c] = cell;
        }
        this.markRowDirty(this.curY + r);
    }
    this.curX += nCols;
}
```

**Important**: Use `makeCell` (imported from `sgr.js`), not `this._makeCell`.
`_makeCell` calls `this.isWide(ch) ? 2 : 1` for width, but big cells are
**always width 1**. Pass width=1 explicitly to `makeCell`:

```js
const cell = makeCell(ch, this.attr, 1);
```

The `makeCell` function is already imported at the top of Screen.js:
```js
import { defaultAttr, applySGR, makeCell } from '../util/sgr.js';
```

#### `_rowHasBigChar(rowIdx)` — new helper

```js
_rowHasBigChar(rowIdx) {
    const row = this.buffer[rowIdx];
    if (!row) return false;
    for (let c = 0; c < this.cols; c++) {
        if (row[c] && row[c].clip) return true;
    }
    return false;
}
```

- Scans the buffer row for any cell with `clip: true`
- `clip` is ONLY set on big-expanded cells (not on overlay `_clipRight`/`_clipLeft`
  properties, which are separate)
- 80-column scan is negligible performance cost

#### `lineFeedEdge()` — 2-row advance for big text

```js
lineFeedEdge() {
    if (this.curY < this.scrollTop) this.curY = this.scrollTop;
    this.markRowDirty(this.curY);

    const curHasBig = this._rowHasBigChar(this.curY);
    const nextHasBig = this.curY + 1 < this.rows && this._rowHasBigChar(this.curY + 1);
    const step = (curHasBig && nextHasBig) ? 2 : 1;

    const target = this.curY + step;
    if (target > this.scrollBottom) {
        this._scrollUp(target - this.scrollBottom);
        this.curY = this.scrollBottom;
    } else {
        this.curY += step;
    }
}
```

**Why check BOTH rows?** A big char always occupies 2 consecutive rows.
When you're on the **top** row and hit `\n`, you need to skip past the
**bottom** row to land on a clean row. When you're already on the **bottom**
row (e.g., after writing rest text), you only advance 1. Hence:

| Scenario | curY | curHasBig | nextHasBig | step | Result |
|---|---|---|---|---|---|
| `echo --big "ABC"\n` | top row | true | true (bottom) | 2 | skip past both ✓ |
| `echo --big "ABC" DEF\n` | bottom row | true | false | 1 | advance to clean row ✓ |
| `echo normal\n` | normal row | false | false | 1 | normal behavior ✓ |

The scroll behavior is preserved: if `target > scrollBottom`, scroll by the
difference and set `curY = scrollBottom`.

### 3. `js/terminal/Renderer.js`

Update the `cell.clip` branch in `_renderRow()` (currently lines 143–147).

**Old (pixel offsets, scale-dependent):**
```js
} else if (cell.clip) {
    const ox = cell.clipOffsetX || 0;
    const oy = cell.clipOffsetY || 0;
    span.innerHTML = '<span style="position:absolute;left:' + ox + 'px;top:' + oy + 'px">' + ch + '</span>';
    span.style.cssText = 'position:relative;display:inline-block;width:' + cw + 'px;height:' + chDim + 'px;font-size:' + (chDim * 2) + 'px;line-height:' + (chDim * 2) + 'px;overflow:hidden;vertical-align:top';
}
```

**New (cell-relative offsets, auto-scale):**
```js
} else if (cell.clip) {
    const ox = (cell.clipOffX || 0) * cw;
    const oy = (cell.clipOffY || 0) * chDim;
    span.innerHTML = '<span style="position:absolute;left:' + ox + 'px;top:' + oy + 'px">' + ch + '</span>';
    span.style.cssText = 'position:relative;display:inline-block;width:' + cw + 'px;height:' + chDim + 'px;font-size:' + (chDim * 2) + 'px;line-height:' + (chDim * 2) + 'px;overflow:hidden;vertical-align:top';
}
```

The only change: `clipOffsetX` → `clipOffX` (multiplied by charWidth),
`clipOffsetY` → `clipOffY` (multiplied by charHeight). The inner span and
outer span structure stays the same.

Also verify that `_clipRight`/`_clipLeft` paths (overlay wide-char clipping)
are unaffected — they remain at lines 137–142, unchanged.

### 4. `js/cmd/echo.js`

Simplify `_bigEcho`, remove `_makeBigCell`:

```js
_bigEcho(args) {
    const bigText = args[1];
    const rest = args.slice(2).join('');
    let s = '\x1B[500m' + bigText + '\x1B[501m';
    if (rest) s += '\x1B[B' + rest;
    s += '\n';
    this.print(s);
}
```

- No direct `screen.buffer` access
- No pre-write of clip cells
- No cursor-forward skip sequences
- No manual scroll handling
- No `cw`/`cellH` pixel lookups
- The Typewriter outputs actual characters — animation shows text appearing
  character by character

Remove the `_makeBigCell` method entirely (the entire method, lines 53-67
in the current file).

## Implementation order

1. **`sgr.js`** — Add `big` to defaultAttr + applySGR (3 lines). Quick, no
   side effects.
2. **`Renderer.js`** — Update clip offset calculation (2 lines). Safe to do
   first since no cells use `clipOffX`/`clipOffY` yet.
3. **`Screen.js`** — Add `_writeBigChar`, `_rowHasBigChar`, modify
   `lineFeedEdge`. The core of the change.
4. **`echo.js`** — Simplify `_bigEcho`, remove `_makeBigCell`. Last step
   since it depends on the Screen changes being active.

## Verification (manual)

Test these cases in the browser:

| Test | Command | Expected behavior |
|---|---|---|
| Basic half-width | `echo --big Hello` | "Hello" rendered at 2× size (4 cells per char) |
| CJK wide char | `echo --big 你好` | Each CJK char rendered at 4×2 = 8 cells |
| Mixed width | `echo --big A大B` | A=2 cols, 大=4 cols, B=2 cols |
| With rest text | `echo --big ABC DEF` | Big "ABC" on 2 rows, "DEF" on the 2nd row |
| Auto-wrap | `echo --big "ABCDEFGHIJKLMNOPQRSTUVWXYZ"` | Long text wraps at screen edge |
| Bottom of screen | Repeatedly run `echo --big A` until scroll | Scrolls 2 lines when at the bottom |
| Newline after big | `echo --big ABC; echo normal` | "normal" appears on a clean row below big text |
| Reset | `echo --big ABC\x1B[0mnormal` | Reset turns off big mode |
| Scale | Resize browser window | Clip offsets scale with charWidth/charHeight |
| Multiple lines | `echo --big "AB\nCD"` | Big chars wrap at newline (2-row advance) |

## Potential pitfalls

1. **`makeCell` vs `_makeCell`**: In `_writeBigChar`, use the imported
   `makeCell(ch, this.attr, 1)` from `sgr.js`. Do NOT use `this._makeCell(ch)`
   — it sets width=2 for CJK chars, but big cells are always width=1.

2. **`cell.clip` collision**: The `clip` property is only set on big-expanded
   cells. Overlay clipping uses `_clipRight`/`_clipLeft` properties —
   no collision. `_rowHasBigChar` correctly only matches big cells.

3. **`clipOffX`/`clipOffY` naming**: These are **new** properties. The old
   `clipOffsetX`/`clipOffsetY` (pixel values) are completely removed. No code
   should reference the old names after the refactor.

4. **`lineFeedEdge` scroll edge case**: When `curY >= scrollBottom` and step=2,
   `target = scrollBottom + 1`, so `_scrollUp(1)` scrolls 1 line. After scroll,
   `curY = scrollBottom`. The big cell data at the old `scrollBottom` shifts up
   by 1 (into `scrollBottom - 1`). This is correct — buffer rows shifted, but
   the visual result is the same.

5. **`\x1B[B` in echo.js**: Moves cursor down to the 2nd row (bottom of big
   text). If the cursor was already on the 2nd row, this moves to a 3rd row
   (which is correct — rest text should be below the big text). This matches
   the original behavior where `DEF` appears on the 2nd row of big text,
   and a subsequent `\n` moves to a clean row.

6. **`lineFeedEdge` during `_writeBigChar`**: The wrap `lineFeedEdge()` call
   inside `_writeBigChar` uses the **modified** `lineFeedEdge` that checks
   `_rowHasBigChar`. At wrap time, the current line may already have some big
   chars from earlier in the same line. The `curHasBig` check will be true.
   But `nextHasBig` is false (the next line hasn't been written yet), so
   `step = 1`. This is correct — wrapping within a big line should advance 1
   row, not 2.

7. **CJK wide char at screen edge**: If 3 columns remain and the next char is
   CJK (needs 4 cols), wrap triggers. The char starts fresh on the next line.
   This is correct.

## Files not touched

- `js/system/typewriter.js` — No changes needed. Typewriter just outputs
  characters; the expansion is transparent.
- `js/terminal/terminal.js` — No changes needed. The Terminal delegates to
  Screen/Parser/Renderer.
- `js/terminal/Parser.js` — No changes needed. The `\x1B[500m` and `\x1B[501m`
  sequences are standard CSI `m` (SGR) sequences handled by `_executeCSI`.
- `js/util/constants.js` — No changes needed.
- `css/style.css` — No changes needed (the CSS class approach was deferred).
  The Renderer still uses inline styles for clip cells.
