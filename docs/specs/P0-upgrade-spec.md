# order-flow-analysis 升级任务书

> 仓库：https://github.com/liyijin01/order-flow-analysis
> 用途：交给 AI 编码助手按阶段执行。每个阶段独立提交，做完一个阶段就停下来汇报。

---

## 0. 执行规则（必须遵守）

1. **一次只做一个 Phase**。完成后提交一个 PR（或一组 commit），按 §8 的模板汇报，然后停下等确认，不要自动进入下一阶段。
2. **只读公开行情数据**。不使用任何 API key，不调用私有接口，不下单，不连接钱包。
3. **Python 只用标准库**（3.12）。前端保持纯静态文件，不引入打包工具；第三方库只允许在 Phase 6 从 `cdn.jsdelivr.net` 按固定版本号加载。
4. **不伪造、不插值行情数据**。数据缺失时，必须在 JSON 和页面上显式标注缺了哪段。
5. **计算逻辑和 I/O 分开**。纯函数必须有单元测试，测试不能依赖网络，用构造的小样本（fixtures）。
6. **不要改坏 §2.2 列出的正确行为**。
7. 规格不清楚时先提问，不要自己猜。

---

## 1. 背景与目标

目标是复刻交易员 KBeast（X：@Xbt886）的分析方式，最终能自动生成他风格的行情图。他常用的工具：

- 成交量剖面（VP）的价值区：POC / VAH / VAL，按周、月、季、年划分
- TPO（按周、按月），包括单印（single prints）
- 未回补的 POC（naked / untraded POC）
- 订单流：footprint、逐笔 CVD
- 季度锚定 VWAP 及标准差带
- 衍生品数据：持仓量（OI）、爆仓、净持仓

已经定下的原则：

- **footprint 和逐笔 CVD 只看最近 4 到 12 小时**
- **周线及更长周期的精确 VP，用 data.binance.vision 的 aggTrades 历史文件计算**

---

## 2. 现状

### 2.1 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 单页面板：REST 预加载 1000 笔 aggTrades 加 WebSocket 实时数据，渲染实时 VP、footprint、CVD（SVG），读取 `weekly-vp.json` 渲染周线 VP |
| `scripts/build_weekly.py` | 下载 Binance Vision 日度 aggTrades zip，校验 SHA-256，按价格汇总主动买卖量，输出 `weekly-vp.json`（本周已收盘的日期、上一个完整周） |
| `.github/workflows/pages.yml` | 每天 03:40 UTC 运行，构建后部署到 GitHub Pages |

### 2.2 已经正确、必须保留的行为

- `m=true` 判为主动卖，`m=false` 判为主动买；CSV 有表头和没表头两种情况都要处理对
- 下载后校验 SHA-256，只使用已经收盘的 UTC 日
- 页面如实显示实际覆盖的时间段，不把短样本说成完整窗口
- Python 只依赖标准库

### 2.3 已确认的问题

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| A | `index.html` 第 68 行 `lineSvg` | `Math.min(...xv)` / `Math.max(...yv)` 使用展开参数；在 V8（Chrome / Node 22）中约 12.5 万个元素就抛 `RangeError`（实测 12 万通过，13 万报错） | CVD 每笔成交一个点，BTC 活跃时段一两个小时就会让 CVD 图报错 |
| B | 第 65 行 `ws.onmessage` | 用 `trades.length%25===0` 触发重绘；数组长度固定在 `MAX=250000` 时这个条件恒为真 | 达到上限后每条消息都全量重绘 |
| C | 第 63 行 `add()` | `trades.shift()` 复杂度 O(n)，在循环里调用 | 25 万条时 5000 次约 250ms |
| D | 第 65 行 | 没有自动重连；REST 预加载和 WS 之间有空档；没有利用 aggTrade 编号做缺口检测 | CVD 是累计值，漏掉一段后整条线都会偏 |
| E | 第 63 行 | 25 万笔上限加上只能从打开页面开始积累 | 按 BTC 日均数百万笔估算，只能覆盖一两个小时，做不到 4 到 12 小时 |
| F | 第 70 行 `footprintHtml` | `prices.slice(0,80)` 只保留最高的 80 个价格档 | 行情跨度大时，下半部分（可能包括现价）被切掉 |
| G | 第 35、71 行 | `CVD / BTC` 单位写死；价格档默认 10 对所有币种都一样 | 切到 ETH 时标签错误 |
| H | `build_weekly.py` 第 74 行 | `k=int(p)`，按 1 USDT 分档 | 低价币全部落进同一档：0.42 到 0.55 的价格都会变成 0 |
| I | `build_weekly.py` / 页面 | 只生成 BTCUSDT；页面切到 ETH 时周线仍显示 BTC 的数据 | 数据和标题对不上 |
| J | `build_weekly.py` 第 42 到 44 行 | 下载失败只打印 `skip`，然后静默跳过 | "上一个完整周"可能只有 6 天，界面没有提示 |
| K | `pages.yml` 第 38 到 44 行 | 缓存 key 带 `run_id`，每次运行都新存一份；zip 从来不删 | 缓存无限增长，默认 10GB 上限下会被频繁清理 |
| L | `README.md` | 写着 Private，但仓库和 Pages 都已公开 | 描述不准确 |
| M | 全仓库 | 没有任何测试 | 改动没有保障 |

