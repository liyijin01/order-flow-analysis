你负责维护我的 GitHub 仓库 https://github.com/liyijin01/order-flow-analysis（Binance USD-M 订单流 / 价值区成品分析图，风格参考交易员 KBeast @Xbt886）。这是新开的对话，之前的对话已经到长度上限，所有进度都记录在仓库的 `docs/` 里。

开始之前先读仓库里的 `docs/`：
- `docs/ROADMAP.md`：已完成到哪一轮、下一步是什么、还有哪些待完成
- `docs/DECISIONS.md`：已经定下来、不要随意改的定义和规则，以及金标准验证结果
- `docs/CHANGELOG.md`：每一轮做了什么
- `docs/specs/`：每一轮的任务文档原文（最近的是 D12~D17）

当前产品：
- `analysis.html` + `web/analysis/*`：成品分析板，按模板切换（URL 参数 `tpl`），每个模板只用一种方法：
  - `quarter` 季度价值（1h / 4h，默认模板）
  - `rvwap` 滚动 / 年度 VWAP（4h）
  - `weekly` 周度 VWAP（30m）
  - `monthly` 月线结构（1M）
  - `mprofile` 月度剖面（M30 TPO）
  - `wprofile` 周度剖面（M30 TPO）
  - `combined` 综合（旧版完整分析板）
- `flow.html` + `web/flow/*`：订单流成品图（AVWAP 带、合约 / 现货 CVD、归档深度三档）
- `chart.html`：实验台，除非任务文档要求，否则不动
- 每日数据：GitHub Actions 定时任务（09:25 UTC）构建快照、历史价位 `analysis/levels/`、TPO 剖面 `analysis/tpo/`，缓存放在 data 分支；每天生成 30 张分析 PNG（`analysis/png/`，清单在 `analysis/latest.json`）和订单流 PNG（`flow/png/`）
- 线上：https://liyijin01.github.io/order-flow-analysis/

工作方式（每一轮都一样）：
1. 我会发一份 .md 任务文档，严格按文档实现；文档和现有代码冲突时以文档为准，偏差写进回复。
2. 从最新 main 切文档指定的分支，所有改动放进一个 PR。
3. 每个 PR 都要：把本轮任务文档原样保存为 `docs/specs/{编号}.md`；在 `docs/CHANGELOG.md` 末尾追加一行（“提交 / PR”列只写 PR 编号，不写 squash SHA）；更新 `docs/ROADMAP.md` 的状态；改了定义或规则时同步更新 `docs/DECISIONS.md`。
4. 每完成一项在本地跑单元测试（`node --test web/tests/*.test.mjs`、`python -m unittest discover pipeline/tests -v`）并 commit。**push 之前在本地起 server 跑一遍浏览器回归 `node scripts/d1_smoke.cjs`**，通过后再 push。CI 失败时修复，同样先在本地跑通再 push（每次 push 都会取消正在跑的 CI）。
5. 金标准对不上时，不要为了贴合参考值去改已经验证过的定义，照实写进回复，由我决定。
6. CI 全绿后直接 squash merge 到 main，不需要等我 review。
7. 等 main 上的 Pages workflow 部署成功，按文档的验收项自查，按文档的回复格式给我链接。

现在先不要改代码，读一遍仓库和 `docs/` 后回复“已就绪”，并用一句话说出 ROADMAP 里的下一步，然后等我发任务文档。
