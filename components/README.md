# `components/` — React 组件

<sub>[← 项目根](../README.md) · [app](../app/README.md) · [ui](./ui/README.md) · [lib](../lib/README.md)</sub>

应用的全部 UI 组件。视图级组件多为客户端组件（`"use client"`），从 [`lib/data.ts`](../lib/README.md) 读数据并渲染；
原子级基础组件见 [`ui/`](./ui/README.md)。

## 视图组件（页面级）

| 组件 | 用于 | 说明 |
| --- | --- | --- |
| `schedule-view.tsx` | `/` | 首页主视图：Hero、焦点战、夺冠榜、AI 预测战绩、时区切换、阶段筛选（全部 / 小组赛 / 32 强…）、按日赛程（小组赛 + 淘汰赛混排）。 |
| `groups-view.tsx` | `/groups` | 12 组（A–L）积分榜网格。 |
| `rankings-view.tsx` | `/rankings` | FIFA 48 强排名列表。 |
| `champion-board.tsx` | `/champions` | AI 夺冠榜整页：夺冠 / 晋级阶段概率排行与方法说明。 |
| `match-analysis.tsx` | `/match/:id` | 单场深度分析（概率、预期进球、比分分布、看点、雷达、阵容、伤停）。 |

## 功能组件

| 组件 | 说明 |
| --- | --- |
| `site-shell.tsx` | 全站外壳：顶部导航、Logo、实时比分跑马灯、GitHub 徽章。 |
| `featured-section.tsx` | 首页「今日焦点」：①焦点战 ②AI 高置信推荐 ③死亡之组。①②限定「过去 1 天～未来 2 天」时间窗口（完赛超一天自动剔除、随赛程滚动；窗口内不足则用之后最近的比赛补足）；焦点战标签由 `focusType()` 按比赛特征动态判定（强强对话 / 卫冕冠军 / 东道主登场 / 冷门预警 / 进球大战 / 势均力敌 / 豪门出击 / 实力悬殊 / 焦点之战，共 9 类，优先级从特殊到一般）。死亡之组为结构性焦点，不受时间窗口影响。 |
| `champion-race.tsx` | 首页内嵌夺冠榜，读 `CHAMPION_RACE`，Top N 夺冠 / 进决赛概率条。 |
| `accuracy-scoreboard.tsx` | 首页「AI 预测战绩」：用**已结算比赛的真实赛果回测**模型表现（消费 `useLiveMatches()`，随实时赛果更新）。五项指标全部从每场 `m.ai` / `m.detail` 真实算出：**①胜平负命中率**——AI 胜率最高项 **或** 冷门预警代表比分（`detail.upsetScore`）任一与真实结果一致即算中（标注「含冷门预警比分」）；**②Top3精确命中比分**——赛前比分概率（`detail.scoreProbs`）Top3 中任一与真实比分完全一致即算中；**③冷门预警命中**——实际爆冷场（热门方未取胜，含被逼平）中 AI 事先预警到的比例（冷门方不败概率 ≥ `UPSET_ALERT=33%`）；**④自报 vs 实际**——AI 平均自报置信度 → 实际命中率对比，并标注「偏保守 / 偏自信 / 校准良好」（`calibration()`，差值阈值 ±10）；**⑤近期手感条**——近 10 场命中/失手圆点。仅统计已结束场次，标注「仅供娱乐」。 |
| `match-card.tsx` | 小组赛比赛卡片（含 `ProbBar` 胜负预测）。 |
| `knockout-card.tsx` | 淘汰赛对阵卡片，双态渲染：**对阵已确定**时显示真实球队 + 国旗 + 实时比分/比赛钟 + AI 胜负预测条 + 详情链接（与小组赛卡片同款）；**未确定**时显示席位占位（如「A 组第 1」「第 101 场胜者」）+「待定」。对阵由 [`lib/knockout-resolver.ts`](../lib/README.md) 从实时 overlay 解析，AI 预测用 `buildKnockoutMatch` 经同一套 v6 引擎实时生成（详见下方「淘汰赛席位自动解析」）。 |

**实时数据**

| 组件 | 说明 |
| --- | --- |
| `live-provider.tsx` | 客户端实时数据 Provider：轮询 `/api/live`，经 `mergeLiveOverlay` 将比分 / 分钟叠加到静态赛程并以 Context 下发；导出 `useLiveMatches` / `useHasLive` / `useLiveInfo` / `useLiveEvents` / `useLiveStats` 等 hook 与 `LiveMinute` 实时分钟组件（秒针锚定固定 `kickoffMs`，刷新不归零）。 |
| `in-play-analysis.tsx` | **赛中实时分析卡片**（详情页常驻三态：未开赛推演 / 进行中逐秒重算 / 已完赛锁定）。消费 `lib/in-play.ts` 引擎，结合实时比分 + 剩余时间 + 红黄牌 + **实时技术统计（场面权重）** 展示实时胜平负、最可能最终比分、后续进球概率、生效修正与 **SofaScore 式技术统计对比条（八项）**。详见 [docs/赛中实时预测引擎.md](../docs/赛中实时预测引擎.md)。 |
| `live-ticker.tsx` | 顶部滚动的实时比分条。 |
| `countdown.tsx` | 距决赛开战倒计时。 |

