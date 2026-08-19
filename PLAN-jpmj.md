# jpmj 指令計畫書

## 概述

將 `buffalobill-taiwan/jpmj` 的完整日本麻將遊戲移植到 htmlterm，作為 `jpmj` 指令。
遊戲邏輯（牌、牌山、役種、計分、6種AI）幾乎逐行移植，改為 ES module + CmdBase/VirtualBuffer 架構。
終端顯示使用 **2col×2row** 的牌面格式，qkmj 風格四人佈局。

## 牌面顯示

### 玩家/對家格式：2col×2row

每張牌占 2col×2row（垂直排列）：

```
一    東    發
萬    （空） （空）
```

- 數牌topRow：一二三四五六七八九，bottomRow：萬/筒/索
- 字牌topRow：東南西北中發白，bottomRow：空白

### 上家/下家格式：4col×1row

每張牌占 4col×1row（水平排列）：

```
一萬   東（空）  ▒▒▒▒
```

- 數牌：數字(2col) + 花色(2col) = 4col
- 字牌：字(2col) + 空(2col) = 4col
- 蓋牌（暗槓中間張）：▒▒(2col) + ▒▒(2col) = 4col

### 牌面常數
```
NUM_CHARS  = '一二三四五六七八九'
SUIT_CHARS = { man:'萬', pin:'筒', sou:'索' }
HONOR_CHARS = ['東','南','西','北','白','發','中']
```

### 配色

| 花色 | 顏色 | SGR | helper |
|---|---|---|---|
| 萬子 man | 紅色 | 31 | `red` |
| 筒子 pin | Cyan | 36 | `cyan` |
| 索子 sou | 綠色 | 32 | `green` |
| 風牌 wind | 黃色 | 33 | `yellow` |
| 三元牌 dragon | 紫色 | 35 | `magenta` |

套用範例：
- 數牌topRow（數字）：沿用花色顏色
- 數牌bottomRow（萬/筒/索）：沿用花色顏色
- 字牌topRow（東南西北中發白）：風牌黃色、三元牌紫色
- 牌背 `▒▒`：dim（灰色）

```js
function tileFg(suit, value) {
    if (suit === 'honor') return value <= 4 ? 33 : 35;  // 風牌黃、三元紫
    return { man: 31, pin: 36, sou: 32 }[suit];         // 萬紅、筒青、索綠
}
```

### 副露底色

副露之間無間隔，用底色區分不同副露組。3 種色系（吃/碰/槓）× 4 個亮度層級 = 12 個底色。

256 色立方體取色，隨著同色系內第幾次呼叫而調亮：

#### 色系 A — 吃（chi）：藍色系

| 次數 | 色碼 | hex | 亮度 |
|---|---|---|---|
| 第1次 | `b17` | `#00005f` | 最暗 |
| 第2次 | `b18` | `#000087` | 暗 |
| 第3次 | `b19` | `#0000af` | 中 |
| 第4次 | `b20` | `#0000d7` | 亮 |

#### 色系 B — 碰（pon）：綠色系

| 次數 | 色碼 | hex | 亮度 |
|---|---|---|---|
| 第1次 | `b22` | `#005f00` | 最暗 |
| 第2次 | `b28` | `#008700` | 暗 |
| 第3次 | `b34` | `#00af00` | 中 |
| 第4次 | `b40` | `#00d700` | 亮 |

#### 色系 C — 槓（kan）：紫色系

| 次數 | 色碼 | hex | 亮度 |
|---|---|---|---|
| 第1次 | `b53` | `#5f005f` | 最暗 |
| 第2次 | `b54` | `#5f0087` | 暗 |
| 第3次 | `b55` | `#5f00af` | 中 |
| 第4次 | `b56` | `#5f00d7` | 亮 |

#### 實作

```js
const MELD_BG = {
    chi:  [17, 18, 19, 20],   // 藍色系 b17-b20
    pon:  [22, 28, 34, 40],   // 綠色系 b22-b40
    kan:  [53, 54, 55, 56],   // 紫色系 b53-b56
};

function meldBg(type, callIndex) {
    const colors = MELD_BG[type];
    return colors[Math.min(callIndex, colors.length - 1)];
}
```

`callIndex` 是該色系內的第幾次呼叫（同色系內累計），不是全部副露的第幾個。

### 捨牌區底色

| 位置 | 玩家 | 底色 | 色碼 |
|---|---|---|---|
| 左下 | 玩家 | 純黑（預設） | — |
| 右上 | 對家 | 純黑（預設） | — |
| 左上 | 上家 | 深灰 | `b235` `#5f5faf` |
| 右下 | 下家 | 深灰 | `b235` `#5f5faf` |

```js
const DISCARD_BG = {
    self: 0,      // 純黑
    toimen: 0,    // 純黑
    kamicha: 235, // 深灰 b235
    shimocha: 235, // 深灰 b235
};
```

## 輸入方案 — 光棒 + Enter

**核心原則：** 所有操作透過 ←→ 移動光棒、↑↓ 切換區域、Enter 確認，不需記憶字母快捷鍵。

### 鍵位總覽

| 按鍵 | 功能 |
|---|---|
| ←→ | 在當前區域內移動光棒（手牌或動作列） |
| ↑ | 從手牌跳到動作列 |
| ↓ | 從動作列跳到手牌 |
| Enter | 確認當前光棒位置的動作 |
| ESC | 取消/返回（子選單→手牌、動作列→手牌） |

### 光棒顯示規則

光棒**只在玩家需要做選擇時才顯示**：

| 狀態 | 光棒顯示 |
|---|---|
| 玩家需要做選擇（捨牌/鳴牌/立直等） | ✅ 顯示 |
| AI出牌中、電腦對手思考中 | ❌ 隱藏 |
| 託管模式（auto-play） | ❌ 隱藏（AI自動操作） |
| 遊戲結束 | ❌ 隱藏（顯示結果覆蓋层） |
| 暫停中 | ❌ 隱藏 |

判斷條件：`game.waitingHuman === true && !autoPlay` 時才渲染光棒。
其他時候手牌和動作列照常顯示，只是沒有光棒高亮。

### 完整狀態機

