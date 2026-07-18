# 數獨指令實作計畫

## 概述
新增 `sudoku` 指令，讓使用者在 80×25 終端中玩數獨。支援三種難度、即時錯誤檢查、計時器、提示功能和重新開始。

## 檔案結構
- `js/cmd/sudoku.js` — 主要指令檔案（約400行）
- `js/cmd/index.js` — 新增匯出

## 核心功能

### 1. 數獨生成演算法
- 回溯法生成完整有效盤面
- 根據難度挖空：
  - Easy：36格提示（挖空45格）
  - Medium：30格提示（挖空51格）
  - Hard：24格提示（挖空57格）

### 2. 盤面顯示
- 使用 box-drawing 字元繪製9×9格子
- 顏色區分：
  - 原始數字（given）：青色粗體
  - 使用者輸入：綠色
  - 錯誤（auto-check）：紅色
  - 游標位置：反白
  - 格線：灰色

### 3. 按鍵操作
- 方向鍵（↑↓←→）：移動游標
- 數字鍵 1-9：輸入數字
- Backspace / Delete：清除格子
- h：提示（填入一個正確數字）
- n：新遊戲（重新選擇難度）
- c：切換自動檢查
- q / Esc：離開

### 4. 計時器
- 每秒更新，顯示在標題列：`⏱ 00:05:23`
- 完成時暫停

### 5. 自動檢查
- 可切換（按 c）
- 輸入時即時標紅錯誤格子
- 檢查行、列、3×3 宮格限制

## 遊戲流程
1. 執行 `sudoku` → 顯示難度選擇（select grid）
2. 生成謎題 → 進入互動模式（open + holdBusy）
3. 方向鍵移動 + 數字鍵輸入
4. 完成後顯示恭喜訊息 + 釋放資源（releaseBusy + close）
5. 按 n 可重新開始，按 q 離開

## 狀態管理
```js
this._board = Array(9).fill(null).map(() => Array(9).fill(0));
this._solution = Array(9).fill(null).map(() => Array(9).fill(0));
this._given = Array(9).fill(null).map(() => Array(9).fill(false));
this._cursorRow = 0;
this._cursorCol = 0;
this._difficulty = 'medium';
this._timer = 0;
this._timerInterval = null;
this._autoCheck = true;
this._errors = new Set();  // "row,col" strings
this._completed = false;
```

## 關鍵實作細節

1. **回溯生成器**：從空盤面開始，隨機填入有效數字，卡住時回溯。挖空時確保唯一解。

2. **即時重繪**：使用 `term.write()` 直接寫入（繞過 Typewriter），確保每次按鍵後格子立即更新。

3. **游標高亮**：使用 ANSI 反白（`\x1B[7m`）標示選中格子。

4. **行重繪優化**：游標移動時只重繪受影響的2行（舊+新位置）。

5. **計時器顯示**：作為標題列的一部分，透過 `setInterval` + `term.write()` 更新。

6. **完成檢測**：檢查所有格子是否填滿且無錯誤。

## 用法
```
sudoku              # 顯示難度選擇
sudoku --easy       # 開始簡單模式
sudoku --medium     # 開始中等模式
sudoku --hard       # 開始困難模式
```

## 依賴
- `CmdBase` from `./CmdBase.js`
- `term`, `system` from `../system/sys.js`
- `bold`, `red`, `green`, `cyan`, `yellow`, `white`, `gray` from `../util/sgr.js`
- `CURSOR_HIDE`, `CURSOR_SHOW` from `../util/sgr.js`
- `shuffle`, `pickRandom` from `../util/random.js`
- `defaultGridMove` from `../util/select-grid.js`（用於難度選擇）

## 測試
- 僅限手動瀏覽器測試（遵循專案慣例）
- 驗證項目：難度選擇、格子顯示、游標導航、數字輸入、自動檢查錯誤、計時器、提示、新遊戲、離開、Ctrl+C 中斷
