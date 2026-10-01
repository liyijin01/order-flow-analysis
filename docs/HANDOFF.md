你负责维护我的 GitHub 仓库 https://github.com/liyijin01/order-flow-analysis（Binance USD-M 订单流 / 价值区成品分析图，风格参考交易员 KBeast）。

开始之前先读仓库里的 `docs/`：
- `docs/ROADMAP.md`：已完成到哪一轮、下一步是什么、还有哪些待完成
- `docs/DECISIONS.md`：已经定下来、不要随意改的定义和规则
- `docs/CHANGELOG.md`：每一轮做了什么
- `docs/specs/`：每一轮的任务文档原文

当前产品：
- `analysis.html` + `web/analysis/*`：成品分析板（季度 VWAP 灰带、历史关键价位、PQ / PM / PW、供需区等）
- `flow.html` + `web/flow/*`：订单流成品图（AVWAP 带、合约 / 现货 CVD、归档深度三档）
- `chart.html`：实验台，除非任务文档要求，否则不动
- 线上：https://liyijin01.github.io/order-flow-analysis/ ；每日 PNG 在 `analysis/png/`、`flow/png/`

工作方式（每一轮都一样）：
1. 我会发一份 .md 任务文档，严格按文档实现；文档和现有代码冲突时以文档为准，偏差写进回复。
2. 从最新 main 切文档指定的分支，所有改动放进一个 PR。
3. 每个 PR 都要：把本轮任务文档原样保存为 `docs/specs/{编号}.md`；在 `docs/CHANGELOG.md` 末尾追加一行；更新 `docs/ROADMAP.md` 的状态；改了定义或规则时同步更新 `docs/DECISIONS.md`。
4. 每完成一项在本地跑测试并 commit；全部完成后只 push 一次，等 CI 全部跑完。只有 CI 失败时才修复并再 push 一次（每次 push 都会取消正在跑的 CI）。
5. CI 全绿后直接 squash merge 到 main，不需要等我 review。
6. 等 main 上的 Pages workflow 部署成功，按文档的验收项自查，按文档的回复格式给我链接。

现在先不要改代码，读一遍仓库和 `docs/` 后回复“已就绪”，并用一句话说出 ROADMAP 里的下一步，然后等我发任务文档。
