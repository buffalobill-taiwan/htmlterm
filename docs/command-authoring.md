# Command authoring reference

## Registration and contract

Export a command class from `js/cmd/index.js`; `SystemManager` automatically
registers exported classes with a `commandName`. `ShellCmd` is persistent and
is not a user command.

`CmdBase` commands have no constructor parameters and import `system` / `term`
from `../system/sys.js` when needed.

| API | Use |
|---|---|
| `print(text)` | Animated normal output |
| `parseArgs(args, opts)` | Standard flags and help parsing |
| `readLine(callback)` | One command-owned line of input |
| `select()` / `selectAsync()` | Open a keyboard-driven selection flow |
| `open()` / `close()` | Custom interactive lifecycle |
| `holdBusy()` / `releaseBusy()` | Command-controlled blocking work |
| `abortGeneration` | Detect Ctrl+C across delayed/async re-entry |

Supply `commandName`, `help`, `usage`, and `menu` static getters (`menu: null`
hides a command from the menu). Commands should call `print`, not `term.write`,
so frame completion correctly waits for Typewriter drain.

## Interaction patterns

Use `select()` or `selectAsync()` for grid selection. Default movement does not
wrap: Up/Down preserves the nearest valid column and Left/Right remain in the
current row. Use `readLine(callback)` for free text; its buffer is independent
of `this.line` and `system.editor.line`, so only use the callback value.

For custom key handlers, call `open()` before rendering and `close()` on exit.
Match every sequence that your handler may receive before treating bare Escape
as quit:

| Key | Sequence |
|---|---|
| Arrows | `\x1B[A`, `\x1B[B`, `\x1B[D`, `\x1B[C` |
| Delete / Insert | `\x1B[3~`, `\x1B[2~` |
| Home / End | `\x1B[H` or `\x1B[1~`; `\x1B[F` or `\x1B[4~` |
| PageUp / PageDown | `\x1B[5~`, `\x1B[6~` |
| Backspace / Ctrl+C | `0x08` or `0x7F`; `0x03` |

## Dialog and widget rules

Dialog subclasses must compute constructor values locally, call `super()`, then
set their own `this.h`: the base constructor initializes height to zero and
does not consume `opts.h`. Close a dialog before clearing its reference, and
null-check child-dialog references after their callbacks can clear them.

Dialog strings have silent clipping. Use `bufWidth()` for visible CJK-aware
width (not `bufWidth` on SGR-prefixed input) and use `setCell()` for fixed
box-drawing borders. Clear a row before replacing it with shorter text.

Widgets render through their own buffer: `null` is transparent and a cell is
opaque. `putc()` updates a cell and marks the matching screen row dirty.

## Starting patterns

Simple command:

```js
export class MyCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, { flags: { '--verbose': Boolean } });
        if (p.hasHelp) return this.showHelp();
        this.print('Hello!\n');
    }
    static get commandName() { return 'mycmd'; }
    static get help() { return 'Short description'; }
    static get usage() { return 'mycmd [--verbose]'; }
    static get menu() { return null; }
}
```

Async work may use `async execute(args)`; frame management waits for the returned
promise. Multi-step interaction should use `wrapInteractiveFlow(this, flow)` so
every exit path closes correctly. For an animation, use `startBufferAnimation`,
pass the command for abort handling, prebuild reusable cells/buffers, and mark
only the overlay rows dirty.

## Command-specific source map

- `CmdBase.js`: common contract and selection helpers.
- `WidgetBase.js`: widget buffer lifecycle.
- `sudoku.js`, `tetris.js`, `puyo.js`, `gweled.js`, and `klotski.js`: examples
  of custom interactive games.
- `jpmj/`: Japanese Mahjong UI, engine, yaku evaluation, wall/tiles, and AI.
  Consult the upstream project at `/home/buffalobill/playground/jpmj` before
  re-deriving Mahjong scoring or rule behavior.
