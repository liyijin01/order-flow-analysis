# 任务书 C：TradingView 风格行情图与自动标注

> 仓库：https://github.com/liyijin01/order-flow-analysis
> 前置：已合并 Phase 0 与 Phase 1-2（`web/app.js`、`web/core.js`、`web/live.js`、`web/render.js`、`config/symbols.json`、`profiles-{SYMBOL}.json`（schema `profiles-v2`）、`data` 分支日度阶梯）。
> 本任务书的阶段编号为 **C0 到 C6**，和第一份任务书（Phase 0 到 7）并行，互相引用时写全编号。

---

## 0. 执行规则

1. 沿用第一份任务书 §0 的全部规则：一次只做一个阶段，完成后提交 PR、按 §12 模板汇报、停下等确认。
2. **图上不得出现交易员本人的名字、账号、署名或水印**，也不能写成 TradingView 官方截图的样式（例如"与 TradingView.com 共创"这类字样）。页脚写本项目自己的信息。
3. 自动标注只做**客观、可复现**的内容（价位、区间、剖面、指标、按规则触发的事件标记）。他图上那些主观内容（手绘的走势路径、主观打叉），只能通过 C6 的手动工具添加，引擎不自动生成。
4. 不输出任何买卖建议或交易信号文字。事件标记只描述发生了什么，例如"触及 PQ VAL"。
5. 所有画在图上的元素都必须能出现在导出的 PNG 里（见 §5.3）。

---

## 1. 目标

用户选择**币种 + 周期 + 版式**后，页面自动生成一张风格接近参考图的分析图，包括：

- 带文字标签和右轴价格标签的关键价位线（例如 `PQ VAL 1,720.55`）
- 价值区框、未回补 POC、单印区
- VP / TPO 剖面
- 季度锚定 VWAP 和标准差带
- 按规则触发的事件标记（圆圈、箭头）
- 一键导出 PNG

---

## 2. 路线选择（已确定）

| 路线 | 结论 | 原因 |
|---|---|---|
| **A. 自建页面 + TradingView Lightweight Charts** | **主线** | 开源（Apache-2.0）、免费、外观就是 TradingView 风格；可以用插件接口（primitives）画线、画框、画剖面，完全可编程，能做全自动标注 |
| **B. tradingview.com 上的 Pine 指标** | **桥接，放在 C6** | 能在真正的 TradingView 里显示同样的线。Pine 读不到外部数据，所以由本项目生成一段价位文本，用户粘贴进指标参数 |
| TradingView Advanced Charts（Charting Library） | 不采用 | 需要向 TradingView 申请授权，许可条款不允许把库放进公开仓库，而本仓库是公开的 |
| TradingView 嵌入小部件（Widget） | 不采用 | 无法程序化画线，也无法接入自己算的数据 |
| 用浏览器自动化在 tradingview.com 上画线 | 不采用 | 不稳定，也可能违反网站的服务条款 |

**依赖**：Lightweight Charts **5.x**，从 `cdn.jsdelivr.net` 按**精确版本号**加载，并加上 `integrity`（SRI）。保留库默认的 TradingView 归属标识（v5 的 `attributionLogo` 不要关）。

---

## 3. 参考版式（按他图上实际出现的样子归纳）

下面每个版式是一组图层的组合。代码里的版式 id 用中性命名，不要用他的名字。

### P1 季度价值区（参考他的 ETH 1h、SOL 1h、ETHBTC 4h）
- 默认周期 1h
- K 线；季度锚定 VWAP 和 ±1σ 带（绿色 VWAP、灰色带）；上个季度最终 VWAP 延伸成一条水平线
- 带标签的虚线：`PY Q4 VAL`、`Q1 VAH`、`Q2 VAH`、`PQ VAL`、`PY Nov VAL` 这一类
- 现价标签和 K 线收盘倒计时

### P2 月度 TPO（参考他的 SPCX 30m、ES 30m）
- 默认周期 30m
- 每个月一个 TPO 剖面，从当月起点往右画；POC 橙色线；价值区上下沿
- 未回补 POC 延伸线；单印区

### P3 周度 TPO（参考他的 ES 30m 周度图）
- 默认周期 30m
- 每周一个 TPO 剖面，在左侧标 `VAH ▸`、`POC ▸`、`VAL ▸`
- 未回补的 POC / VAH / VAL 一直向右延伸；价格触及时画圆圈标记