**可视化与原子**

| 组件 | 说明 |
| --- | --- |
| `prob-bar.tsx` | 胜 / 平 / 负三段连续概率条。 |
| `radar-compare.tsx` | 两队多维能力雷达对比图。 |
| `pitch.tsx` | 足球场示意（阵型 / 站位）。 |
| `team-flag.tsx` | 国旗组件，按队伍码渲染，支持多尺寸。 |
| `form-badge.tsx` | 近期战绩徽标（W/D/L）与战绩行。 |
| `count-up.tsx` | 数字滚动递增动画。 |
| `page-transition.tsx` | 路由切换页面过渡动画。 |
| `ambient-bg.tsx` | 背景氛围光效。 |
| `ball-mark.tsx` | 站点 Logo（奖杯图标 SVG）。 |

## 淘汰赛席位自动解析（逐阶段自动推进）

淘汰赛对阵在静态赛程里是席位占位符（「A 组第 2」「第 73 场胜者」）。系统**全自动、逐阶段**把它们替换为真实球队，无需人工干预：

1. **数据源放出真实对阵** → 上一阶段名次确定后，数据源（API-Football）把占位（`Group A Winner` 等）更新为真实球队 → poller 写入 `live_scores`（含 `round` 轮次名）。poller 每轮只看「昨天+今天」窗口，另有**整届赛程同步**（`syncFullSchedule`，节流默认 30min/次）按 `season` 拉全量赛程，把「未开赛且双方已确定」的下一阶段对阵**提前整批写库**——故 API 一公布对阵，最迟 30 分钟内即可整批解析，不必等到各场比赛当天。该同步只写未开赛场，绝不触碰 live/完赛行（比分由窗口 tick 权威写入）。
2. **解析** → [`lib/knockout-resolver.ts`](../lib/README.md) 的 `resolveKnockout(overlay)` 把已确定对阵接回固定槽位：先用 `round`（"Round of 16"…）映射到本站 stage 限定候选组，再在组内按 **kickoff 时间最近邻**（容差 ±3h，小于相邻场最小间隔 3.5h，杜绝错配）做 1:1 配对。**远期未放出的轮次无对应数据 → 保持「待定」**，故天然实现「只解析下一轮」。
3. **构建** → `buildKnockoutMatch(slot, home, away)`（在 `lib/data.ts`）用与小组赛**同一套 v6 Elo 引擎**（`v2ForMatch` + `buildDetail`）实时生成 AI 胜负 / 比分 / 置信度 + 详情，再经 `mergeLiveOverlay` 叠加实时比分。
4. **渲染** → `schedule-view` 把已解析的 Match 传给 `knockout-card`；详情页 `/match/m73` 同样经 resolver 解析后渲染。
5. 一轮接一轮直到决赛。触发节奏由 poller 轮询决定（API 一放出新对阵，下次轮询即接上），全程零改动数据流与预测模型。

> 数据管线无需为此改动：poller 本就遍历 league=1 全部当日比赛、不区分阶段。仅 `live_scores` 新增 `round` 列作为解析锚点。

**触发时序（重要）**：系统**不**「等小组赛最后一场结束才开始拉对阵」，而是**全程持续轮询**——`syncFullSchedule` 从赛事开始就按节流（默认 30min/次）一直在拉同一个 `/fixtures?league&season` 请求。下一阶段对阵**何时出现真实球队，由数据源（API）决定**：

- 小组赛进行期间，淘汰赛场次的对阵在 API 端仍是占位（`Group A Winner` 等）→ 被「双方已确定」过滤跳过 → 不写库 → 卡片保持「待定」。
- 某组小组赛全部踢完、名次确定后，API 把该组相关对阵更新为真实球队 → **下一次同步（最迟 30 分钟内）即抓取并解析**。因此不是「最后一场小组赛统一触发」，而是**哪部分名次先定、对应对阵就先被填充**（整批节奏由 API 方决定，通常该阶段全部结束后数小时内更新完毕）。
- 16 强及以后同理：等上一轮打完、API 更新后被动抓取。

> 一句话：我们持续轮询、被动等待，**API 一把对阵从占位改为真实球队，我们下一轮同步就自动抓取 → 解析 → 预测 → 显示**。每次同步无论该阶段是 16 场还是 1 场，都只消耗 **1 个** API 额度（一个请求返回整届赛程，本地遍历筛选不耗额度）。

## 约定

- **数据来源单一**：组件不自行编造概率，统一从 [`lib/data.ts`](../lib/README.md) 取（真实数据 + opus4.8 引擎输出）；实时比分经 `live-provider` 叠加。
- **设计令牌**：颜色 / 圆角走 [`app/globals.css`](../app/README.md) 的语义令牌。
- **单一职责**：复杂视图拆成小组件；通用交互复用 [`ui/`](./ui/README.md) 基础件。
- **可访问性**：交互元素需有可聚焦语义与必要的 `aria` / `sr-only` 文本。