```
[摸牌後]
  ├── 可ツモ 或 可立直 → [動作列模式]（光棒在動作列）
  └── 不可ツmo 且 不可立直 → [手牌模式]（光棒停在新摸的牌）

[動作列模式]（光棒在動作列，提示玩家有特殊動作）
  ←→ 在可用動作間切換
  ↓ → [手牌模式]（跳到手牌，進入正常捨牌）
  Enter on [ツmo] → 和了
  Enter on [立直] →
    ├── 可切牌只有1張 → 直接宣告立直，打出該牌
    └── 可切牌有2張以上 → [立直選牌模式]
  Enter on [過] → [手牌模式]（光棒跳到新摸的牌）
  ESC → [手牌模式]（等同選[過]）

[手牌模式]（光棒在手牌）
  ←→ 在手牌間移動
  ↑ → [動作列模式]（跳回動作列，如果有的話）
  Enter →
    ├── 該牌可暗槓（4張同牌）→ [子選單: 暗槓 / 切る]
    ├── 該牌可加槓（已有open triplet）→ [子選單: 加槓 / 切る]
    └── 否則 → 直接捨牌

[立直選牌模式]（可切牌有2張以上時才進入）
  動作列顯示「▶ 立直中 ◀」
  手牌只有切了會聽的牌可選（其他灰色不可選）
  ←→ 在可切牌間移動
  Enter → 立直成立，扣1000點，打出該牌
  ESC → [動作列模式]（取消立直，回到動作列）

[等待鳴牌]
  光棒在動作列 ←→ 循環: 過 | ロン | ポン | チー | カン
  ↓ → [手牌模式]（跳到手牌，若需要捨牌）
  Enter = 執行選中動作
  Enter on 過 = 跳過
  Enter on チー + 多組 → 子選單（↑↓選組合, Enter確認, ESC=回到動作列）
  Enter on ポン/ロン → 執行

[子選單]（暗槓/加槓 選擇 或 吃牌組合選擇）
  ↑↓ 切換選項（↑↓ 因為子選單是垂直排列）
  Enter = 確認
  ESC = 取消（吃牌子選單→回到動作列光棒，暗槓/加槓→回到手牌光棒）

[立直後自動]
  摸牌後若可ツmo → 動作列
  否則 → AI 或玩家自動打出
```

### 光棒初始位置規則

| 時機 | 光棒位置 | 原因 |
|---|---|---|
| 摸牌後可ツmo/可立直 | **動作列** | 提示玩家有特殊動作可選 |
| 摸牌後不可ツmo/不可立直 | **新摸的牌** | 直接進入捨牌模式 |
| 鳴牌後需要捨牌 | **手牌最右（新空位）** | 正常捨牌 |
| 選了[過]從動作列 | **新摸的牌** | 進入正常捨牌 |
| 進入立直模式 | **手牌**（只亮可切的牌） | 選擇立直切牌 |

### 立直規則

**可切牌只有1張：** Enter on [立直] 直接宣告立直並打出該牌，無需選牌。

**可切牌有2張以上：** Enter on [立直] 進入選牌模式：
- 手牌只有可切的牌亮著（其他灰色不可選）
- ←→ 選擇要切的牌
- Enter = 立直成立，扣1000點，打出該牌
- ESC = 取消立直，回到動作列（可以反悔）

### 暗槓/加槓子選單

當手牌光棒所在牌可槓時，Enter 不直接捨牌，而是彈出小型子選單：

```
          ┌──────────┐
          │  暗槓    │
          │  切る    │
          └──────────┘
```

- ←→ 在 [暗槓] / [切る] 間切換
- Enter 確認
- ESC 取消（回到手牌光棒）

判斷時機：
```
手牌光棒 Enter
  ├── 該牌key在手牌中有4張 → [子選單: 暗槓 / 切る]
  ├── 該牌key在已有open triplet中 → [子選單: 加槓 / 切る]
  └── 否則 → 直接捨牌
```

### 吃牌組合選擇子選單

當玩家選擇 [チー] 且有多種組合時，彈出 overlay 子選單。

範例：手牌有三四六七萬，捨牌是五萬 → 三種吃法：
```
          ┌──────────────────┐
          │  吃牌選擇         │
          ├──────────────────┤
          │ ▶ 三 四 五       │ ← 選中 (inverse)
          │   萬 萬 萬       │
          │                  │
          │   四 五 六       │
          │   萬 萬 萬       │
          │                  │
          │   五 六 七       │
          │   萬 萬 萬       │
          └──────────────────┘
```

- 每個選項佔 6cols × 2rows（牌直立顯示，和手牌格式相同）
- ↑↓ 切換選項
- Enter 確認 → 執行吃牌
- ESC 取消 → 關閉子選單，光棒回到動作列的 [チー] 上
  - 玩家可再 Enter 重新打開子選單
  - 或 ←→ 換到其他動作
  - 或再 ESC → 跳過（= 過）

#### ESC 行為差異

| 子選單類型 | ESC 行為 |
|---|---|
| 吃牌組合選擇 | 回到動作列光棒（可再選吃/其他動作） |
| 暗槓/加槓選擇 | 回到手牌光棒 |

### 字母快捷鍵（僅保留少量）

| 按鍵 | 功能 |
|---|---|
| `↑↓` | 手牌↔動作列切換 |
| `←→` | 區域內光棒移動 |
| `Enter` | 確認 |
| `ESC` | 取消/返回 |
| `a` | 切換 auto-play（託管模式，AI 代替玩家） |
| `p` | 暫停 |
| `q` / Ctrl+C | 退出遊戲 |

## 佈局設計（80×25）

整體分為左側主遊戲區（44×21）和右側資訊欄（36×21）。

### 左側主遊戲區（44×21, Col 0-43, Row 0-20）

四個玩家牌區貼在一起，中間形成捨牌區。

#### 牌區矩形

| 區域 | 左上角 | 大小 | 座標範圍 |
|---|---|---|---|
| 對家牌區 | (0, 0) | 40×2 | Col 0-39, Row 0-1 |
| 上家牌區 | (0, 2) | 4×18 | Col 0-3, Row 2-19 |
| 下家牌區 | (40, 0) | 4×18 | Col 40-43, Row 0-17 |
| 玩家牌區 | (4, 17) | 40×3 | Col 4-43, Row 17-19 |

```
     Col 0-3   Col 4-39          Col 40-43
     ┌────┬──────────────────────┬────┐ Row 0
     │    │      對家 40×2       │下家│
     ├────┤                      │    │ Row 1
     │    │                      │    │
     │上家│       空白           │ 4×18
     │    │                      │    │
     │4×18│                      │    │
     │    │  ┌──────────────────┐│    │ Row 17
     │    │  │    玩家 40×3     ││    │
     │    │  │                  ││    │
     └────┘  └──────────────────┘└────┘ Row 19
```

#### 捨牌區（中間空白 Col 4-39, Row 2-16 = 36×15）

分成四個 18×6 矩形，各放一家捨牌：

