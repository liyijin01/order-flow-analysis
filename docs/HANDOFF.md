你负责维护我的 GitHub 仓库 https://github.com/liyijin01/order-flow-analysis（Binance USD-M 订单流 / 价值区成品分析图，风格参考交易员 KBeast @Xbt886）。这是新开的对话，之前的对话已经到长度上限，所有进度都记录在仓库的 `docs/` 里。

开始之前先读仓库里的 `docs/`：
- `docs/ROADMAP.md`：已完成到哪一轮、下一步是什么
- `docs/DECISIONS.md`：已经定下来、不要随意改的定义和规则，以及金标准验证结果
- `docs/CHANGELOG.md`：每一轮做了什么
- `docs/specs/`：每一轮的任务文档原文（最近的是 D18 ~ D20c）

当前产品：
- `analysis.html` + `web/analysis/*`：成品分析板，按模板切换（URL 参数 `tpl`），每个模板只用一种方法：
  - `quarter` 季度价值（1h / 4h，默认）、`rvwap` 滚动 / 年度 VWAP（4h）、`weekly` 周度 VWAP（30m）、`monthly` 月线结构（1M）、`mprofile` 月度剖面、`wprofile` 周度剖面（M30 TPO）、`ssd` 稳定币占比（日线，与币种无关）、`combined` 综合
- 代码结构（D19 / D19b 起）：模板在 `web/analysis/templates/`，公共计算在 `web/analysis/layers/`，`main.js` 只做调度、不写任何模板 id；每个模板在 `config/analysis-rules.json` 里声明需要的 K 线（`needs` / `history`）和预计算文件（`precomputed`）
- 数据：实时 K 线来自 Binance USD-M，拉不到时自动回退到每日快照（D20c）。每日 GitHub Actions（09:25 UTC）构建快照 `analysis/data/`、历史价位 `analysis/levels/`、TPO 剖面 `analysis/tpo/`、稳定币占比 `analysis/macro/ssd.json`（CoinGecko，用 secret `COINGECKO_DEMO_API_KEY`，**不要打印它**），缓存在 data 分支；每天生成 31 张分析 PNG（清单 `analysis/latest.json`，状态 `analysis/status.json`）
- `flow.html` + `web/flow/*`：订单流成品图；`chart.html`：实验台，除非任务文档要求，否则不动
- 线上：https://liyijin01.github.io/order-flow-analysis/

工作方式（每一轮都一样）：
1. 我会发一份 .md 任务文档，严格按文档实现；文档和现有代码冲突时以文档为准，偏差写进回复。
2. 从最新 main 切文档指定的分支，所有改动放进一个 PR。
3. 每个 PR 都要：把本轮任务文档原样保存为 `docs/specs/{编号}.md`；在 `docs/CHANGELOG.md` 末尾追加一行（“提交 / PR”列只写 PR 编号，不写 squash SHA）；更新 `docs/ROADMAP.md`；改了定义或规则时同步更新 `docs/DECISIONS.md`。
4. 能本地运行时：每完成一项跑单元测试（`node --test web/tests/*.test.mjs`、`python -m unittest discover pipeline/tests -v`）和浏览器回归（`node scripts/smoke/run.cjs`，可以只跑一个模板）再 push。不能本地运行时：每完成一项就 commit 并 push，以 CI 为准，CI 全绿再做下一项。
5. **`model-diff` 安全网**：每个 PR 的 CI 会对比改动前后 37 个模板组合的计算结果。分支名以 `d19` 或 `refactor-` 开头时必须零差异；功能类 PR 也要保证文档没要求改动的模板零差异，有差异要在回复里逐条说明。
6. 金标准对不上时，不要为了贴合参考值去改已经验证过的定义，照实写进回复，由我决定。
7. CI 全绿后直接 squash merge 到 main，不需要等我 review。
8. 等 main 上的 Pages workflow 部署成功，按文档的验收项自查，按文档的回复格式给我链接。
9. 本段话就是新版交接说明。下一个 PR 里把 `docs/HANDOFF.md` 替换成这段话（原样）。

现在先不要改代码，读一遍仓库和 `docs/` 后回复“已就绪”，并用一句话说出 ROADMAP 里的下一步，然后等我发任务文档。