### P4 区间框（参考他的 ONDO 2h）
- 默认周期 2h
- 去年某个月（或上月、上季）的价值区画成矩形，从该周期起点延伸到最右侧，框内右端写标签（例如 `py oct`、`py nov`）

### P5 衍生品面板（参考他的 BTC 4h、1h）
- 主图加副图：持仓量、多空比，爆仓数据只在有可靠数据源时加
- 区间框的上下沿分别标 `1` 和 `0`
- 价格和持仓量背离时画箭头（规则见 §7.6）

---

## 4. 视觉规范

颜色是按参考截图目测的近似值，集中放在 `web/chart/theme.js`，可以调整。

| 元素 | 规范 |
|---|---|
| 背景 | 深蓝灰，约 `#1b2130`；网格线很淡或关闭 |
| K 线 | 单色：上涨白色空心、下跌白色实心，可配置成彩色 |
| 水印 | 图中央，暗色：`{显示代码}, {周期中文}`，例如 `ETHUSDT.P, 1小时`；永续合约显示代码后加 `.P` |
| 左上信息行 | 第 1 行：`{代码} · {名称} · {周期} · Binance 开=… 高=… 低=… 收=… 涨跌 (涨跌%) 成交量…`；第 2 行起：每个指标一行，写指标名、参数和当前值，数值用指标本身的颜色 |
| 关键价位线 | 白色虚线；线的右端、价格轴左侧写文字标签（如 `Q1 VAH`）；价格轴上是白底黑字的价格标签 |
| 特殊价位 | 去年某月的价位用青色 `#4fc3f7` 实线 |
| VWAP | 绿色 `#5cb85c`；上季末 VWAP 用深绿；标准差带灰色半透明填充，边线灰色 |
| TPO / VP 剖面 | 灰色块；POC 橙红色粗线；价值区上下沿青色点线 |
| 区间框 | 细边框（白、黄、红可选），半透明填充；标签写在框内右端 |
| 现价 | 白色标签；标签下一行显示 K 线收盘倒计时（`mm:ss` 或 `hh:mm:ss`）。价格轴标签做不到两行时，把倒计时画在现价线旁 |
| 事件标记 | 白色圆圈、白色箭头、交叉号；可以带一行小字 |
| 时间 | 数据一律使用 UTC 时间戳；坐标轴和文字显示 JST（用 `localization.timeFormatter` 和 `tickMarkFormatter` 配合 `Intl`，不要把时间戳本身加 9 小时） |
| 页脚 | `Generated {YYYY-MM-DD HH:mm} JST · Data: Binance · order-flow-analysis`，保留 TradingView 归属标识 |

---

## 5. 架构

### 5.1 文件

```
chart.html                  # 新页面；index.html 加一个链接过来，现有面板保持不变
web/chart/
  main.js                   # 页面入口：选择币种、周期、版式，导出按钮
  data.js                   # K 线、持仓量、多空比的拉取、分页和缓存
  indicators.js             # 纯函数：锚定 VWAP、TPO、K 线近似 VP
  annotate.js               # 纯函数：自动标注引擎，输入数据，输出 annotations-v1
  render/
    primitives/*.js         # 每种标注类型一个 primitive
    renderer.js             # annotations-v1 → 图表
  theme.js
  presets.js                # P1 到 P5 的图层组合
  export.js                 # PNG 导出
  fixtures/*.json           # 每个版式的样例数据
web/tests/chart-*.test.mjs
config/annotation-rules.json
tradingview/levels.pine     # C6
```

### 5.2 数据流

```
Binance REST（K线 / 持仓量 / 多空比）  ─┐
profiles-{SYMBOL}.json（精确 VP，来自数据管线）─┼→ indicators.js → annotate.js → annotations-v1 JSON → renderer.js → 图表 → export.js → PNG
手动标注（C6，localStorage 或导入的 JSON）  ─┘
```

渲染器只认 `annotations-v1`，不关心数据从哪来。所以 C2 可以先用 `fixtures/` 里的样例开发，不必等数据管线完成。

### 5.3 导出 PNG 的硬性要求