| 捨牌組 | 位置 | 座標 |
|---|---|---|
| 對家（左上） | Col 4-21, Row 2-7 | 18×6 |
| 下家（右上） | Col 22-39, Row 2-7 | 18×6 |
| 上家（左下） | Col 4-21, Row 8-13 | 18×6 |
| 玩家（右下） | Col 22-39, Row 8-13 | 18×6 |
| 空白 | Col 4-39, Row 14-16 | 36×3 |

```
     Col 4-21            Col 22-39
    ┌─────────────────┬─────────────────┐ Row 2-7
    │ 對家捨牌 18×6   │ 下家捨牌 18×6   │
    │ (左上)          │ (右上)          │
    ├─────────────────┼─────────────────┤ Row 8-13
    │ 上家捨牌 18×6   │ 玩家捨牌 18×6   │
    │ (左下)          │ (右下)          │
    └─────────────────┴─────────────────┘
                     Row 14-16: 空白
```

所有捨牌直立顯示（number row + suit row）：
```
一   二   三   四   五   六    ← Row N: 數字
萬   萬   筒   筒   索   索    ← Row N+1: 花色
```

每格 18×6 = 6cols×3rows = 18張牌，四格共72張。

### 右側資訊欄（36×21, Col 44-79, Row 0-20）

```
     Col44                                       Col79
     ┌──────────────────────────────────┐ Row 00
     │           ┌──────────┐           │
     │           │  東1局    │           │ Row 01
     │           │  0本場    │           │
     │           └──────────┘           │ Row 02
     │  ドラ:  一  ▒▒  ▒▒  ▒▒  ▒▒     │ Row 03
     │         萬                       │ Row 04
     │        ▒▒  ▒▒  ▒▒  ▒▒  ▒▒     │ Row 05
     │                                  │ Row 06
     │  ─────────────────────────────── │ Row 07
     │  東 對家  親    25000            │ Row 08
     │  南 下家        25000            │ Row 09
     │  西 上家  立直  25000            │ Row 10
     │  北 あなた      25000            │ Row 11
     │  ─────────────────────────────── │ Row 12
     │  残り: 55枚                      │ Row 13
     │  供托: 0本                       │ Row 14
     │  本棒: 0                         │ Row 15
     │  ─────────────────────────────── │ Row 16
     │  > 下家 摸牌                     │ Row 17
     │  > 上家 打 一萬                  │ Row 18
     │  > あなた ツモ                   │ Row 19
     │  >                              │ Row 20
     └──────────────────────────────────┘
```

#### 資訊欄內容

| Row | Content |
|---|---|
| 0-2 | 局名（東1局 0本場） |
| 3-6 | 寶牌指示牌（top dora 2rows + hidden dora 2rows），直立顯示，5 per row |
| 7 | 分隔線 |
| 8-11 | 四家資訊：座風 + 名字 + 莊家(親) + 立直(立直) + 點數 |
| 12 | 分隔線 |
| 13-15 | 殘牌數、供托、本棒 |
| 16 | 分隔線 |
| 17-20 | Log 區（最近4條遊戲事件） |

#### 玩家資訊row format

```
東 對家  親    25000    ← 座風 + 名字 + 莊家標記 + 點數
南 下家        25000    ← 非莊家、非立直時留空
西 上家  立直  25000    ← 立直時顯示「立直」
北 あなた      25000
```

### 牌面渲染

```js
// 玩家/對家：2col×2row
_writeTile2x2(vb, row, col, tile, opts) {
  vb.writeStr(row,   col, tile.displayTop);    // 2col
  vb.writeStr(row+1, col, tile.displayBottom); // 2col
}

// 上家/下家：4col×1row（數字+花色水平排列）
_writeTile1x4(vb, row, col, tile, opts) {
  vb.writeStr(row, col, tile.displayHorizontal); // 4col: 數字+花色
}
```

- 選中牌：inverse 背景
- 摸到的牌：cyan 前景 + 與手牌分隔1col/1row gap
- 立直牌：yellow
- 副露牌：dim
- 不可選牌（立直模式中）：gray 前景

### 手牌顯示格式

[手牌] [1col gap] [新抽牌] [1col gap] [副露]（無間隔緊密相鄰）

玩家手牌在 Row 17-19（玩家牌區 40×3）：
```
Row 17: 動作列
Row 18: 一  二  三  四  五  六  七  八  九  東  南  西  北  中   五   一萬 二筒 三索
Row 19: 萬  萬  萬  筒  筒  筒  索  索  索                      筒
        ←───手牌（無間隔）───→  ↑新牌 →←───副露（無間隔）───→
```

### 對家手牌格式

[副露] [1col gap] [新抽牌] [1col gap] [手牌]（左右顛倒，手牌蓋著）

### 上家/下家手牌格式

每張牌以**橫向**顯示：數字+花色水平排列，佔4col。
上家牌區 Col 0-3 剛好4col = 1張牌寬度，下家牌區 Col 40-43 同理。
1張牌 = **1rows**，牌與牌之間**無間隔**，自上而下堆疊。

牌面格式（4col）：
```
數字(2col) + 花色(2col) = 4col     例：一萬, 二筒, 三索
字牌：字(2col) + 空(2col) = 4col   例：東（空）, 白（空）
蓋牌：▒▒(2col) + ▒▒(2col) = 4col  例：▒▒▒▒
```

**上家（左側 Col 0-3, 4col 寬）：**
排列：手牌 → 新抽牌 → 副露（從上到下）
```
Row 0:  一萬       ← 手牌第1張
Row 1:  二筒       ← 手牌第2張
Row 2:  三索       ← 手牌第3張
...
Row 12: 九萬       ← 手牌第13張
Row 13: 東（空）    ← 新抽牌
Row 14: 東（空）    ← 副露(暗槓第1張)
Row 15: ▒▒▒▒       ← 副露(暗槓第2張，蓋牌)
Row 16: ▒▒▒▒       ← 副露(暗槓第3張，蓋牌)
Row 17: 東（空）    ← 副露(暗槓第4張)
```

**下家（右側 Col 40-43, 4col 寬）：**
排列：副露 → 新抽牌 → 手牌（從上到下，與上家相反）
```
Row 0:  東（空）    ← 副露(暗槓第1張)
Row 1:  ▒▒▒▒       ← 副露(暗槓第2張，蓋牌)
Row 2:  ▒▒▒▒       ← 副露(暗槓第3張，蓋牌)
Row 3:  東（空）    ← 副露(暗槓第4張)
Row 4:  東（空）    ← 副露(碰第1張)
...
Row 13: 九萬       ← 手牌最後張
Row 14: 東（空）    ← 新抽牌
Row 15: 一萬       ← 手牌第1張
Row 16: 二筒       ← 手牌第2張
Row 17: 三索       ← 手牌第3張
```

