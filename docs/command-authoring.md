# Command authoring reference

## Registration and contract

Export a command class from `js/cmd/index.js`; `SystemManager` uses `CommandRegistry` to
register exported classes with a `commandName`. `ShellCmd` is persistent and
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
| `addCleanup(fn)` | Release a timer, hook, or other execution-owned resource on frame exit |
| `executionGuard()` | Capture a predicate that becomes false when the owning frame finishes or is cancelled |
| `abortEpoch` | Detect Ctrl+C across delayed/async re-entry |

Supply `commandName`, `help`, `usage`, and `menu` static getters (`menu: null`
hides a command from the menu). Commands should call `print`, not `term.write`,
so frame completion correctly waits for Typewriter drain.

## Interaction patterns

Use `select()` or `selectAsync()` for grid selection. Default movement does not
wrap: Up/Down preserves the nearest valid column and Left/Right remain in the
current row. Use `readLine(callback)` for free text; its buffer is independent
of `this.line` and `system.editor.line`, so only use the callback value. Prefer
`async execute()` with `await this.readLineAsync()` when completion must wait
for the answer. A callback alone does not keep a closed command frame alive.

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

A sequence you did not match — an incomplete one such as `\x1B[` or
`\x1B[1;`, an unknown CSI, or a modified-arrow form — must be ignored rather
than treated as Escape. Only a lone Escape (or, for a single printable
control byte, that byte itself) may cancel:

```js
_onKey(data) {
    const csi = parseCSI(data);
    if (!csi) {
        if (data === '\x1B' || data.length === 1) return this.close();
        return;                                   // incomplete / unrecognised
    }
    switch (csi.final) {
        case 'A': this._moveBy(-1); return;
        case 'B': this._moveBy(1); return;
    }
    // unknown final byte: ignore
}
```

`parseCSI()` from `js/system/TextInputModel.js` returns
`{ final, params, consumed }` for a complete `\x1B[` or `\x1B O` sequence and
`null` for an incomplete or non-CSI one; `params` is the raw parameter string
(`'1;5'`, `'?25'`). Use it instead of hand-rolling the parameter split.
Dialogs and games in this repository follow the same rule, so a key that
reaches a child handler is never silently quit by the parent.

## Command screen buffers and shell return

For a command with a multi-row or animated layout, use a root `VirtualBuffer`
and child buffers for independently positioned regions such as the board,
sidebar, and status panels. Compose them with `addChildSlot()` and send the
root buffer with `term.writeVB()`:

```js
this._rootVB = new VirtualBuffer(term.cols, term.rows);
this._boardVB = new VirtualBuffer(BOARD_W, BOARD_H);
this._boardSlot = this._rootVB.addChildSlot();
this._boardSlot.vb = this._boardVB;
this._boardSlot.x = BOARD_X;
this._boardSlot.y = BOARD_Y;
this._boardSlot.active = true;
```

Keep positions in the slot or layout constants. Do not rebuild the whole
screen with cursor-positioned `term.write()` calls when the content is a
persistent command view. `term.writeVB()` blits the buffer but does not move
the terminal cursor.

Before an interactive command calls `close()`, place the shell cursor on the
line where the next prompt should appear:

```js
_quit() {
    this.stopTimers();
    this.placeShellCursor(this.shellPromptRow);
    this.close();
}
```

`placeShellCursor(row, col)` accepts zero-based viewport coordinates, converts
them to ANSI coordinates, and clamps them to the terminal. Do not write the
shell prompt from the command; `ShellFrame` owns prompt output after the
command frame has been removed. Keep the cursor-row calculation beside the
command layout so moving the board also moves the return position.

## Dialog and widget rules

Open every dialog with `this.openDialog(DialogClass, key, opts, ...ctorArgs)`
(or `system.createDialog` when not inside a command). Pass a string `key` to
persist drag position across opens, or `null` to skip. Never call
`dialog.open()` yourself and never forward keys to a dialog from the command
`_onKey()` — `DialogFrame` owns input while the dialog is open.

```js
this._diffDialog = this.openDialog(SelectDialog, 'mycmd-diff', {
    title: 'MyCmd',
    message: yellow('Select difficulty'),
    options: ['Easy', 'Medium', 'Hard'],
    footer: '← → Move  ↩ Confirm  ESC Quit',
    onSelect: (idx) => {
        this._diffDialog = null;
        this._startGame(idx);
    },
    onCancel: () => {
        this._diffDialog = null;
        this._quit();
    },
});
```

