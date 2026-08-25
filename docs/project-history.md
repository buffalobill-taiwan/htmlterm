# Project history

This is a historical reference, not a required pre-read. Current behavior and
constraints live in [AGENTS.md](../AGENTS.md) and the focused reference docs.

## Architecture milestones

- The original terminal was split into Screen (data), Parser (VT100 state),
  Renderer (DOM), and a thin coordinator. Rendering uses a pre-created span
  grid and dirty rows.
- Overlay compositing replaced save/restore approaches: widgets, dialogs, and
  flash each own a buffer and renderer composition preserves the main screen.
- The frame stack moved into `SystemManager`; the persistent `ShellFrame` now
  governs prompt activation and command/dialog I/O lifecycle.
- `sys.js` introduced live `system` and `term` proxies, replacing command-level
  access to `SystemManager.instance`.
- Dialogs and game layouts moved to VirtualBuffer. `addChildSlot()` later made
  persistent child composition allocation-free.

## Rendering and memory milestones

- `anime` moved from interval/escape-sequence rendering to rAF buffer overlays;
  pixel frames use RLE plus diffs through `pixel-codec.js` and an offline
  compressor.
- Flash moved from a CSS DOM overlay to the shared buffer-overlay pipeline.
- Renderer, SGR parsing, VirtualBuffer, Tetris, and Anime were audited to
  eliminate frame-time allocation, including dirty-row diffs, reusable cursor
  objects, in-place attributes, cached sidebar cells, and preallocated slots.
- Clip rendering moved from per-cell inline styles to CSS classes and per-span
  clip metadata; font subsetting tooling was added for WOFF2 output.

## Feature milestones

- LineEditor gained wrapped multi-row redraw, CUP positioning, and clear-to-end
  behavior. Cursor forward/back now wraps across rows.
- Reusable system helpers were added for abort-safe async work, interactive
  flows, questionnaires, and rAF animations.
- ConfirmDialog enabled Sudoku give-up; validation uses board conflicts.
- Wordle, Puyo, Gweled, Klotski, and Japanese Mahjong were added as full
  interactive games. Their source files are the authoritative rule details.
- Japanese Mahjong added tenpai/yaku-less wait display, deferred round
  settlement, and a centered game-over summary.

## Project boundaries and status

- The terminal core, overlay system, frame-stack shell, and Typewriter are
  complete. Commands are registered from `js/cmd/index.js`.
- Browser manual testing is the intended validation method; automated tests and
  CI are not planned.
- The shell remains a demo shell, not a POSIX implementation: no filesystem,
  redirection, globbing, script execution, PATH binary lookup, processes, or
  job control. Pipes are deferred because they conflict with animated output.
- Possible future UX work includes virtual CWD state, history search, richer tab
  completion, selection/copy behavior, and offline artwork tooling.

## Detailed 2026 record

