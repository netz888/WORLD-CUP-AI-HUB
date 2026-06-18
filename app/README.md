# `app/` — 路由与页面（App Router）

<sub>[← 项目根](../README.md) · [components](../components/README.md) · [ui](../components/ui/README.md) · [lib](../lib/README.md)</sub>

基于 Next.js **App Router**。页面默认是 React Server Component（服务端取数），交互逻辑下沉到
[`components/`](../components/README.md) 的客户端组件。

## 路由

| 路径 | 路由 | 渲染 | 说明 |
| --- | --- | --- | --- |
| `layout.tsx` | 全局 | 服务端 | 根布局，见下「布局职责」。 |
| `page.tsx` | `/` | 静态 | 首页，渲染 `ScheduleView`（赛程 + 今日焦点 + AI 夺冠榜）。 |
| `groups/page.tsx` | `/groups` | 静态 | 小组形势，渲染 `GroupsView`，12 组（A–L）实时积分榜。 |
| `rankings/page.tsx` | `/rankings` | 静态 | FIFA 排名，渲染 `RankingsView`，48 强排名。 |
| `champions/page.tsx` | `/champions` | **动态** | AI 夺冠榜，渲染 `ChampionBoard`；读 `champion_sim` 表（随赛果实时重算，DB 空回退静态基线）。 |
| `match/[id]/page.tsx` | `/match/:id` | **SSG** | 比赛详情，动态路由。`generateStaticParams` 预生成全部比赛页，渲染 `MatchAnalysis`。 |
| `api/live/route.ts` | `/api/live` | **动态** | 实时比分轮询端点（`force-dynamic`），返回实时 overlay + `championRace`（夺冠榜实时快照，供客户端组件用）。 |
| `globals.css` | — | — | 全局样式 + **设计令牌**（颜色 / 圆角 / 字体变量）、Tailwind v4 主题、自定义动画与 `@utility` 工具类。 |

## 布局职责（`layout.tsx`）

- 注册字体（Geist / Geist Mono / Oswald）与 `<html lang="zh-CN">` 深色背景；定义 SEO `metadata` 与 `viewport`。
- **服务端拉取实时数据**：`getLiveOverlay()`（每 60s `revalidate`）与 `getRepoStars()`（缓存 1h），失败均降级。
- 挂载全站外壳 `SiteShell`，并用 `LiveProvider` 向客户端注入实时 overlay；生产环境挂载 Vercel Analytics。

## 渲染策略

- **服务端优先**：页面从 [`lib/data.ts`](../lib/README.md) 同步读静态数据；实时比分由服务端 `lib/football-api.ts` 获取。
- **静态可预渲染**：`/match/[id]` 经 `generateStaticParams` 完全静态预渲染；唯一动态数据（实时比分）由客户端 `live-provider` 轮询 `/api/live` 叠加。

## 约定

- **样式走令牌**：颜色用 `globals.css` 的语义令牌（如 `bg-card` / `text-primary`），不硬编码色值。
- **自定义工具类用 `@utility`**：Tailwind v4 下自定义工具类（如 `scrollbar-thin`）必须用 `@utility` 定义，新增后需重启 dev server。
- **交互交给客户端组件**：页面只取数与组合，`"use client"` 组件承载交互。
- 新增页面时，在上表补充对应说明。