#### 空間驗證

側家固定：手牌張數 + 新抽牌 + 副露張數 = 14張 = 14rows ✅ within 18rows
極限（4副露 + 1手牌 + 1新抽）：15張 = 15rows ✅

### 副露顯示規則

副露組與手牌之間有1col/1row gap，**副露組與副露組之間無間隔**。

每副露類型顯示：

| 副露類型 | 牌數 | 顯示 |
|---|---|---|
| 吃（チー） | 3 | 3張，直入那張 dim 標記 |
| 碰（ポン） | 3 | 3張，直入那張 dim 標記 |
| 明槓 | 4 | 4張，直入那張 dim 標記 |
| 暗槓 | 4 | 第1、4張正面，第2、3張顯示 `▒▒` |
| 加槓 | 4 | 原碰3張 + 加槓1張（正面，dim） |

#### 各玩家副露排列方向

| 玩家 | 牌面格式 | 方向 | 排列順序 |
|---|---|---|---|
| 玩家 | 2col×2row | 水平（左→右） | 手牌 → 1col gap → 副露（組內無間隔） |
| 對家 | 2col×2row | 水平（左→右） | 副露 → 1col gap → 手牌（正常順序，不顛倒） |
| 上家 | 4col×1row | 垂直（上→下） | 手牌 → 新抽牌 → 副露（組內無間隔） |
| 下家 | 4col×1row | 垂直（上→下） | 副露 → 新抽牌 → 手牌（正常順序） |

### 手牌置中規則

**關鍵原則：** 計算置中位置時，把新抽牌也算進去。這樣抽牌時手牌不會抖動。

#### 上家/下家（垂直置中於18-row space）

每張牌 = 1rows，無間隔。
```
totalRows = 手牌張數 + 1(新抽牌) + 副露總張數
startRow = floor((18 - totalRows) / 2)
```

範例（門清13張）：totalRows=14, startRow=2, span Row 2-15
範例（3副露9張 + 4手牌 + 1新抽）：totalRows=14, startRow=2, span Row 2-15
範例（4槓13張 + 1手牌 + 1新抽）：totalRows=15, startRow=1, span Row 1-15

#### 玩家/對家（水平置中於40col space）

```
totalCols = 手牌張數×2 + 1(間隔) + 2(新抽牌) + 1(間隔) + meldCols
startCol = floor((40 - totalCols) / 2)
```

#### 防抖動效果

因為置中基準包含了新抽牌：
- 摸牌時：手牌位置不變，新抽牌出現在預留位置
- 捨牌時：手牌位置不變，空位在邊緣
- 永遠不會因為抽/打牌導致整個手牌平移

### 動作列渲染

位於玩家牌區 Row 17（Col 4-43）：
```
┌──────────────────────────────────────────┐
│  過   ツモ   ロン   ポン   チー   立直     │
└──────────────────────────────────────────┘
```

- 只顯示當前可用的動作
- 光棒高亮（inverse）當前選項
- [過] 永遠在最左
- ←→ 循環跳轉

### 得分/流局畫面（overlay 在捨牌區）

Overlay 位置：Col 4-39, Row 2-16（36×15）。overlay 內只放計分資訊，
手牌和寶牌在 overlay 外展示（各玩家牌區公開手牌，資訊欄翻開裏ドラ）。

#### 和了時

```
 Col 4                                             Col 39
 ┌────────────────────────────────────┐
 │                                    │ Row 2
 │       和了！ 東家(あなた) ツモ     │ Row 3
 │                                    │ Row 4
 │  平和 門前清自摸                    │ Row 5
 │  2翻30符  8000点(3000・1000)       │ Row 6
 │                                    │ Row 7
 │  下家→あなた: 3000                 │ Row 8
 │  上家→あなた: 1000                 │ Row 9
 │  對家→あなた: 1000                 │ Row 10
 │                                    │ Row 11
 │        ENTER で次の局へ            │ Row 12
 │                                    │
 │                                    │
 └────────────────────────────────────┘
```

| Row | Content |
|---|---|
| 3 | 標題：誰和了 + 自摸/榮和 |
| 5 | 役種列表（水平排列，不顯示翻數，一行塞不下自動換行） |
| 6 | 合計翻符 + 點數（子摸/親摸顯示不同支付方式） |
| 8-10 | 支付明細（誰付給誰多少） |
| 12 | 操作提示 |

#### 流局時

```
 Col 4                                             Col 39
 ┌────────────────────────────────────┐
 │                                    │
 │           流局 — 聽牌              │ Row 3
 │                                    │
 │  東家 聽牌  南家 不聽              │ Row 5
 │  西家 聽牌  北家 不聽              │ Row 6
 │                                    │
 │        ENTER で次の局へ            │ Row 8
 │                                    │
 └────────────────────────────────────┘
```

## 檔案結構

### 新增目錄 `js/cmd/jpmj/`

| 檔案 | 約行數 | 內容 |
|---|---|---|
| `index.js` | 2 | barrel export |
| `JpmjCmd.js` | ~900 | CmdBase 子類：execute, _onKey, _render, 遊戲迴圈, UI |
| `tiles.js` | ~90 | Tile 類別, displayTop/Bottom, displayHorizontal, sort, countMap |
| `wall.js` | ~60 | 牌山管理：shuffle, deal, draw, dora, rinshan |
| `yaku.js` | ~750 | 全部役種判定 + 符數計算 + 計分 |
| `game.js` | ~650 | 遊戲狀態機：階段管理、副露、立直、和了、流局 |
| `ai_base.js` | ~250 | AI 基礎類別：向聽估算、危險度、目標評估 |
| `ai_beginner.js` | ~50 | 初學者 AI |
| `ai_normal.js` | ~100 | 一般人 AI |
| `ai_expert.js` | ~130 | 高手 AI |
| `ai_kokushi.js` | ~70 | 國士命 AI |
| `ai_tanyao.js` | ~100 | 斷么廚 AI |
| `ai_menzen.js` | ~70 | 門清俠 AI |
| `ai_factory.js` | ~20 | AI 工廠 |

### 修改檔案

| 檔案 | 改動 |
|---|---|
| `js/cmd/index.js` | +1rows `export { JpmjCmd } from './jpmj/index.js';` |

**預估totalRows：~3250rows**

## 原始碼重用分析