On quit/abort, still `close()` any held dialog reference before nulling it:
`DialogFrame` removes the overlay, but a command-owned reference must not outlive
a closed dialog. Null-check child-dialog references after callbacks that clear
them.

Dialog subclasses must compute constructor values locally, call `super()`, then
set their own `this.h`: the base constructor initializes height to zero and
does not consume `opts.h`.

Dialog result callbacks (`onConfirm`, `onSelect`, `onCancel`, `onExit`, and
`onStart`) run after the closing frame has restored its cursor and been popped.
Callbacks may position the shell cursor, start a game, or open a new dialog
without a frame-pop hook. MenuDialog's `onSelect` is intentionally different:
it runs while the menu is open, allowing a nested submenu; return `'close'` to
close that menu. Custom dialog subclasses use `return this.complete(callback,
...args)` for a terminal result. Calling `close()` directly only removes the
overlay; it does not deliver a result callback.

`SelectDialog` and `VerticalSelectDialog` accept `selectedIndex` (zero-based).
Horizontal options flow into additional rows when needed; the vertical grid
reduces its column count to fit and reveals the selection during navigation.
Messages wrap at CJK-aware cell boundaries, preserving SGR. Tall dialogs retain
their header/footer inside the 80×25 viewport and scroll with PageUp/PageDown.
InputDialog scrolls horizontally to keep its editing cursor visible. Title,
footer, prompt, and setting labels are clipped inside fixed borders.

`SettingsDialog` defaults to title `Settings` and action label `Apply`; supply
`title` and `startLabel` for command-specific wording. It opens each submenu at
the current setting value. `InfoDialog` remains available for caller-owned
VirtualBuffers; oversized content is clipped horizontally and scrolls vertically.

Use `bufWidth()` for visible CJK-aware width, including strings with SGR. Dialog
row helpers clear old content and preserve fixed borders. Custom rendering must
also clear shorter replacement rows and keep writes inside the inner area.
`refreshContent()` compares visible cells and marks only changed screen rows.

Dialogs can opt into `peekOnTab: true`: holding Tab temporarily makes their
overlay transparent, and releasing Tab or blurring the window restores it.
Other keys are ignored while peeking, preserving the selection and callbacks.
The optional `onPeekChange(held)` callback can hide related command panels;
jpmj uses it to expose discards beneath its selection and confirmation dialogs.

Widgets render through their own buffer: `null` is transparent and a cell is
opaque. `putc()` updates a cell and marks the matching screen row dirty.

### Text width

Import these functions from `js/util/display-width.js`:

```js
import { displayWidth, bufWidth, isWide } from '../util/display-width.js';

isWide('中');                         // true: two terminal cells
displayWidth('A中文');               // 5: plain text
bufWidth('\x1B[31mA中文\x1B[0m');     // 5: SGR does not occupy cells
```

`displayWidth()` does not strip escape sequences. `bufWidth()` is intended for
styled text; it is not a simulator for cursor movement or every ANSI control.
Do not use JavaScript string length for terminal layout.

## Complete command examples