Recent focus (Jun 2026): `anime` rewritten from `setInterval`+esc-seq to
rAF + buffer overlay compositing, centered like `flash --art`.
`js/util/pixel-codec.js` added — RLE+diff compression for pixel data;
tools/compress-anime.js offline script compresses frame 0 → RLE (492 vs 1800),
frames 1–123 → frame differencing (21376 vs 221400 raw entries).
Source size 523KB → 86KB (6.1×), gzip 18.5KB → 29KB.
flash refactored from CSS DOM overlay to buffer overlay
compositing (`OverlayZ.FLASH = 200`); `ARTWORKS` exported from `art.js` for reuse;
`flash --art` renders random artwork inline via same overlay pipeline.
`terminal.js` gained `markAllDirty()` proxy.
Frame stack moved from `DemoShell` to `SystemManager` (Jun 2026).
`SystemManager` became singleton, `DemoShell` absorbed as `ShellCmd` CmdBase subclass (Jun 2026).
Cmd ergonomics refactor (Jun 2026): `isTyping` → `_waitingForDrain`, `open()` method added,
`select-grid.js` moved to `js/util/`, `quiz.js` `_genQuestion()` extracted.
Directory restructure (Jun 2026): `js/` root split into `terminal/`, `system/`, `util/` subdirs.
LineEditor rewrite (Jul 2026): `_redraw()` handles multi-row wrapped lines via
`_cursorDisplayCol`/`_lastPromptRow` tracking, `\x1B[J` clear, and CUP positioning.
`Screen.cursorBack`/`cursorForward` now wrap across rows (standard terminal behavior).
System Proxy refactor (Jul 2026): `js/system/sys.js` added — Proxy-based `system` and
`term` exports replace direct `SystemManager.instance` access across all cmd files.
All 14 cmd/widget files updated; zero remaining `SystemManager.instance` references
in `js/cmd/`.
Flash extraction (Jul 2026): flash overlay logic extracted from `SystemManager` to
`js/util/flash-helper.js` — three standalone functions (`screenFlash`, `borderFlash`,
`artSequence`) take `cmd`+`term` parameters, reusable by any command without
`SystemManager` coupling. `system.js` shrunk by ~130 lines.
ConfirmDialog + Sudoku give-up (Jul 2026): `js/dialog/ConfirmDialog.js` added —
Yes/No dialog with ←→ navigation, used by `sudoku` give-up flow. Sudoku auto-check
switched from solution comparison to board-state conflict detection (`_hasConflict`).
Sudoku hint replaced with give-up (reveal full answer + Game Over).
VirtualBuffer (Jul 2026): `js/util/VirtualBuffer.js` added — compositing abstraction
for building UI layouts as nested cell buffers. `term.writeVB(vb, x, y)` blits a VB
to the screen buffer. Dialog migrated from raw `_buffer[][]` + `_writeStr()` to
VB-based layout (`this._vb`). Sudoku board/sidebar composition uses nested VBs.
Two-layer API: low-level (`writeStr`, `setCell`, `blit`, `render`) + high-level
(`centerRow`, `leftRow`, `rightRow`, `hline`, `embed`).
Tetris (Jul 2026): `js/cmd/tetris.js` added — full Tetris game with SRS rotation
system, wall kicks, T-Spin/T-Spin Mini detection, ghost piece, hold, combo,
back-to-back bonus, lock delay, line-clear flash animation, three difficulty
levels. 2×1 cell rendering via VirtualBuffer `setCell()` with colored backgrounds.
Rotation keys: `↑` / `X` rotate clockwise, `Z` counterclockwise (both use the
full SRS kick tables, including reverse-transition entries `1>0`/`2>1`/`3>2`/`0>3`).
Tetris GC optimization (Jul 2026): Per-frame object allocations eliminated — static
sidebar text, board borders, pause overlay cells pre-rendered once at init into
cached cell arrays; `_renderSidebar` copies cached cells instead of calling
`writeStr()` (~200 cell objects saved per frame); score/level/lines only re-rendered
when values change; `_children` array reused via `.length = 0` instead of `= []`;
VB buffers and palettes persist across games (singleton instance reuse).
GC pressure audit (Jul 2026): Systematic elimination of per-frame allocations across
the entire render pipeline — affects tetris, anime, and all overlay commands:
- `VirtualBuffer.addChildSlot()` added — pre-allocates a fixed child slot returned to
  the caller; `blit()`/`render()` skip `slot.active === false` slots. Tetris uses 4
  pre-allocated slots and never calls `embed()` per frame.
- `_renderSidebar` score/level/lines replaced `writeStr(bold(yellow(...)))` with
  `_buildDynRow` / `_writeDynRow` — mutable cell arrays updated in-place (zero alloc).
- `_flashRows` flash check `clearingRows.includes(r)` replaced with `Set.has(r)`.
- `Renderer._renderCursor`: replaced per-frame `new { x,y,ch,fg,bg,w,h }` with
  ping-pong reuse (`_cursorA`/`_cursorB`, `_cursorCurrent` pointer).
- `Renderer._renderRows`: `for...of Set` → `Set.forEach` (no hidden iterator object).
- `Renderer._blendOverlays`: `for...of Array` → indexed `for` loop (no iterator).
- `Screen.getCellAt`: same `for...of` → indexed loop fix.
- `sgr.js` `resetAttr(attr)` added — resets attr in-place; `applySGR` p===0 and
  `_writeStr` both use it instead of `Object.assign(attr, defaultAttr())`.
- `write.js` `_writeStr`: module-level `_attr` + `_sgrParams` reuse; SGR param
  parsing replaced `pStr.split(';').map().filter()` with direct integer accumulation.
- `Renderer._renderRow`: DOM value check (`span.textContent === text && span.className
  === cls && span.style.cssText === cssText`) skips DOM writes for cells with same
  visual content. This is the sole skip mechanism — no reference-level shortcut.
  Eliminates ~1280 Text node create/destroy per frame.
- Anime `copyFrame`/`buffer` elimination: removed `createEmptyBuffer`, `copyFrame`,
  `makeOverlayGetCell`; overlay `getCell` reads directly from `cellFrames[frameIdx]`
  via a swapped pointer (`curFrameCells`). Eliminated ~960 reference copies/frame
  and buffer allocation.