來源：`buffalobill-taiwan/jpmj`（~2800rows）

### ✅ 直接可用（純邏輯，零 DOM 耦合）

| 檔案 | 行數 | 重用率 | 改動 |
|---|---|---|---|
| `yaku.js` | ~1300 | 95% | ES module 化即可。`evaluateHand`、`getWaitingTiles`、`checkTenpai`、`canFormCompleteHand`、30+ 役種檢查器、`calculateFu`、`calculatePayments`、`countDora`、`getCounts`、`removeTiles`、`decomposeMelds` 等全部保留 |
| `wall.js` | ~60 | 100% | ES module 化即可。`shuffle()`、`deal()`、`draw()`、`drawRinshan()`、`getDoraIndicators()` 等 |
| `ai_base.js` | ~280 | 100% | ES module 化即可。`MahjongAI` 基底類別：`estimateShanten`、`countBlocks`、`solveSuitDP`、`tileDangerLevel`、`evaluateTargets` 等 |
| `ai_factory.js` | ~25 | 100% | ES module 化即可 |
| `ai_beginner.js` | ~65 | 100% | ES module 化即可 |
| `ai_normal.js` | ~100 | 100% | ES module 化即可 |
| `ai_expert.js` | ~110 | 100% | ES module 化即可 |
| `ai_kokushi.js` | ~90 | 100% | ES module 化即可 |
| `ai_tanyao.js` | ~115 | 100% | ES module 化即可 |
| `ai_menzen.js` | ~60 | 100% | ES module 化即可 |

**合計 ~2150rows（77%）只需加 `export`/`import`，邏輯零改動。**

### ⚠️ 需適配

| 檔案 | 行數 | 保留 | 移除/改寫 |
|---|---|---|---|
| `tiles.js` | ~120 | `Tile` 核心：constructor、`key()`、`equals()`、`isTerminal/isHonor/isSangen/isWind`、`sortTiles()`、`countMap()`、`fromString()`、`allTiles()`、`SUIT_ORDER`、`NAME_MAP` | 移除 `codePoint` getter（U+1F000+ 麻將碼，禁用）、`char` getter（依賴 codePoint）。新增 `displayHorizontal` getter 供 1×4 牌面渲染 |
| `game.js` | ~1700 | 核心引擎全部保留：`advance()` 狀態機、`executeDiscard`、`executeCall`（pon/chi/kan）、`executeWin`、`applyScore`、流局處理（四風連打/四槓散了/四家立直/三家和/九種九牌/荒牌）、`buildAvailableCalls`、`isFuriten`、`getGameState`、`roundResult`、`getFinalScores`、log 系統 | 移除所有 `isHuman` 分支的 HTML 按鈕邏輯（`availableActions` 陣列中的按鈕標籤）。替換為：我們自己的游標輸入路由。`advance()` 回傳值 `true` = 需要玩家輸入，完美對應 `game.waitingHuman` |
| `main.js` | ~800 | 控制流程邏輯可參考：`continueGame()` 迴圈模式（advance → roundOver → showResult → nextRound）、`processAutoPlay()` 邏輯 | 整個 DOM 渲染全部改寫為 VB 渲染器 |

### ❌ 不可用

| 檔案 | 原因 |
|---|---|
| `tiles.js` codePoint/char | 使用麻將 Unicode U+1F000+，專案明確禁用 |
| `main.js` DOM 渲染 | 全部 `document.createElement`、`innerHTML`、CSS class、事件監聽 — 與 htmlterm 完全不相容 |

### 目標模組結構

```
js/cmd/jpmj/
├── index.js         ← NEW: barrel export
├── JpmjCmd.js       ← NEW: CmdBase 子類，VB 渲染，游標輸入
├── tiles.js         ← 從 tiles.js（移除 codePoint/char，加 displayHorizontal）
├── wall.js          ← 從 wall.js（ES module，無改動）
├── yaku.js          ← 從 yaku.js（ES module，無改動 — 最大紅利）
├── game.js          ← 從 game.js（移除 isHuman UI 分支，保留引擎）
├── ai_base.js       ← 從 ai_base.js（ES module）
├── ai_beginner.js   ← 從 ai_beginner.js（ES module）
├── ai_normal.js     ← 從 ai_normal.js（ES module）
├── ai_expert.js     ← 從 ai_expert.js（ES module）
├── ai_kokushi.js    ← 從 ai_kokushi.js（ES module）
├── ai_tanyao.js     ← 從 ai_tanyao.js（ES module）
├── ai_menzen.js     ← 從 ai_menzen.js（ES module）
└── ai_factory.js    ← 從 ai_factory.js（ES module）
```

### 移植步驟

1. **tiles.js** — 複製，移除 codePoint/char，加 displayHorizontal/displayTop/displayBottom，ES module 化
2. **wall.js** — 複製，ES module 化
3. **yaku.js** — 複製，ES module 化（依賴 tiles.js 的 Tile）
4. **ai_base.js** — 複製，ES module 化（依賴 tiles.js + yaku.js 的 helper）
5. **ai_*.js + ai_factory.js** — 複製，ES module 化
6. **game.js** — 複製，移除 isHuman UI 分支，ES module 化
7. **JpmjCmd.js** — 全新撰寫：CmdBase 子類、VB 渲染、游標輸入、設定畫面、結果覆蓋層
8. **index.js** — barrel export

### 保留的完整功能

- 136張牌（無花牌、無赤牌）
- 全部役種：立直、一發、雙立直、門前清自摸、平和、斷幺九、一盃口、二盃口、役牌、嶺上開花、槍槓、海底/河底、三色同順/同刻、一氣通貫、混/純全帯么九、對々和、三暗刻、混老頭、小三元、三槓子、七對子、混一色、清一色
- 全部役滿：天和、地和、國士無雙、大三元、四暗刻、字一色、綠一色、清老頭、九蓮寶燈、四槓子、大四喜、小四喜
- 6種 AI 類型
- 流局處理：九種九牌、四風連打、四槓散了、四家立直、三家和、荒牌流局
- 連莊/輪莊
- 頭跳（Atama-hane）、三家和了流局（Sancha-ron）
- 搶槓（Chankan）for 國士無雙
- 託管模式

## 起始設定畫面

使用 `SettingsDialog`（繼承 `Dialog`），cleared screen 背景，居中單線邊框。

### 主面板佈局（SettingsDialog, 40col）