Run the app with the [local HTTP server](../README.md#usage). The following are
complete new command files; the earlier layout and dialog snippets are fragments
to adapt inside a command.

### Synchronous output

Create `js/cmd/hello.js`:

```js
import { CmdBase } from './CmdBase.js';

export class HelloCmd extends CmdBase {
    execute(args) {
        const p = this.parseArgs(args, { flags: { '--loud': Boolean } });
        if (p.hasHelp) return this.showHelp();
        const name = p.rest.join(' ') || 'world';
        const message = `Hello, ${name}!`;
        this.print((p.flag('--loud') ? message.toUpperCase() : message) + '\n');
    }
    static get commandName() { return 'hello'; }
    static get help() { return 'Print a greeting'; }
    static get usage() { return 'hello [--loud] [name]'; }
    static get menu() { return null; }
}
```

Add this export to `js/cmd/index.js`:

```js
export { HelloCmd } from './hello.js';
```

Reload the page, then run `hello 中文`, `hello --loud reader`, and `help hello`.
Expect a greeting or usage text followed by one shell prompt. Plain output
commands do not need `open()` or `close()`; the frame waits for Typewriter drain.

### Async input and an owned timer

Create `js/cmd/greet.js`:

```js
import { CmdBase } from './CmdBase.js';
import { wrapInteractiveFlow } from '../system/InteractiveCommandHelper.js';

export class GreetCmd extends CmdBase {
    execute(args) {
        if (this.parseArgs(args).hasHelp) return this.showHelp();
        return wrapInteractiveFlow(this, async () => {
            this.print('Name: ');
            if (!await this.waitForPrint()) return;
            const name = await this.readLineAsync();
            if (name === null) return;

            this.print('Preparing greeting...\n');
            if (!await this.waitForPrint()) return;
            const completed = await new Promise(resolve => {
                const timer = setTimeout(() => {
                    removeCleanup();
                    resolve(true);
                }, 2000);
                const removeCleanup = this.addCleanup(() => {
                    clearTimeout(timer);
                    resolve(false);
                });
            });
            if (!completed) return;
            this.print(`Hello, ${name || 'world'}!\n`);
            if (!await this.waitForPrint()) return;
        });
    }
    static get commandName() { return 'greet'; }
    static get help() { return 'Ask for a name and greet after two seconds'; }
    static get usage() { return 'greet'; }
    static get menu() { return null; }
}
```

Add this export to `js/cmd/index.js`:

```js
export { GreetCmd } from './greet.js';
```

Reload and run `greet`. Enter a name and expect a greeting after the delay, then
one shell prompt. Run it again and press Ctrl+C while entering the name, during
output, and during the delay. Each cancellation should return to the shell;
`echo ready` must still work and no delayed greeting should appear. Normal line
input keeps the cursor at the shell return position; commands drawing a fixed
board instead need `placeShellCursor()` before closing.

### Lifecycle contract

Return the async Promise from `execute()`. Frames handle synchronous exceptions
and rejected execution Promises. `wrapInteractiveFlow()` opens/closes interaction
and reports flow errors, but arbitrary timers and callbacks still need cleanup.

`addCleanup(fn)` registers a callback on the active command frame. It runs once
on frame completion, cancellation, or failure, not necessarily immediately when
`close()` is called. Its return value unregisters the callback without running it.
Register resources immediately after creating them. Clearing a timer alone does
not settle a Promise waiting for it; the example also resolves `false` on exit.

| Wait | Normal result | Cancellation result |
|---|---|---|
| `readLineAsync()` | Input string | `null` |
| `selectAsync(opts)` | `{ row, col, value }` | `null` |
| `ask(question)` | Input string | `null` |
| `waitForPrint()` | `true` (also if already idle) | `false` |
| `showMessage(msg)` | `undefined` on normal exit | `null` on frame cleanup |

Check cancellation results before continuing an async flow. Keep per-execution
values in local variables: command instances are reused. Overriding `onCancel()`
requires releasing command resources and preserving base cancellation behavior
where selection Promises are involved. Dialog Escape/Ctrl+C is handled by that
dialog and need not abort the entire parent flow.

For animations, use `startBufferAnimation`, pass the command for abort handling,
prebuild reusable cells/buffers, and mark only changed overlay rows dirty. Follow
[manual validation](development.md#manual-validation) for browser-facing changes.

### Async loading and dialog replacement

Before starting an async load, capture `const isActive = this.executionGuard()`.
Check `isActive()` after each `await` and before printing, changing busy state,
or starting an animation. The predicate captures the original frame and remains
safe after disposal or reuse of the command instance. It does not replace
`addCleanup()` for timers, overlays, or other resources that need immediate
cancellation.

An input-dialog confirmation opens a result with
`system.createDialog(ShowDialog, key, opts)`; its input frame is already gone.
Outside a result callback, `system.replaceDialog(dialog, ShowDialog, key, opts)`
can finish an active frame before opening its replacement. When closing a parent
menu before starting a command, use `system.closeDialog(menu)` so its cursor is
restored before the command runs. Do not defer transitions with an unowned
`setTimeout()`.

## Command-specific source map

- `CmdBase.js`: common contract and selection helpers.
- `WidgetBase.js`: widget buffer lifecycle.
- `sudoku/`, `tetris/`, `puyo/`, `gweled/`, and `klotski/`: examples
  of custom interactive games, with command lifecycle and rendering separated.
- See [Command modules](command-modules.md) for the directory map and module
  boundaries used by larger commands.
- `jpmj/`: Japanese Mahjong UI, engine, yaku evaluation, wall/tiles, and AI.
  Consult the [upstream synchronization guide](jpmj-upstream.md) before
  re-deriving Mahjong scoring or rule behavior.