---

## 3. 数据约定

### 3.1 aggTrade（WebSocket / REST）

| 字段 | 含义 |
|---|---|
| `a` | aggTradeId，**连续递增**，用于检测缺口 |
| `p` | 价格（字符串） |
| `q` | 数量，单位是标的币（base asset） |
| `T` | 成交时间，毫秒 |
| `m` | 买方是否是挂单方。`true` 表示主动卖，`false` 表示主动买 |

- `Delta = 主动买量 − 主动卖量`，`CVD = Delta 的累计值`，单位是标的币。
- REST：`GET /fapi/v1/aggTrades`，weight 为 20，`limit` 最大 1000。支持 `fromId`；使用 `startTime`/`endTime` 时，两者间隔要小于 1 小时。
- WebSocket：`wss://fstream.binance.com/ws/{symbol}@aggTrade`。单个连接最长 24 小时，到时会被服务器断开。

### 3.2 Binance Vision 文件

- aggTrades：`https://data.binance.vision/data/futures/um/daily/aggTrades/{S}/{S}-aggTrades-{YYYY-MM-DD}.zip`，另有同名的 `.CHECKSUM` 文件
  - 列：`agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker`，旧文件可能没有表头，但列顺序相同
- K 线：`https://data.binance.vision/data/futures/um/daily/klines/{S}/{interval}/{S}-{interval}-{YYYY-MM-DD}.zip`
  - 列：`open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore`，以文件表头为准
- **GitHub Actions 的运行机器在美国，fapi.binance.com 通常会拒绝美国 IP（HTTP 451）。所以 workflow 里的数据只能来自 data.binance.vision，不要在 workflow 里调用 fapi。** 浏览器端可以继续调用 fapi。

### 3.3 时间与周期

- 所有周期边界都按 UTC 计算：日从 00:00 UTC 开始；周为 ISO 周，从周一 00:00 UTC 开始；月、季、年按 UTC 自然月、季、年划分。
- 页面显示时间统一用 JST（Asia/Tokyo）。

### 3.4 价格分档

- 新增 `config/symbols.json`，逐个币种配置：

```json
{
  "BTCUSDT": { "base": "BTC", "ladderBin": "1",    "defaultRow": "10",   "weeklyRows": ["5","10","25","50","100"] },
  "ETHUSDT": { "base": "ETH", "ladderBin": "0.1",  "defaultRow": "1",    "weeklyRows": ["0.5","1","2.5","5","10"] },
  "SOLUSDT": { "base": "SOL", "ladderBin": "0.01", "defaultRow": "0.1",  "weeklyRows": ["0.05","0.1","0.25","0.5","1"] }
}
```

- 档位编号：`binIndex = floor(Decimal(price_str) / Decimal(ladderBin))`，必须用 `Decimal` 或整数运算，**不要用 float 做除法取整**。
- JSON 里存整数 `binIndex`，并在文件头写明 `binSize`；价格等于 `binIndex × binSize`。
- 前端重新分档时也用整数运算：`newIndex = floor(binIndex × ladderBin / row)`，先放大成整数再计算，避免浮点误差。
- 价格展示约定：POC 取档中点；VAH 取价值区最高档的**上沿** `(i+1)×bin`；VAL 取价值区最低档的**下沿** `i×bin`。