```
┌──────────────────────────────┐
│       jpmj — 日本麻將         │  ← title
├──────────────────────────────┤
│                              │
│  ▶ 對戰長度    東風（4局）    │  ← settings[0] (selected)
│    上家 AI     一般人         │  ← settings[1]
│    對家 AI     高手           │  ← settings[2]
│    下家 AI     初學者         │  ← settings[3]
│    託管 AI     一般人         │  ← settings[4]
│    起始座位    隨機           │  ← settings[5]
│                              │
│  ────────────────────────── │  ← separator (row 8)
│    ▶ 開始                   │  ← start button (row 10)
│                              │
├──────────────────────────────┤
│  ↑↓ Move  ↩ Select  ESC Quit │  ← footer
└──────────────────────────────┘
```

Height = 13 rows（title 2 + separator 1 + 6 settings + blank 1 + separator 1 + blank 1 + start 1 + footer 2）。

### 交互方式

- **↑↓** 在 6 個設定 + [開始] 間移動光棒（共 7 個位置，跳过分隔线）
- **Enter** on 設定 → 開子選單
- **Enter** on [開始] → `onStart(settings)`
- **ESC** → `onCancel()`

### 子選單

根據選項數量使用不同 Dialog：

| 設定 | 選項數 | 子選單類型 | 導航 |
|---|---|---|---|
| 對戰長度 | 3 | `SelectDialog` | ←→ 水平 |
| 上家 AI | 6 | `VerticalSelectDialog` | 3×2 grid ↑↓←→ |
| 對家 AI | 6 | `VerticalSelectDialog` | 3×2 grid ↑↓←→ |
| 下家 AI | 6 | `VerticalSelectDialog` | 3×2 grid ↑↓←→ |
| 託管 AI | 6 | `VerticalSelectDialog` | 3×2 grid ↑↓←→ |
| 起始座位 | 5 | `SelectDialog` | ←→ 水平 |

子選單行為：
- Enter 確認 → 回寫 `settings[key].value`，關閉子 dialog
- ESC 取消 → 關閉子 dialog，值不變
- SettingsDialog 仍可見（疊在底下），子 dialog 覆蓋其上

### VerticalSelectDialog 佈局（3×2 grid, 36col）

```
┌──────────────────────────────┐
│         Select AI             │  ← title
├──────────────────────────────┤
│                              │
│  ▶ 初學者    一般人    高手   │  ← row 0
│    國士命    斷么廚    門清俠  │  ← row 1
│                              │
├──────────────────────────────┤
│  ↑↓←→ Move  ↩ Confirm  ESC   │  ← footer
└──────────────────────────────┘
```

- 3 col × 2 row 網格，每格固定寬度（最長選項 + padding）
- ↑↓ 換 row，←→ 換 col
- 邊界不 wrap（到端就停）
- 選中項 inverse bold
- Enter → `onSelect(index)`
- ESC / Ctrl+C → `onCancel()`

### SelectDialog 用於≤5 選項

沿用現有 `SelectDialog`（←→ 水平），用於：
- 對戰長度（3 選項）：`東風（4局）` / `半莊（8局）` / `全莊（16局）`
- 起始座位（5 選項）：`隨機` / `東` / `南` / `西` / `北`

### 設定項目與預設值

| 設定 | 選項 | 預設值 |
|---|---|---|
| 對戰長度 | 東風（4局）/ 半莊（8局）/ 全莊（16局） | 東風 |
| 上家 AI | 初學者 / 一般人 / 高手 / 國士命 / 斷么廚 / 門清俠 | 一般人 |
| 對家 AI | 初學者 / 一般人 / 高手 / 國士命 / 斷么廚 / 門清俠 | 一般人 |
| 下家 AI | 初學者 / 一般人 / 高手 / 國士命 / 斷么廚 / 門清俠 | 一般人 |
| 託管 AI | 初學者 / 一般人 / 高手 / 國士命 / 斷么廚 / 門清俠 | 一般人 |
| 起始座位 | 隨機 / 東 / 南 / 西 / 北 | 隨機 |

### localStorage 記憶

每次按 [開始] 進入對局時，將設定存入 localStorage：

```js
// key: 'jpmj_settings'
{
  gameLength: 'east',    // 'east' | 'half' | 'full'
  aiLeft: 'normal',      // 'beginner'|'normal'|'expert'|'kokushi'|'tanyao'|'menzen'
  aiAcross: 'expert',
  aiRight: 'beginner',
  autoPlayAI: 'normal',
  seat: 'random'         // 'random'|'east'|'south'|'west'|'north'
}
```

下次啟動時讀取，套用上次的設定。無存檔時用預設值。

### 新增 Dialog 檔案

| 檔案 | 內容 |
|---|---|
| `js/dialog/VerticalSelectDialog.js` | 3×2 grid 選擇 Dialog |
| `js/dialog/SettingsDialog.js` | jpmj 設定面板 Dialog |

## JpmjCmd.js 架構

### execute() 流程

```
this.open()
→ term.write('\x1B[2J\x1B[1;1H')  // cleared screen
→ term.write(CURSOR_HIDE)
→ new SettingsDialog(term, { settings, onStart, onCancel })
→ dialog.open()
→ this._settingsDialog = dialog
→ 等待玩家操作 _onKey → dialog.handleKey(data)
→ 玩家選[開始] → onStart(settings) → _startGame()
→ _continueGame() — 推進遊戲
```

### 遊戲狀態

JpmjCmd 內部有一個 `_phase` 狀態機：

| phase | 說明 | 渲染 | 輸入 |
|---|---|---|---|
| `'settings'` | 起始設定畫面 | SettingsDialog overlay | dialog.handleKey（↑↓選設定, Enter開子選單或開始） |
| `'playing'` | 對局中 | _renderGame() | 手牌/動作列/子選單 |
| `'result'` | 一局結果 | _renderResult() | Enter下一局 |
| `'gameOver'` | 對局結束 | _renderGameOver() | n新遊戲, q退出 |

### _onKey() 優先級鏈

1. **_settingsDialog** → dialog.handleKey(data)（SettingsDialog 或子 SelectDialog/VerticalSelectDialog）
2. 子選單進行中（暗槓/加槓/吃牌組合） → ←→ 切換, Enter 確認, ESC 取消
3. 立直選牌模式 → ←→ 移動可切牌, Enter 確認, ESC 取消
4. Ctrl+C → _quit()
7. 遊戲結束 → `n` 新遊戲, `q` 退出
8. 暫停中 → `p` 取消暫停, `q` 退出
9. 等待鳴牌 → 動作列光棒操作（←→ + Enter）
10. 動作列模式（可ツmo/可立直） → 動作列光棒操作（←→ + Enter）
11. 手牌模式（等待捨牌） → 手牌光棒操作（←→ + Enter）

