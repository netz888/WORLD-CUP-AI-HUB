# `lib/` — 数据层 · 预测引擎 · 实时数据

<sub>[← 项目根](../README.md) · [app](../app/README.md) · [components](../components/README.md) · [ui](../components/ui/README.md)</sub>

应用的数据中枢：球队 / 赛程 / 积分等**核心数据**、**opus4.8 预测引擎**、**实时比分接入**与纯函数工具。
所有页面与组件的数据都从这里读取——**组件不自行编造概率**。

## 文件

| 文件 | 职责 |
| --- | --- |
| `data.ts` | **核心数据模块**。48 强（`TEAMS`）、12 组（`GROUPS` A–L）、16 座真实场馆（`VENUES`）、72 场小组赛对阵（`FIXTURES`）、32 场淘汰赛席位（`KNOCKOUT`，第 73–104 场）、已结束场次真实比分（`RESULTS`）、时区（`TIMEZONES`）、阶段筛选（`STAGE_FILTERS`）。运行时由 `buildMatches()` 组装出 `MATCHES`。 |
| `prediction-v2.ts` | **opus4.8 Elo 多因子预测引擎（v6）**。Elo 实力差 + 多因子（东道主 / 海拔 / 核心缺阵 / 近期状态）→ 有效实力 → Dixon-Coles 进球分布 → 胜平负 / 预期进球 / 比分分布 / 大小球 / BTTS。在 192 场真实世界杯赛果上训练校准。 |
| `in-play.ts` | **赛中实时预测引擎（纯函数）**。复用赛前 λ，按「时间衰减 + 红黄牌 + 比分效应 + 场面权重（实时技术统计）」对剩余时间做 Dixon-Coles 推演，叠加当前真实比分 → 实时胜平负 / 最可能最终比分 / 后续进球概率。可在客户端逐秒运行，零后端负载。详见 [docs/赛中实时预测引擎.md](../docs/赛中实时预测引擎.md)。 |
| `knockout-resolver.ts` | **淘汰赛席位解析器（纯函数）**。`resolveKnockout(overlay)` 把实时 overlay 中已确定的真实对阵接回静态淘汰赛槽位（m73–m104）：按 API `round` 映射 stage 限定候选组 + 组内 kickoff 最近邻（容差 ±3h）配对；远期未放出的轮次保持「待定」，天然「只解析下一轮、逐阶段自动推进」。配合 `data.ts` 的 `buildKnockoutMatch()`（同一套 v6 引擎生成对阵的 AI 预测）。详见 [components/README.md「淘汰赛席位自动解析」](../components/README.md)。 |
| `champion-sim-data.ts` | 各队夺冠 / 晋级阶段概率的**静态兜底基线**。实时值由 poller 在赛果变化时跑蒙特卡洛重算写入 `champion_sim` 表（核心见 `scripts/lib/champion-sim-core.mjs`，读库见 `db/champion-sim.ts`），DB 空时回退此表。 |
| `db/champion-sim.ts` | **夺冠榜读库层（`server-only`）**。`readChampionSim()` 读 `champion_sim` 表；`getChampionRace()` 组装排序后的榜单，DB 空回退静态 `CHAMPION_RACE`。供 `/champions` 页、`/api/live`、布局初值使用。 |
| `wc-predictions.json` | 逐场预测的离线产物（胜平负 / 预期进球 / 比分分布）。**生成物，不要手改。** |
| `real-analysis.ts` | 联网核实的赛前深度分析（阵容 / 伤停 / 教练 / 关键因子 / 比分分布），键为 `${主队码}-${客队码}`，与 `FIXTURES` 对齐。 |
| `market-data.ts` | 联网核实的真实近期战绩（W/D/L）；查不到不编造，前端显示「暂无核实数据」。 |
| `football-api.ts` | **实时数据层（`server-only`）**。football-data.org 拉取实时比分，Next.js `fetch` 缓存 + `revalidate`（全站共享、每 60 秒后台刷新）；任意失败降级为空 overlay。 |
| `db/sqlite-node.mjs` | **SQLite 驱动兼容层**。基于 Node 内置 `node:sqlite`，实现与 `better-sqlite3` 一致的接口（`prepare`/`exec`/`pragma`/`transaction`/`raw()`）。因原生模块在本环境无法编译而引入，app（drizzle）与全部抓取脚本共用。详见 [docs/数据拉取与实时机制.md](../docs/数据拉取与实时机制.md)。 |
| `db/client.ts` `db/schema.ts` | drizzle 客户端（改用 sqlite-node 兼容层）与 `live_scores` / `match_stats` 等表定义。 |
| `db/match-stats.ts` | 读 `match_stats` → `MatchStatsPair`（双方控球率/射门/射正/xG/角球/犯规/传球成功率/越位），供 `/api/match-stats` 与赛中场面权重使用。 |
| `api-key.ts` | football-data.org API Key 读取（`server-only`），优先用环境变量 `FOOTBALL_DATA_API_KEY`。 |
| `github.ts` / `github-config.ts` | 服务端拉取仓库 Star 数（缓存 1 小时，失败返回 `null`，UI 降级为不显示），供站点头部 GitHub 按钮使用。 |
| `time.ts` | 时间格式化：`formatTime` / `formatDateLabel` / `dateKey`，支持多时区换算。 |
| `utils.ts` | `cn()` —— 合并 Tailwind 类名（`clsx` + `tailwind-merge`）。 |

