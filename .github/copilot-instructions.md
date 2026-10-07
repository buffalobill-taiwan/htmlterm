# Copilot Instructions for htmlterm

htmlterm is the pure HTML/CSS/JavaScript 80×25 terminal emulator in this
repository. [AGENTS.md](../AGENTS.md) is the single source of rules and
navigation; follow it before reading anything else here.

## Scope

- No build, test, or lint pipeline. Validation is manual browser testing plus
  offline checks: `./tools/check-syntax.sh` and `node tools/import-check.mjs`.
- Stateless demo terminal: no filesystem, redirection, globbing, script
  execution, external binaries, or process/job control. Mobile and
  accessibility work are out of scope.
- Do not generate `.q0`–`.q255`/`.b0`–`.b255` CSS classes at runtime; the
  classes in `css/style.css` are hand-maintained.
- Use native UTF-8 string literals, never `\uXXXX` escapes for visible text.
- No editor/LSP configuration files (`jsconfig.json`, `.tsconfig`,
  `.editorconfig`, `.vscode/`, …).

## Reference documents

| Topic | Document |
|---|---|
| Terminal/renderer/shell/overlay/dialog architecture and protocol behavior | [docs/architecture.md](../docs/architecture.md) |
| Command, widget, dialog, and keyboard authoring rules | [docs/command-authoring.md](../docs/command-authoring.md) |
| Where command modules live and how to split large ones | [docs/command-modules.md](../docs/command-modules.md) |
| Render loop, dirty rows, VirtualBuffer, font metrics | [docs/rendering-performance.md](../docs/rendering-performance.md) |
| Local setup, static checks, manual validation, offline tools | [docs/development.md](../docs/development.md) |
| Why current designs exist and project milestones | [docs/project-history.md](../docs/project-history.md) |

## Terminal core in one paragraph

`Parser` decodes VT100 input and mutates the `Screen` cell buffer; `Renderer`
owns a pre-created 80×25 `<span>` grid and updates only dirty rows; `terminal.js`
coordinates the three and wires events. Overlays (commands, dialogs, widgets,
flash) own separate buffers composited by `Renderer._blendOverlays()` in the
order command → dialog → widget, plus flash above all; they never write to the
main buffer. The shell is a persistent `ShellFrame` with a `_processStack()`
prompt gate; commands push `SyncCmdFrame`s and dialogs push `DialogFrame`s.

## Key files

- `js/main.js` → boot and global `error`/`unhandledrejection` handlers
- `js/system/system.js` → `SystemManager` singleton, frame stack, Typewriter
- `js/cmd/index.js` → command barrel export for auto-registration
- `js/system/CommandRegistry.js` → registration metadata

When editing code, prefer `codegraph explore` over grep/read when locating
symbols, and update the linked `docs/` file whenever a documented behavior
changes.