### 遊戲迴圈

```js
_continueGame() {
  if (this._game.gameOver) { this._showGameOver(); return; }
  if (this._game.roundOver) { this._showRoundResult(); return; }
  
  const needHuman = this._game.advance();
  this._render();
  
  if (needHuman && this._autoPlay) { this._processAutoPlay(); return; }
  if (!needHuman) {
    this._gameTimer = setTimeout(() => this._continueGame(), 100);
  }
  // needHuman && !autoPlay → 等待 _onKey 輸入
}
```

### 渲染

每帧重建完整 VirtualBuffer (80×25)：

**⚠️ Buffer 必須用 `createBlankBuffer`（黑底白字空白），不能用 `createEmptyBuffer`（null/透明）。**
null cell 在 overlay 合成時是透明的，會透出上一幀殘留的文字。用 `createBlankBuffer` 確保每帧全畫面黑底覆蓋，不留殘影。

```js
// 初始化（一次）
this._vb = new VirtualBuffer(W, H);
// fill with blank cells
for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
        this._vb.setCell(r, c, _blankCell);

// 每帧
_render() {
  this._clearVB();  // 用 _blankCell 填滿，不是 null
  this._renderInfoBar();
  this._renderTopOpponent();
  this._renderSideOpponents();
  this._renderDiscards();
  this._renderPlayerInfo();
  this._renderActionBar();
  this._renderHand();
  term.writeVB(this._vb);
}
```

### 暫停覆蓋

使用 addChildSlot 預配置，暫停時激活覆蓋层。

### 一局結果覆蓋

和了或流局時，顯示結果覆蓋层（役種列表、計分、支付明細）。
Enter 繼續下一局。

## 最終得分統計畫面

全場結束後顯示，full screen VB (80×25)，不含任何麻將 Unicode 字元。

### 佈局

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              最終結果                                         │
│  ──────────────────────────────────────────────────────────────────────────  │
│  順位     名前         點數      ツモ    ロン    放銃                        │
│  ──────────────────────────────────────────────────────────────────────────  │
│  1st    玩家         38,500       2      1      0                         │
│  2nd    CPU1         27,000       1      0      2                         │
│  3rd    CPU2         20,000       0      1      1                         │
│  4th    CPU3         14,500       0      0      2                         │
│  ──────────────────────────────────────────────────────────────────────────  │
│  連莊 2 ｜ 總局數 8 ｜ 流局 3 ｜ 立直棒殘留 0                               │
│  ──────────────────────────────────────────────────────────────────────────  │
│                                      按 ENTER 返回標題                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### VB row layout (80×25)

| Row | Content |
|---|---|
| 0 | `┌` + `─`×78 + `┐` |
| 1 | `│` + centered `最終結果` (bold cyan) + `│` |
| 2 | `├` + `─`×78 + `┤` |
| 3 | `│` + `  順位     名前         點數      ツモ    ロン    放銃` (bold) + `│` |
| 4 | `├` + `─`×78 + `┤` |
| 5–8 | 四家資料 row（按排名從高到低） |
| 9 | `├` + `─`×78 + `┤` |
| 10 | `│` + `  連莊 X ｜ 總局數 X ｜ 流局 X ｜ 立直棒殘留 X` + `│` |
| 11 | `├` + `─`×78 + `┤` |
| 12 | `│` + centered `按 ENTER 返回標題` (dim) + `│` |
| 13 | `└` + `─`×78 + `┘` |
| 14–24 | 空白（不使用） |

### 資料 row 格式

```
  {rank}    {name}         {score}       {tsumo}      {ron}      {dealtIn}
```

- rank: 1st / 2nd / 3rd / 4th
- name: 玩家名字（含座風）
- score: 總點數，千分位逗號
- tsumo: 自摸和了次數
- ron: 榮和和了次數
- dealtIn: 放槍次數

### SGR 樣式

| 元素 | 樣式 |
|---|---|
| 標題「最終結果」 | bold cyan |
| 表頭 row | bold |
| 第1名 row | bold yellow |
| 最後一局和了者 | bold（非第1名時才加） |
| 分隔線 | dim |
| 提示文字 | dim |

### 輸入

- **Enter** → 退出 jpmj 指令
- **ESC / Ctrl+C** → 退出 jpmj 指令

### 資料來源

從 `game.getFinalScores()` 取得排名陣列，每筆含：
- `rank`, `name`, `score`, `tsumo`, `ron`, `dealtIn`

統計摘要從 `game` 直接讀取：
- `renchanCount`（連莊次數）
- `roundCount`（總局數）
- `ryuukyokuCount`（流局次數）
- `riichiSticks`（殘留立直棒）

### 不使用任何麻將 Unicode

本指令所有畫面（牌面、設定、對局、結果）**不使用任何麻將專用 Unicode 字元**（U+1F000–U+1F02B）。
牌面以文字顯示（一二三萬 等），不使用 🀇🀈🀉 等圖像符號。
標題裝飾使用一般符號或留空，不使用 🀄 等。

## 待討論事項

> 僅剩音效，其他全部已決定：

1. **音效** — 是否需要（目前 htmlterm 無音效系統）

### 已確定的事項

- ✅ 牌面顯示：2col×2row（上：數字/字，下：花色）
- ✅ 操控方式：光棒+Enter，↑↓切換區域，無字母快捷鍵（除 a/p/q）
- ✅ 摸牌後光棒位置：可ツmo/可立直→動作列，否則→手牌
- ✅ 立直：1種切牌→直接宣告；多種切牌→選牌模式，ESC可取消
- ✅ 暗槓/加槓：手牌Enter時可槓牌彈子選單（暗槓/加槓 + 切る）
- ✅ 捨牌：手牌模式下Enter直接打出（可槓時例外）
- ✅ 鳴牌：動作列←→循環選擇
- ✅ 渲染：每帧重建完整VirtualBuffer，用 `createBlankBuffer`（黑底白字）避免上一幀殘影
- ✅ 動作列循環：←→到最右再→回最左
- ✅ [過]永遠在動作列最左
- ✅ 光棒只在等待玩家選擇時顯示（託管/電腦出牌中隱藏）
- ✅ 起始設定畫面：SettingsDialog（繼承 Dialog），居中單線邊框，cleared screen 背景
- ✅ 設定項目：對戰長度、上家/對家/下家AI、託管AI、起始座位
- ✅ 子選單：≤5 選項用 SelectDialog（←→），6 選項用 VerticalSelectDialog（3×2 grid ↑↓←→）
- ✅ 起始座位預設「隨機」
- ✅ localStorage 記憶上次設定
- ✅ 最終得分統計：full screen VB (80×25)，排名表+統計摘要，Enter 退出
- ✅ 不使用任何麻將 Unicode（U+1F000–U+1F02B），牌面全文字顯示
- ✅ 上家/下家牌面：4col×1row（數字+花色水平排列），垂直堆疊，無間隔
- ✅ 副露顯示：副露組之間無間隔，暗槓中間兩張顯示▒▒，對家副露正常順序不顛倒
- ✅ 副露排列：玩家/對家水平排列，上家/下家垂直排列（同手牌方向）
- ✅ AI自動打牌速度：固定100ms/步，不可調