---

## 4. 目标目录结构

```
config/symbols.json
pipeline/                    # Python，只用标准库
  vision.py                  # 下载、校验、重试
  ladder.py                  # aggTrades zip → 日度价格阶梯
  klines.py                  # K 线 zip → bars
  profiles.py                # 周期合成、价值区、未回补 POC
  tpo.py
  vwap.py
  build.py                   # 入口
  tests/                     # unittest，用构造的小 zip 做 fixtures
web/
  index.html
  core.js                    # 纯函数（ES module）：分档、CVD 聚合、footprint、价值区、缺口检测
  live.js                    # REST + WebSocket
  render.js
  tests/*.test.mjs           # node --test
（data 分支）
  ladders/{SYMBOL}/{YYYY-MM-DD}.json.gz
  klines/{SYMBOL}/30m/{YYYY-MM-DD}.json.gz
```

---

## 5. 分阶段任务

### Phase 0：拆分代码，搭建测试

**改动**
- 把 `index.html` 里的纯计算函数拆到 `web/core.js`，页面用 `<script type="module">` 引入。页面行为保持不变。
- 把 `build_weekly.py` 拆进 `pipeline/`，行为保持不变。
- 新增测试：
  - 主动方向映射（有表头和没表头两种 CSV）
  - 现有的分档逻辑
  - coverage 文本
- workflow 里在构建前加一个 test job：`python -m unittest discover pipeline/tests` 和 `node --test web/tests`。
- 修改 README，删掉 Private 相关的措辞（问题 L）。

**验收**：页面功能和原来一致；CI 里测试通过。

### Phase 1：修复实时部分（问题 A 到 D、F、G）

1. **CVD 聚合**：按 footprint 周期（或至少按 1 秒）分桶，每桶记录 CVD 的开、高、低、收。图上最多 5000 个点。全仓库禁止 `Math.min(...arr)` / `Math.max(...arr)` 这种展开写法，统一改用循环实现的 `minMax(arr)`。
2. **渲染节流**：收到新数据时只设一个标记（dirty flag），由定时器每秒最多重绘一次。删掉 `%25` 触发。
3. **存储**：改用环形缓冲，或者用头指针加定期压缩数组，删除旧数据的均摊成本要是 O(1)。上限 `MAX` 可配置；触顶时，coverage 文本要写明"已被内存上限截断"。
4. **缺口检测与补齐**
   - 维护 `lastId`。收到的新事件满足 `id > lastId + 1` 时，缺口就是 `[lastId+1, id-1]`。
   - 用 `GET /fapi/v1/aggTrades?symbol=&fromId=&limit=1000` 循环补齐，每分钟最多 60 个请求。
   - 补齐期间，WS 新消息先放进缓冲区，之后按 id 合并、去重。
   - 补不齐时，在 coverage 里写明缺口的时间段；CVD 线在缺口处断开，不把两边连起来。
5. **REST 预加载和 WS 的衔接**：WS 第一条消息到达后，检查它和预加载最后一个 id 之间有没有缺口，有就按第 4 条补齐。
6. **自动重连**
   - `onclose` / `onerror` 后按 1、2、4…秒指数退避重连，最长间隔 30 秒。
   - 用户主动断开时不重连。
   - 连接满 23 小时后主动换一个新连接。
7. **按币种显示**：单位标签用 `config` 里的 `base`；默认价格档从 `defaultRow` 读取。
8. **footprint**
   - 价格范围取当前显示的各列里的最高价和最低价。
   - 超过 80 行时，以最新价为中心截取。
   - 新增 15m、30m、1h 三个周期。
   - 每列底部加两行：delta 和总成交量。

**测试**
- 30 万笔构造数据经过 `bucketCvd` 后，点数不超过上限，且不抛异常
- `minMax` 能处理 100 万个元素的数组
- 缺口检测：id 序列 1、2、5 应识别出缺口 3 到 4
- 乱序和重复 id 合并后，结果有序且唯一
- footprint 价格行截取以最新价为中心