- 所有线、框、剖面、标记都用 series 或 primitives 画在图表的 canvas 上，**不要用 DOM 覆盖层**，否则 `chart.takeScreenshot()` 截不到。
- 左上信息行和页脚在导出时用 Canvas 2D 画到一张合成画布上：信息行 + 图表截图 + 页脚。
- 导出尺寸预设：`1920×1080`、`2400×960`（宽图，比例约 2.5:1）、`当前窗口`；按 `devicePixelRatio` 输出高清图。

---

## 6. 标注数据格式 `annotations-v1`

```json
{
  "schema": "annotations-v1",
  "symbol": "ETHUSDT", "market": "um", "interval": "1h",
  "generatedAt": "2026-09-26T07:00:00Z",
  "items": [
    { "id": "pq-val", "type": "level", "price": 1720.55, "label": "PQ VAL",
      "from": 1719792000, "to": null, "style": "dashed", "color": "#e6e6e6",
      "axisLabel": true, "group": "quarter", "source": "exact" },

    { "id": "py-oct", "type": "zone", "top": 0.855, "bottom": 0.556,
      "from": 1759276800, "to": null, "label": "py oct",
      "border": "#ffffff", "fill": "rgba(79,195,247,0.10)", "group": "month" },

    { "id": "tpo-2026-08", "type": "profile", "kind": "tpo",
      "from": 1754006400, "to": 1756684800, "binSize": 0.5,
      "rows": [[139.5, 12], [140.0, 15]], "poc": 140.0, "vah": 148.5, "val": 131.0,
      "maxWidthBars": 40, "showLetters": false },

    { "id": "q-vwap", "type": "band", "label": "Q VWAP",
      "points": [[1719792000, 2155.17, 2492.75, 1817.60]], "color": "#5cb85c" },

    { "id": "touch-1", "type": "marker", "shape": "circle",
      "time": 1758844800, "price": 1720.55, "text": "touch PQ VAL", "pane": 0 },

    { "id": "c-1", "type": "callout", "time": 1722470400, "price": 9.064, "text": "2024 8.4" },

    { "id": "r-1", "type": "range", "from": 1755302400, "to": 1759276800,
      "high": 82400, "low": 75400, "labels": ["1", "0"] },

    { "id": "v-1", "type": "vline", "time": 1613779200, "label": "2021-02-20" },

    { "id": "t-1", "type": "text", "time": 1758844800, "price": 2700, "text": "…" }
  ]
}
```

- 时间用 **UTC 秒**（Lightweight Charts 的 `UTCTimestamp`）。
- `to: null` 表示延伸到最右侧。
- `source` 取值：`exact`（来自 aggTrades 精确数据）、`approx`（由 K 线近似得到）、`manual`（手动添加）。`approx` 的标签末尾加 `≈`，例如 `PQ VAL ≈`。
- `band.points` 的每一项是 `[时间, 中线, 上沿, 下沿]`，可以带更多条标准差线。
- 所有类型都要有 JSON Schema 校验（`web/chart/schema.js`），不合格的条目跳过，并在控制台打印原因。

---

## 7. 自动标注规则（`annotate.js`）

规则参数都放在 `config/annotation-rules.json`：

```json
{
  "levels": {
    "scopes": ["PW", "PM", "PQ", "Q1", "Q2", "Q3", "Q4", "PY", "PY_Q", "PY_M"],
    "kinds": ["VAH", "VAL", "POC"],
    "visiblePadPct": 15,
    "mergeTolerancePct": 0.1,
    "maxLabels": 8
  },
  "nakedPoc": { "scopes": ["W", "M"], "maxAgeDays": 180 },
  "singlePrints": { "minBins": 2 },
  "zones": { "scopes": ["PY_M"], "nearestN": 2 },
  "touch": { "lookbackBars": 60, "toleranceTicks": 2 },
  "cross": { "enabled": true, "confirmBars": 2 },
  "oiDivergence": { "enabled": false, "lookbackBars": 48 }
}
```

### 7.1 价位来源
- 各周期的 VAH / VAL / POC 来自第一份任务书 Phase 4 生成的精确剖面。
- 还没有精确数据的周期，用 K 线近似 VP（§8.4），标为 `approx`。
- 标签命名：`PW` / `PM` / `PQ` / `PY` 分别指上周、上月、上季、去年；`Q1` 到 `Q4` 指今年的季度；`PY Q1` 到 `PY Q4` 指去年各季度；`PY Jan` 到 `PY Dec` 指去年各月。