## 實作困難與決策記錄

### 1. 手牌排序與新抽牌追蹤

**問題：** 原始碼在 `advance()` 中 `Tile.sortTiles(p.hand)` 會改變手牌順序，而 `p.lastDraw` 是抽到的牌的物件參考。排序後 `lastDraw` 的物件仍在手牌中，但位置已改變。

**決策：** 在 JpmjCmd 中，游標位置 `handIdx` 使用 `hand.length` 代表新抽牌（gap 之後的位置）。捨牌時透過 `p.hand.findIndex(t => t === p.lastDraw)` 找到正確的 index，而非直接用 `handLen`。這確保了即使排序後也能正確捨掉新抽的牌。

### 2. 動作列 vs 手牌游標切換

**問題：** 摸牌後可ツモ/可立直時，游標應在動作列；一般捨牌時，游標應在手牌。兩者的切換邏輯需要正確判斷。

**決策：** 在 `_continueGame()` 中，根據 `availableActions` 內容自動設定初始游標位置：
- `availableActions` 包含 call 對象或 tsumo → 動作列模式
- `availableActions === ['discard']` → 手牌模式，游標指向新抽牌

### 3. 捨牌區渲染 stride 修正

**問題：** 初版使用 stride 3（每格3cols），但牌面只有2col寬。

**修正：** 改為 stride 2，每格2cols，6張×2cols=12cols，在18列寬的捨牌組內正確排列。

### 4. 設定子選單 ESC 與方向鍵衝突

**問題：** ESC (0x1B, s.length=1) 與方向鍵 (0x1B + [A, s.length=3) 共用同一個 `code === 0x1B` 判斷。若先判斷 `s.length <= 1` 會把方向鍵也當作 ESC。

**修正：** 先判斷具體方向鍵序列，再判斷 bare ESC (`s.length <= 1`)。

### 5. game.js `processCallPhase` 與 AI 通話優先序

**問題：** `buildAvailableCalls` 回傳所有玩家的通話，排序後傳給 AI。AI 可能看到其他玩家的通話選項。

**決策：** 保留原始碼邏輯。AI 的 `decideCall` 通常只找 ron，不處理非自己的通話。但嚴格來說，如果 AI 看到不屬於自己的 pon/chi 通話，可能做出非預期決策。這是原始碼的已知限制，移植時保留。

### 6. 通話子選單（吃牌組合選擇）

**問題：** 吃牌有多種組合時需要子選單。`buildAvailableCalls` 已回傳 `chiSets` 陣列。

**決策：** 當玩家選 [チー] 且 `chiSets.length > 1` 時，顯示子選單（↑↓ 選組合，Enter 確認，ESC 取消回動作列）。子選單渲染為獨立 overlay VB。

### 7. 暗槓/加槓子選單

**問題：** 手牌 Enter 時若該牌可槓，應彈出子選單而非直接捨牌。

**決策：** 檢查 `buildAvailableKans()` 找到匹配的槓選項，顯示子選單 [暗槓/加槓] + [切る]。ESC 取消回手牌游標。

### 8. info panel 捨牌 log 顯示

**問題：** 右側資訊欄 Row 17-20 顯示最近4條遊戲事件。日誌可能包含玩家名、動作、牌名等，需截斷避免溢出。

**決策：** 限制 detail 長度為14字元，超出加 `…`。玩家名截斷為4字元。

### 9. SettingsDialog + VerticalSelectDialog 設計

**問題：** jpmj 有6個設定項，不是單選難度。`SelectDialog` 只支援 ←→ 水平，不夠用。需要自訂設定面板。

**決策：** 新建 `SettingsDialog`（繼承 `Dialog`）作為主面板，↑↓ 導航7個位置（6設定 + 開始按鈕）。子選單根據選項數量分流：
- ≤5 選項 → `SelectDialog`（←→ 水平）
- 6 選項 → `VerticalSelectDialog`（3×2 grid ↑↓←→）

### 10. SettingsDialog 子選單 cursor 初始位置

**問題：** `_openSubmenu` 計算了 `currentIdx = opts.indexOf(s.value)`，但 `SelectDialog` 和 `VerticalSelectDialog` 都沒有接受初始選中位置的參數。子選單打開時永遠從第一個選項開始。

**決策：** 這是已知 UX 缺陷，暫不處理。若要修正，需為 `SelectDialog` 和 `VerticalSelectDialog` 加 `initialSelected` 參數。

### 11. SettingsDialog 子選單的生命周期

**問題：** 子 dialog 打開時，SettingsDialog 不應關閉（overlay 仍可見）。子 dialog 的 `handleKey` 需要由 SettingsDialog 代理，而非 SyncCmdFrame。

**決策：** SettingsDialog 重寫 `handleKey()`，優先轉發給 `_childDialog`。子 dialog 關閉後，SettingsDialog 呼叫 `refreshContent()` 重繪設定值。`_childDialog = null` 作為狀態開關。

### 12. VB buffer 用 blank 而非 empty

**問題：** `createEmptyBuffer` 初始化 cell 為 `null`，overlay 合成時 null = 透明，會透出上一幀殘留文字。每帧重建 VB 時，若用 `clear()`（設回 null），殘影會持續。

**決策：** 主遊戲 VB 必須用 `createBlankBuffer`（黑底白字空白 cell），不用 `clear()`。每帧用 `_blankCell` 填滿整個 buffer，確保全畫面黑底覆蓋。

### 13. VerticalSelectDialog 3×2 grid 邊界不 wrap

**問題：** 6個選項排成 3×2 grid，↑↓←→ 到邊界時是否 wrap 到另一端？

**決策：** 不 wrap。↑↓ 到邊界就停，←→ 到邊界就停。避免使用者在 grid 中迷失方向。若選項數不是 cols 的整數倍，右下角空位自動跳過（調整 `_selCol` 使 index 不超出選項範圍）。
