# 数据来源与样例数据库

本文说明 WORLD CUP AI HUB 的数据来源、开源分发边界、本地数据库和样例数据库。

> [!IMPORTANT]
> 本仓库开源的是应用代码、静态基础数据、模型产物和人工构造的样例数据库。外部 API 返回的实时比分、阵容、事件、统计等数据不随仓库分发；使用者需要配置自己的 API Key，并在本地运行数据任务写入自己的数据库。

## 数据类型

| 数据类型 | 位置 | 来源 | 是否随仓库分发 |
| --- | --- | --- | --- |
| 球队、分组、赛程、场馆 | `lib/data.ts` | 官方赛程、公开资料、人工维护 | 是 |
| 离线预测结果 | `lib/wc-predictions.json`、`lib/champion-sim-data.ts` | 项目预测引擎生成 | 是 |
| 实时比分、状态、事件、阵容、裁判、统计 | `data/wc.db` | API-Football、football-data.org 等外部 API | 否 |
| 样例数据库 | `data/sample.wc.db` | 人工构造的示例数据 | 是 |

## 本地运行库

真实运行库默认路径是：

```text
data/wc.db
```

这个文件由 `scripts/poller.mjs` 和其他数据脚本写入。它属于本地运行状态，不提交到开源仓库。

如果本地没有 `data/wc.db`，服务端数据库层会创建空表。此时：

- 静态赛程和离线预测仍可显示。
- `/api/live` 返回空实时覆盖层或已有静态回退数据。
- 阵容、事件、技术统计、实时冠军模拟需要运行数据任务后才会出现。

## 样例数据库

仓库提供一个很小的人工构造样例库：

```text
data/sample.wc.db
```

它只用于说明 SQLite 表结构和字段格式，不代表真实比赛数据，也不来自外部 API。

重新生成样例库：

```bash
node scripts/create-sample-db.mjs
```

验证样例库：

```bash
node scripts/verify-sample-db.mjs
```

样例库包含最小示例：

- `live_scores`：未开赛、进行中、已完赛各一条。
- `lineups`：一场比赛的主客队示例阵容。
- `events`：示例进球和黄牌事件。
- `referees`：示例裁判画像。
- `match_stats`：主客队示例技术统计。
- `champion_sim` / `champion_sim_meta`：示例冠军概率快照。

## 实时数据任务

启动网站不会自动拉取实时数据。要写入真实运行库，需要配置自己的 API Key 后运行：

```bash
POLLER_ENABLED=1 node scripts/poller.mjs
```

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `API_FOOTBALL_KEY` | API-Football / API-SPORTS Key，当前主要实时数据源。 |
| `FOOTBALL_DATA_API_KEY` | football-data.org Key，可作为比分/状态备用数据源。 |
| `WC_DB_PATH` | 自定义 SQLite 数据库路径，默认 `data/wc.db`。 |
| `POLLER_ENABLED` | 必须显式设为 `1`，避免误启动常驻写库任务。 |

## 开源分发边界

- 不提交真实 API Key。
- 不提交 `.env.local` 或 `config/secrets/keys.local.mjs`。
- 不提交真实运行库 `data/wc.db`。
- 不提交 SQLite 运行态文件 `*.db-wal`、`*.db-shm`。
- 不把外部 API 原始返回数据作为开源数据集再分发，除非你已经确认对应服务条款允许。

## 数据准确性说明

本项目不是官方赛事数据源。赛程、比分、预测概率、阵容、事件、技术统计都可能受到数据源延迟、字段映射、接口可用性和模型假设影响。

预测结果是模型输出，仅供娱乐、讨论和技术研究，不构成投注建议。