### 7.2 筛选
- 只保留落在"可见价格范围上下再各扩 `visiblePadPct`%"以内的价位。
- 超过 `maxLabels` 条时，按以下顺序保留：先保留离现价最近的；距离相同时，周期越长越优先（PY > PQ > PM > PW）。

### 7.3 合并
- 两条价位相差不超过 `mergeTolerancePct`% 时合并成一条线。
- 线的价格取周期更长的那一条，标签合并写，例如 `PQ VAL · PM POC`。

### 7.4 未回补 POC 和单印
- 未回补 POC：从形成时间画到最右侧，标签 `nPOC {周期}`；一旦被触及，线就截止到触及的那根 K 线。
- 单印：连续 `minBins` 个以上只有 1 个 TPO 的价格档，画成半透明区块（算法见第一份任务书 §6.2）。

### 7.5 事件标记
- **触及（touch）**：在最近 `lookbackBars` 根 K 线里，找第一根满足 `low − 容差 ≤ 价位 ≤ high + 容差` 的 K 线，在该 K 线的时间、价位处画圆圈，文字 `touch {标签}`。每条价位只标最近一次。
- **穿越（cross）**：收盘价从价位一侧到另一侧，并且之后连续 `confirmBars` 根收盘都在新的一侧，画向上或向下的箭头，文字 `close above {标签}` 或 `close below {标签}`。

### 7.6 价格和持仓量背离（P5，默认关闭）
- 条件：价格在 `lookbackBars` 内创新高，而持仓量低于这段时间内持仓量的最高值（新低的情况对称处理）。
- 在持仓量副图画箭头，文字 `price ↑ OI ↓`。

### 7.7 确定性
- 同样的输入必须产生同样的输出。
- 每条自动标注的 `id` 由规则名、周期和价格生成，保证稳定，方便做测试快照。

---

## 8. 数据来源与计算

### 8.1 K 线（浏览器端）
- 合约：`https://fapi.binance.com/fapi/v1/klines?symbol=&interval=&startTime=&endTime=&limit=1500`
- 现货：`https://api.binance.com/api/v3/klines`，`limit` 最大 1000
- 用 `endTime` 往前分页。每个版式声明自己需要多长历史：P1 为本季度加上一季度，P2 为 3 个月，P3 为 8 周。
- 遇到 429 / 418 时按 `Retry-After` 退避；缓存放在内存里，同一次会话内不要重复请求。
- `config/symbols.json` 加两个字段：`market`（`um` 或 `spot`）和 `displayName`（例如 `ETHUSDT.P`）。

### 8.2 锚定 VWAP
- 在**当前图表周期**的 K 线上计算，和 TradingView 上同类指标的做法一致。
- 典型价用 hlc3；公式和标准差带沿用第一份任务书 §6.3。
- 锚点默认按 UTC 季度，也支持日、周、月、年。
- 信息行显示格式：`Anchored VWAP (hlc3, Quarter, ±1σ)  {vwap} {upper} {lower}`。

### 8.3 TPO
- 固定使用 **30m K 线**，不管图表当前是什么周期。
- 按周或按月分组，算法沿用第一份任务书 §6.2。

### 8.4 VP
- **精确数据**：优先读取 `profiles-{SYMBOL}.json`。
- **近似数据**（精确数据没有覆盖的周期）：
  - 把每根 K 线的成交量平均分配到它最低价到最高价之间的各个价格档
  - 主动买卖按这根 K 线的 taker buy 占比拆分
  - 结果标为 `approx`
- 价值区算法沿用第一份任务书 §6.1。JS 版和 Python 版用同一组测试向量，结果必须一致。

### 8.5 衍生品数据（C5）
- 持仓量：`/futures/data/openInterestHist`（只有最近约 30 天）
- 多空比：`/futures/data/globalLongShortAccountRatio`、`/futures/data/topLongShortPositionRatio`
- 爆仓：Binance 的 `!forceOrder@arr` 每个币种每秒只推最新一笔，总量会偏低，只能作参考；图上必须注明 `partial`
- 第三方数据源（Coinglass 等）需要 API key，**key 不能放进前端或公开仓库**。本任务书不接第三方数据。

---

## 9. 分阶段任务