**PR 里写明手动测试方法**：页面连续运行 2 小时，用 Chrome 的 Performance 面板观察 CPU 和内存是否平稳。

### Phase 2：重构周线数据管线，改为日度价格阶梯（问题 H 到 K）

1. 按 `config/symbols.json` 里的 `ladderBin` 分档，用 `Decimal` 计算；遍历配置里的所有币种。
2. **日度价格阶梯**：每个 UTC 日生成一个文件 `ladders/{SYMBOL}/{date}.json.gz`：

```json
{"schema":"ladder-v1","symbol":"BTCUSDT","date":"2026-09-24","binSize":"1",
 "source":"data.binance.vision futures/um daily aggTrades","zipSha256":"...",
 "trades":3456789,"rows":[[binIndex,buyQty,sellQty],...]}
```

3. **持久化**
   - 日度阶梯提交到一个孤立分支 `data`（orphan branch）。
   - workflow 先把 `data` 分支 checkout 到 `data/`，只处理还没有的日期，处理完再 push 回去。这个 job 需要 `contents: write` 权限。
   - 原始 zip 解析成功后立即删除。删掉现有的 zip 缓存步骤。
4. **完整性标注**：每个周期的输出都带上 `expectedDays`、`days`、`missingDays`、`complete` 四个字段。前端在 `complete=false` 时显示醒目提示。
5. **重试策略**
   - 网络错误重试 3 次，指数退避。
   - HTTP 404 视为"文件还没发布"，记为缺失日期，不当成错误。
   - checksum 不匹配时重新下载一次，仍不匹配就把这一天标为失败。
   - 某一天失败不影响其他日期。
   - 上一个完整周有缺失时，输出 GitHub 的 `::warning::` 注解。
6. **调度**：改为每天运行两次（例如 01:40 和 09:40 UTC），以覆盖文件发布较晚的情况。
7. **输出**：每个币种一个 `profiles-{SYMBOL}.json`，Phase 4 会继续扩展。前端按当前选中的币种加载对应文件。

**测试**
- 有表头和没表头两种 fixture
- 用 0.4210、0.5371、0.5480 这类低价构造数据，确认落在不同的档
- checksum 不匹配的处理路径
- 404 缺失日期的处理路径
- 7 个日度阶梯相加，结果等于直接汇总一周数据

### Phase 3：补全最近 4 到 12 小时的历史（问题 E）

1. 连接时请求 `GET /fapi/v1/klines?symbol=&interval=1m&limit=720`（12 小时）。
   - 字段下标：5 是成交量，9 是主动买入量（taker buy base volume）。
   - `barDelta = 2 × takerBuy − volume`
   - 用它生成历史部分的 K 线级 CVD。
2. 历史部分和实时逐笔部分拼接：
   - 拼接点的 CVD 数值要连续。
   - 图上用分隔线标出两段，并注明精度不同："历史为 1 分钟 K 线级别，实时为逐笔"。
3. footprint 只显示实时抓到的时段，并标注说明。
4. （可选，默认关闭）在后台用 aggTrades 的 `startTime`/`endTime` 分段逐笔回补，每段不超过 1 小时，控制请求频率。

**测试**：`barDelta` 公式；拼接点连续；时间窗口按 UTC 毫秒边界计算正确。

### Phase 4：价值区、多周期剖面、未回补 POC

1. **周期合成**（`profiles.py`）：用日度价格阶梯拼出以下周期，标签沿用 KBeast 图上出现过的写法：

| 标签 | 含义 |
|---|---|
| `CW` / `PW` | 本周 / 上周 |
| `CM` / `PM` | 本月 / 上月 |
| `CQ` / `PQ` | 本季 / 上季 |
| `Q1` 到 `Q4` | 今年已完成的季度 |
| `PY` | 去年全年 |
| `PY Q1` 到 `PY Q4` | 去年各季度 |
| `PY Jan` 到 `PY Dec` | 去年各月（他的图上出现过 `py oct`、`py nov`、`PY Nov VAL`） |