- Anime frame-level row diffing: callback compares each row's cells between consecutive
  frames (`src[x] !== dst[x]`) and only calls `markRowDirty` for rows with actual
  changes. Unchanged rows skip `_renderRow` entirely.
- Anime Proxy bypass: `screen.markRowDirty` cached via `term.screen.markRowDirty.bind(screen)`
  to avoid per-call wrapper function allocation from the `term` Proxy get trap.
Renderer clip refactor (Jul 2026): `_renderRow` replaced `span.style.cssText` per-cell
inline styles with CSS classes — `clip-right`, `clip-left`, `clip-cell` defined in
`style.css`. Clip cell comparison uses `span._clipText`/`_ox`/`_oy` properties instead
of `span.style.cssText` for the skip-fast-path check. Cursor sizing moved from per-frame
inline `cssText` to static CSS (`width:8px;height:16px;font-size:16px;line-height:16px`);
cursor positioning simplified to `style.left`/`style.top` only. `tools/subset-font.js`
added — offline Unifont → woff2 subsetter via `pyftsubset`.
Wordle (Jul 2026): `js/cmd/wordle.js` added — full Wordle clone with fullwidth uppercase display,
box-drawing grid borders, 100ms left-to-right color reveal animation, 3-row on-screen keyboard
with per-key state tracking (green/yellow/gray), 799-word answer pool, 15926-word guess validation,
Ctrl+C/ESC/q to close, n to start a new game. `js/cmd/valid-words.js` auto-generated.
Puyo (Aug 2026): `js/cmd/puyo.js` added — Puyo Puyo with chain elimination. 6×12 classic field
rendered as single wide `⬤` cells (2 terminal columns, snake-style continuation cells). Difficulty
limits color pool: easy=3 colors, medium=4, hard=5 (gravity 900/650/450ms). Column-based gravity (each
puyo falls straight down its own column — matches real Puyo Puyo, no gaps can remain) drives authentic
chains; after a pop the survivors **visibly fall one row at a time** (40ms/row via `_fallStep` →
`_fallOneStep`) until settled, then chain detection runs. No overhangs: a rigid pair stops when either
puyo is blocked, but `_lock` checks `_hasFloatingPuyo()` and an unsupported puyo keeps falling
independently (puyos never float). Classic chain-power scoring (1,8,16,32,64,96…),
white pop-flash animation, `Chain N!` +score overlay, landing ghost, next-pair preview, pause/game-over
overlays, SelectDialog difficulty picker, `--easy|--medium|--hard` flags.
Landing ghost (`_ghostLanding`) simulates the post-lock settle: the pair drops as a
rigid unit to its lowest fitting row, then each puyo's independent gravity fall is
applied on a scratch board — so an overhang ghost shows the two puyos at their final
settled spots, which may be non-adjacent.
Gweled (Aug 2026): `js/cmd/gweled.js` added — Bejeweled-style match-3 on a classic 8×8 field
rendered as wide `⬤` cells (same glyph as Puyo). Space selects the gem under the cursor (white bg),
arrow keys then swap it with the neighbor in that direction (blue bg = cursor, no selection when
cursors elsewhere). No-match swaps animate back after 250ms. Puyo-style chain pipeline: run-based
`_findMatches` (horizontal+vertical runs ≥3, `_swapCreatesMatch`/`_hasAnyMove` for move detection),
white pop-flash, one-row-at-a-time gravity fall (40ms/row via `_fallStep` → `_fallOneStep`), random
top refill (`_spawnGems`), then re-check — `Chain N!` +score overlay when `_chain≥2`. Classic
chain-power scoring table + color/group bonuses scaled to the color pool. `_genBoard` guarantees no
initial match AND ≥1 valid move; `_checkNoMoves` reshuffles (with a brief "No moves! Reshuffling"
overlay) when the board stalls. Difficulty limits color pool: easy=5, medium=6, hard=7. Pause overlay,
SelectDialog difficulty picker, `--easy|--medium|--hard` flags, N=new game.
Klotski (Aug 2026): `js/cmd/klotski.js` added — 華容道 sliding-block puzzle with 11 classic fayaa
layouts (比翼橫空 28 … 層層設防 102 mini steps). 4×5 board rendered as 2 terminal cols per logical cell;
each piece shows its general's full name (曹 red 2×2 rendered via clip-cell big mode — same 4×2 window as
`echo --big '曹'`; 關羽/關平/關興/關索/關統 on 2×1 horizontals, 張飛/趙雲/馬超/黃忠 on 1×2 verticals,
兵 white soldiers) on a dark themed tile
background (256-color palette: 曹 bg52, 關 bg22, 張 bg17, 趙 bg23, 馬 bg58, 黃 bg53, 兵 bg236; 關家 text
colors are distinct per person — 關羽 white q15, 關平 gold q220, 關興 orange q214, 關索 coral q209,
關統 turquoise q80) so pieces
read as distinct tiles. Custom LevelSelectDialog lists
編號/名稱/步數 with ↑↓ highlight bar. Space selects the block under the cursor (white bg), arrows slide
it one cell at a time — consecutive slides of the same block (regardless of direction) count as a single
move (run-based, matching fayaa step counts); Z undo reverts the whole run, P pause, N back to level
menu, Q/ESC/Ctrl+C quit. Cursor shows as a blue highlight on the whole block, or as a blue 2-wide square
on an empty cell. On winning (曹's top-left reaches (3,1)) a 550ms rAF animation slides the 曹 tile down
6 rows off the board bottom with ease-in gravity feel (drawn via a dedicated `_rootSlotCao` overlay slot,
blitted last); the tile stays fallen at the bottom while the
Win overlay (恭喜通關!) appears showing 步數/目標 with ★
if under the fayaa record, plus time. Naming rule: verticals 1×2 get 張飛/趙雲/馬超/黃忠 in scan order,
horizontals 2×1 get 關羽/關平/關興/關索/關統 in scan order. Sidebar shows
關卡/步數/目標/時間 + controls, 1s timer, `term.writeVB` compositing (no overlay), no animation loop
(renders only on input/timer).
Help/usage (Aug 2026): `help` rewritten — bare `help` prints a name-only grid list
(8 per row, width-10 columns) instead of name+description pairs; `help <cmd>` shows
the command's name, description, and usage line. `CmdBase` gained a `static get usage()`
property (null default); all commands now define it and `_registerCommands` stores it
in `cmdList` entries. Puyo/Gweled pop flash upgraded to a tetris-style white/color
blink (`_flashPop`, 6 steps × 80ms) before matched cells are cleared.
Klotski win polish: the 曹 tile falls deeper (6 rows) and the cursor skips over
already-passed empty cells.
jpmj (Aug 2026): `js/cmd/jpmj/` added — Japanese Mahjong 日本麻將 vs 3 AI opponents,
layered design: `JpmjCmd.js` (CmdBase UI layer — settings SelectDialog for per-seat
opponent AI + 託管 AI personality + starting seat + match length 東風戰/半莊戰/一莊戰;
tile hand rendering with per-call meld color coding; status bar; info panel; result
overlay; autoplay 託管), `game.js` (turn state machine, riichi/dora/honba/tsumo/ron,
exhaustive draw with noten payment, abortive draws 三家和/四槓散了/四風連打/九種九牌/
四家立直), `yaku.js` (yaku evaluation + payments), `wall.js`/`tiles.js`, and 6 AI
personalities via `ai_factory.js` (初學者/一般人/高手/国士命/断么廚/門清俠).
jpmj rule reference: the upstream implementation lives at `/home/buffalobill/playground/jpmj`
(`js/yaku.js` scoring, `js/main.js` UI incl. `getRankLabel` 満貫/跳満/倍満/三倍満/
数え役満/N倍役満 labels) — consult it before re-deriving any mahjong rule.
jpmj tenpai status bar (Aug 2026): `_getTenpaiInfo()` computes waits via
`evaluateHand` + `getWaitingTiles`, then per-wait yaku check (`STANDALONE_YAKU`) —
yaku-less waits (聽牌無役) are grayed out in the status row; result cached by hand string.
jpmj deferred settlement (Aug 2026): round-end paths (`executeWin`,
`handleExhaustiveDraw`, `handleSuuchaRiichi`, abortives) only record
`roundResult.deltas` — no score/stick/stats mutation until the player presses Enter on
the result screen. Single settlement point `commitRoundEnd()` applies deltas, zeroes
riichi sticks (on a win or 四家立直), updates stats, then calls `endRound()`.
Result-phase UI reads live scores + `roundResult.deltas`. `applyScore` was split into
the pure `computeWinDeltas`; the `_preRoundScores` snapshot/freeze patches were removed.

jpmj game-over overhaul (Aug 2026): `_renderGameOver` rewritten — 80×22
centered frame (rows 1–22), `displayWidth()` padding for correct CJK alignment,
"N位" rank labels, plain white player rows, centered summary
(連莊／總局數／流局); leftover riichi sticks now awarded to top player at
game end (matching upstream `showFinalResult`); Enter/n on game-over clears
screen then reopens settings dialog; `_render` empty branch keeps all slots
deactivated when no game exists.