## 关键导出（页面 / 组件入口）

| 导出 | 来源 | 用途 |
| --- | --- | --- |
| `MATCHES` / `getMatch(id)` | `data.ts` | 全部比赛 / 按 id 取单场 |
| `computeStandings(group)` | `data.ts` | 按真实赛果实时计算小组积分榜 + 出线概率 |
| `KNOCKOUT` / `STAGE_FILTERS` | `data.ts` | 淘汰赛席位 / 赛程页阶段筛选 |
| `resolveKnockout(overlay)` | `knockout-resolver.ts` | 把已确定真实对阵接回淘汰赛槽位（逐阶段自动解析） |
| `buildKnockoutMatch(slot,h,a)` | `data.ts` | 为已解析对阵用 v6 引擎构建带 AI 预测的完整 Match |
| `FIFA_RANKING` / `CHAMPION_RACE` | `data.ts` | 排名页 / 夺冠榜数据 |
| `mergeLiveOverlay()` / `computeMatchMinute()` | `data.ts` | 把实时比分叠加进静态赛程 / 估算已开赛分钟 |
| `getTeam(code)` | `data.ts` | 按三字码取球队 |
| `getLiveOverlay()` | `football-api.ts` | 服务端获取实时 overlay（布局中调用） |

## 数据流

```
真实数据  data.ts: TEAMS / FIXTURES / KNOCKOUT / RESULTS
      │
      ├─► prediction-v2.ts (opus4.8 Elo 多因子引擎)
      │        ├─► wc-predictions.json      (逐场概率)
      │        └─► champion-sim-data.ts     (夺冠/晋级概率静态基线；实时值见 champion_sim 表)
      ├─► real-analysis.ts / market-data.ts (联网核实：阵容/伤停/战绩)
      │
      └─► data.ts 组装 MATCHES / 积分 / 夺冠榜 ─► 页面（RSC，静态预渲染）
                                                      ▲
   football-api.ts (实时比分) ─► /api/live ─► live-provider（客户端每 60s 叠加）
                                                  │
   prediction-v2 的 λ + 实时比分/红黄牌 + 技术统计(场面权重) ─► in-play.ts ─► 赛中实时分析卡片（客户端逐秒重算）
   poller ─► match_stats ─► /api/match-stats ─► useLiveStats（赛中 25s 轮询）
```

## 约定

- **真实数据与模型输出分离**：真实赛果维护在 `data.ts` 的 `RESULTS`；概率一律来自引擎产物，不在组件里手写估算。
- **更新赛果**：比赛结束后在 `RESULTS` 增加真实比分，并重新生成预测产物刷新概率。
- **Key 安全**：`api-key.ts` / `football-api.ts` 标记 `server-only`，API Key 绝不发往浏览器；生产用环境变量注入。
- **品牌**：面向用户的预测文案统一署名 **opus4.8**；注释中的历史版本号（v3–v6）仅为内部迭代记录。