2. **每个周期输出**：POC、VAH、VAL（70% 价值区，算法见 §6.1）、总量、主动买量、主动卖量、`complete` 标记。
3. **未回补 POC**
   - 对每个已完成的周和月，记录它的 POC 所在的档。
   - 之后任意一天的阶梯里，只要该档有成交，就算"已回补"，并记下日期。
   - 输出所有还没被回补的 POC：周期标签、价格、形成日期。
4. **历史回补任务**
   - 去年全年需要 365 天以上的阶梯数据。
   - 新增一个 `workflow_dispatch` 任务，参数为起始日期，每次运行最多处理 30 天，避免超过运行时长限制。
5. **前端显示**
   - 画水平线，右侧标注"标签 + 类型 + 价格"，例如 `PQ VAL 1,720.55`、`Q1 VAH 2,750.62`。
   - 按周期分组，可以开关显示。
   - 未回补的 POC 从形成时间一直向右延伸，直到被回补。

**测试**
- 价值区：单峰分布、双峰分布、只有一个档、档之间有空档（成交量为 0）、70% 边界
- 周期合成：跨月、跨季、跨年
- 未回补 POC：已回补和未回补两种情况

### Phase 5：TPO 与季度锚定 VWAP

1. **数据**：Binance Vision 的 30m K 线（TPO 用）和 1m K 线（VWAP 用），同样存成日度文件放在 `data` 分支。
2. **TPO**（算法见 §6.2）：生成按周和按月的剖面；输出每个价格档的 TPO 数、POC、VAH、VAL、单印区间；可选输出每个档对应哪些时段的字母，供前端画成块状。
3. **锚定 VWAP**（算法见 §6.3）
   - 默认按季度锚定，同时支持按日、周、月、年锚定（参数可配置）。
   - 输出 VWAP 和 ±1σ 标准差带，倍数可配置。
   - 季度结束时，把上季末的最终 VWAP 值延伸成一条水平线。

**测试**：用手算的小样本核对 TPO 计数、POC 平局规则、单印识别（要排除两端的尾部）、VWAP 和标准差数值。

### Phase 6：画图风格向他的图靠拢

- 使用 TradingView 开源的 `lightweight-charts`，从 jsDelivr 按固定版本号加载。
- 深色主题，K 线加右侧价格轴标签：每条画出来的线都在右轴显示"文字标签 + 价格"。
- VP 和 TPO 剖面以直方图或块状叠加层画在各自周期的起点处；VWAP 标准差带画成半透明色带；图中央加水印"SYMBOL, 周期"。
- 加一个"导出 PNG"按钮。

**验收**：在 PR 里附上 BTC 4h、ETH 1h、SOL 1h 三张截图，每张都同时显示上季 VAH/VAL、本周 POC、未回补 POC 和季度 VWAP 带。

### Phase 7（可选）：衍生品数据

- **持仓量和多空比**：历史数据先确认 Binance Vision 上有没有 `futures/um/daily/metrics/{S}/` 数据集，并核对它的字段；实时数据由浏览器调用 `/futures/data/openInterestHist`。
- **爆仓**
  - Binance 的 `!forceOrder@arr` 流，每个币种 1 秒内只推送最新的一笔，总量会少算，只能作参考。
  - 要看全市场汇总，需要第三方数据源（Coinglass、Coinalyze 等），这些都需要 API key。
  - **key 不能放进前端代码或公开仓库**，只能放在 Actions 的 secrets 里，由服务端生成数据文件。
- **盘口深度分档**（0 到 1%、1 到 2.5% 等）：REST 深度快照只能覆盖当前价附近很窄的范围，需要常驻采集程序。本阶段不做，只写设计说明。

---

## 6. 算法规格

### 6.1 成交量剖面价值区（70%）

从 POC 开始，比较上方两档和下方两档的成交量之和，把较大的一侧并入，直到累计量达到总量的 70%。两侧相等时优先向上。已经到达一端时，只能向另一侧扩展。这个实现已经用边界情况和 2000 组随机剖面测试过，都能正常结束，结果满足 VAL ≤ POC ≤ VAH：