### C0：页面骨架和依赖
- 新建 `chart.html`，`index.html` 加入口链接。
- 用精确版本号 + SRI 加载 Lightweight Charts 5.x。
- 能显示 BTCUSDT 永续 1h K 线。
- **验收**：页面在 GitHub Pages 上正常显示；控制台没有报错；保留了 TradingView 归属标识。

### C1：基础图表和外观
- 周期切换：15m、30m、1h、2h、4h、1D；支持合约和现货。
- 按 §4 的视觉规范做好：主题、水印、左上信息行、现价标签加倒计时、成交量副图（v5 的多窗格）。
- PNG 导出（§5.3），三种尺寸都要能用。
- **验收**：BTC、ETH、SOL 各导出一张 1h 图，信息行和页脚都完整出现在 PNG 里。

### C2：标注渲染器
- 为 §6 的每种类型写一个 primitive，价位线要有价格轴标签。
- `fixtures/` 里给 P1 到 P5 各准备一份样例数据，页面可以切换到样例模式预览。
- **验收**：每个版式的样例都能正确渲染，并能出现在导出的 PNG 里；平移、缩放时标注跟着 K 线移动，不漂移。

### C3：浏览器端指标
- 实现锚定 VWAP 和标准差带、30m TPO（周、月）、K 线近似 VP，接入精确 VP 文件。
- **测试**：用手算的小样本核对 VWAP 和 σ、TPO 计数、POC 平局规则、单印识别（排除两端尾部）、近似 VP 的成交量守恒（各档之和等于 K 线成交量总和）。

### C4：自动标注引擎和版式 P1 到 P4
- 按 §7 实现规则和配置文件，把 P1 到 P4 接到真实数据上。
- **测试**：筛选、合并、优先级、未回补 POC 截止、touch 和 cross、`approx` 标记、输出稳定性（同样输入得到同样的 `id` 和顺序）。
- **验收**：P1 到 P4 各导出 BTC、ETH、SOL 三张图，附在 PR 里。

### C5：衍生品副图和版式 P5
- 持仓量、多空比副图；区间框 `range` 的自动生成（取用户选定时间段的最高价和最低价）；背离箭头规则。
- 爆仓副图只在注明 `partial` 的前提下提供，默认关闭。
- **验收**：BTC 4h 和 1h 各导出一张。

### C6：手动标注和 TradingView 桥接
- **手动工具**：水平线、矩形、圆圈、箭头、文字；用 `subscribeClick` 放置，可以删除。
- **保存**：存到 localStorage（读写都用 try/catch 包住），同时支持导出和导入 JSON（`source: "manual"`）。
- **"复制到 TradingView"按钮**：把当前图上的价位和区间生成文本，每行一条：

```
PQ VAL=1720.55;dashed;#e6e6e6
Q1 VAH=2750.62;dashed;#e6e6e6
py oct=0.556..0.855;zone;#4fc3f7
```

- **`tradingview/levels.pine`（Pine v6 指标）**：
  - 用 `input.text_area` 读入上面的文本，用 `str.split` 解析
  - 用 `line.new`（`extend.right`）、`label.new`、`box.new` 画出价位线、标签和区间框
  - 注意 Pine 对线、标签、框的数量上限
- README 写清楚使用方法：在 TradingView 的 Pine 编辑器里新建指标、粘贴脚本、加到图表、把文本粘贴进参数。
- **验收**：本页面和 TradingView 上同一品种、同一周期显示的价位一致，PR 里附对比截图。

---

## 10. 测试要求

- 纯函数（`indicators.js`、`annotate.js`、`schema.js`）全部用 `node --test` 覆盖，不依赖网络。
- 用固定的样例数据做快照测试：同一输入产生的 annotations JSON 和保存的快照完全一致。
- 可选：加一个 Playwright 冒烟测试，用样例模式加载 `chart.html`，确认没有控制台错误、导出的 PNG 非空。

---

## 11. 不做的事

- 买卖建议、交易信号、胜率统计
- 自动在 tradingview.com 上操作或画线
- 使用 Advanced Charts（Charting Library）
- 在前端或公开仓库存放任何 API key
- 自动生成主观走势路径或主观判断类标注
- 在图上使用交易员本人的名字、账号或水印

---

## 12. 汇报模板

```
## C? 完成汇报
- 改动文件：
- 对应任务书条目：
- 测试命令和完整输出：
- 导出的截图（按验收要求）：
- 已知限制 / 没做完的部分：
- 需要我决定的问题：
```
