"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Flame, Sparkles, ChevronRight, Skull } from "lucide-react"
import { MATCHES, getTeam, computeStandings, GROUPS } from "@/lib/data"
import { formatTime, formatDateLabel } from "@/lib/time"
import { TeamFlag } from "@/components/team-flag"

const DAY_MS = 86_400_000
const HOST_CODES = new Set(["USA", "MEX", "CAN"]) // 2026 东道主
const HOLDER_CODE = "ARG" // 卫冕冠军（2022 世界杯）

// 由 "i - j" 形式的预测比分算出总进球数，用于「进球大战」判定。
function predictedGoals(score: string): number {
  const m = score.match(/(\d+)\s*-\s*(\d+)/)
  return m ? Number(m[1]) + Number(m[2]) : 0
}

// 按比赛实际特征动态判定焦点类型——不再一律写死「强强对话」。
// 优先级从高到低（越特殊越靠前），命中即返回，确保任一被选中的比赛都有贴切标签。
function focusType(
  rankH: number,
  rankA: number,
  homeCode: string,
  awayCode: string,
  ai: { homeWin: number; awayWin: number; predictedScore: string; upsetIndex: number },
): string {
  const min = Math.min(rankH, rankA)
  const gap = Math.abs(rankH - rankA)
  const goals = predictedGoals(ai.predictedScore)
  if (rankH <= 16 && rankA <= 16) return "强强对话" // ① 双方均世界前 16
  if (homeCode === HOLDER_CODE || awayCode === HOLDER_CODE) return "卫冕冠军" // ② 阿根廷出战
  if (HOST_CODES.has(homeCode) || HOST_CODES.has(awayCode)) return "东道主登场" // ③ 美/墨/加出战
  if (ai.upsetIndex >= 40) return "冷门预警" // ④ 冷门指数高：强弱分明但弱队有翻车概率
  if (goals >= 4) return "进球大战" // ⑤ 预测总进球 ≥ 4
  if (gap <= 8) return "势均力敌" // ⑥ 排名接近
  if (min <= 12) return "豪门出击" // ⑦ 一方世界前 12、另一方中游
  if (gap >= 35) return "实力悬殊" // ⑧ 排名差距悬殊
  return "焦点之战" // ⑨ 兜底
}

export function FeaturedSection({ tz }: { tz: string }) {
  // 客户端挂载后才取真实时间，避免 SSR/hydration 不一致（now=0 表示尚未挂载）。
  const [now, setNow] = useState(0)
  useEffect(() => setNow(Date.now()), [])

  // 时间窗口：保留「过去 1 天 ~ 未来 2 天」内的比赛——
  // 完赛超过一天的自动移除，且只展示近两天即将开打的，让焦点始终新鲜。
  // 挂载前（now=0）退化为「未完赛」过滤，保证首屏与服务端渲染一致。
  const inWindow = useMemo(() => {
    return (kickoff: string, status: string) => {
      if (now === 0) return status !== "finished"
      const k = new Date(kickoff).getTime()
      return k >= now - DAY_MS && k <= now + 2 * DAY_MS
    }
  }, [now])

  // 焦点战：窗口内、双方排名都靠前的比赛；窗口内不足 2 场时用之后最近的强强对话补足。
  const featured = useMemo(() => {
    const pool = MATCHES.map((m) => {
      const h = getTeam(m.homeCode)
      const a = getTeam(m.awayCode)
      return { m, h, a, strength: 100 - (h.fifaRank + a.fifaRank) / 2, k: new Date(m.kickoff).getTime() }
    })
    const picked = pool
      .filter((p) => inWindow(p.m.kickoff, p.m.status))
      .sort((x, y) => y.strength - x.strength)
      .slice(0, 2)
    if (now > 0 && picked.length < 2) {
      const used = new Set(picked.map((p) => p.m.id))
      const extra = pool
        .filter((p) => !used.has(p.m.id) && p.k > now + 2 * DAY_MS)
        .sort((x, y) => x.k - y.k || y.strength - x.strength)
        .slice(0, 2 - picked.length)
      return [...picked, ...extra]
    }
    return picked
  }, [inWindow, now])

  // 高置信度 AI 推荐：优先取窗口内置信度最高的；窗口内没有，则取之后最近即将开打的一场
  // （而非远在未来的全局最高），保持与焦点战一致的「近两天」时效。
  const topPick = useMemo(() => {
    const within = [...MATCHES]
      .filter((m) => inWindow(m.kickoff, m.status))
      .sort((x, y) => y.ai.confidence - x.ai.confidence)[0]
    if (within) return within
    if (now === 0) return [...MATCHES].filter((m) => m.status !== "finished").sort((x, y) => y.ai.confidence - x.ai.confidence)[0]
    return [...MATCHES]
      .filter((m) => new Date(m.kickoff).getTime() > now + 2 * DAY_MS)
      .sort((x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime() || y.ai.confidence - x.ai.confidence)[0]
  }, [inWindow, now])

  // 死亡之组：组内平均 FIFA 排名最高的小组（结构性焦点，不受时间窗口影响）。
  const deathGroup = GROUPS.map((g) => {
    const st = computeStandings(g)
    const avg = st.reduce((s, t) => s + t.team.fifaRank, 0) / st.length
    return { g, avg, st }
  }).sort((x, y) => x.avg - y.avg)[0]

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-heading text-lg font-700 tracking-tight">
        <Flame className="h-5 w-5 text-accent" />
        今日焦点
      </h2>

      <div className="grid gap-3 lg:grid-cols-2">
        {featured.map(({ m, h, a }) => (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            className="group relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:opacity-100" />
            <div className="mb-3 flex items-center justify-between">
              <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
                {m.group} 组 · {focusType(h.fifaRank, a.fifaRank, h.code, a.code, m.ai)}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground">
                {formatDateLabel(m.kickoff, tz)} {formatTime(m.kickoff, tz)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-1 flex-col items-center gap-1.5">
                <TeamFlag code={h.code} size="lg" />
                <span className="text-center text-xs font-bold leading-tight">{h.name}</span>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="font-heading text-base font-700 text-primary">
                  {m.ai.homeWin}%
                </span>
                <span className="text-[10px] text-muted-foreground">VS</span>
                <span className="font-heading text-base font-700 text-accent">
                  {m.ai.awayWin}%
                </span>
              </div>
              <div className="flex flex-1 flex-col items-center gap-1.5">
                <TeamFlag code={a.code} size="lg" />
                <span className="text-center text-xs font-bold leading-tight">{a.name}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* AI 高置信度推荐 */}
        {topPick && (
          <Link
            href={`/match/${topPick.id}`}
            className="group flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-all hover:bg-primary/10"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
                AI 高置信度推荐
              </p>
              <p className="truncate text-sm font-bold">
                {getTeam(topPick.homeCode).name} vs {getTeam(topPick.awayCode).name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                置信度 {topPick.ai.confidence}% · 预测 {topPick.ai.predictedScore}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}

        {/* 死亡之组 */}
        {deathGroup && (
          <Link
            href="/groups"
            className="group flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 transition-all hover:bg-destructive/10"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive text-background">
              <Skull className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-destructive">
                死亡之组
              </p>
              <p className="text-sm font-bold">{deathGroup.g} 组</p>
              <div className="mt-0.5 flex items-center gap-1">
                {deathGroup.st.slice(0, 4).map((t) => (
                  <TeamFlag key={t.team.code} code={t.team.code} size="xs" />
                ))}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
    </section>
  )
}