```python
def value_area(rows, pct=0.70):
    """rows: [(binIndex, vol)]，按 binIndex 升序，允许 vol 为 0。
    返回 (poc_i, vah_i, val_i)，都是档位编号。"""
    vols = [v for _, v in rows]; n = len(vols); total = sum(vols)
    i = max(range(n), key=vols.__getitem__)          # POC
    lo = hi = i; acc = vols[i]
    while acc < total * pct and (lo > 0 or hi < n - 1):
        up = sum(vols[hi + 1:hi + 3]); dn = sum(vols[max(0, lo - 2):lo])
        if hi < n - 1 and (lo == 0 or up >= dn):
            acc += up; hi = min(n - 1, hi + 2)
        else:
            acc += dn; lo = max(0, lo - 2)
    return rows[i][0], rows[hi][0], rows[lo][0]
```

- POC 平局：取离剖面价格中点最近的那一档。
- 价格换算按 §3.4：POC 取档中点，VAH 取上沿，VAL 取下沿。
- 前端 `core.js` 实现同一套逻辑，并用同一组测试用例核对，两边结果必须一致。

### 6.2 TPO

- 每 30 分钟为一个时段，按时间顺序编号成字母（A、B、C…，超过 26 个后继续用小写或数字，规则写进注释）。
- 该时段 K 线最低价到最高价之间的每个档，各记 1 个 TPO。
- POC：TPO 数最多的档；平局时取离剖面价格中点最近的档。
- 价值区：同 §6.1 的算法，把成交量换成 TPO 数。
- 单印：TPO 数等于 1 的档。连着剖面最高端或最低端的那一段属于尾部，不算单印。输出时把相邻的单印档合并成区间。

### 6.3 锚定 VWAP

- 典型价 `tp = (high + low + close) / 3`，按 1m K 线计算。
- 从锚点开始累计：`VWAP = Σ(tp × v) / Σv`
- 标准差：`σ = sqrt(Σ(v × tp²) / Σv − VWAP²)`
- 标准差带：`VWAP ± k × σ`，默认 `k = 1`，可配置多个倍数。
- 锚点：每个 UTC 季度的开始时刻；同时支持日、周、月、年。

### 6.4 未回补 POC

- 只对已完成的周期计算。
- 判定"已回补"：该周期结束之后，任何一天的日度阶梯里 POC 所在的档成交量大于 0。
- 输出字段：`label`、`period`、`pocPrice`、`formedAt`、`touchedAt`（未回补时为 `null`）。

---

## 7. 不做的事

- 下单、私有接口、钱包相关功能
- 用插值或模拟方式填补缺失的数据
- 在前端或公开仓库里存放任何 API key
- 盘口热力图重建（Phase 7 只写设计说明）

---

## 8. 每个阶段的汇报模板

```
## Phase X 完成汇报
- 改动文件：
- 做了什么（逐条对应任务书的编号）：
- 测试命令和完整输出：
- 手动验证方法：
- 已知限制 / 没做完的部分：
- 需要我决定的问题：
```

---

## 附录：KBeast 图上出现过的元素（作为目标参考）

| 元素 | 他图上的写法示例 | 对应阶段 |
|---|---|---|
| 各周期的价值区横线 | `PY Q4 VAL 2,928.71`、`Q1 VAH 2,750.62`、`Q2 VAH`、`PQ VAL`、`PY Nov VAL 2,705.89`，以及框体标签 `py oct`、`py nov` | Phase 4 |
| 按周 / 按月的 TPO | 每个剖面上标有 `VAH`、`POC`、`VAL` 字样；TPO 参数行 `TPO (1M, 100, 30, 70, 2, Dotted, 2, Solid, Dashed)`、`TPO (1, Week)` | Phase 5 |
| 未回补的 POC 和单印 | 原文："keep a close eye on any untraded POCs and SPs" | Phase 4 / 5 |
| 季度锚定 VWAP | `Koalafied VWAP D/W/M/Q/Y (hlc3, Quarter, 1, 1, 15)`，带灰色标准差带 | Phase 5 |
| 衍生品副图 | `Open Interest (aggregation)`、`Liquidations (aggregation)`、`Net Positions (aggregation)` | Phase 7 |
| 盘口深度 | `Order Book Depth (aggregation)`，分档 0% 1%、1% 2.5%、2.5% 5%、5% 10%、10% 25% | Phase 7（只写设计） |
