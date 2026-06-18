"use client"

import { useMemo, useState } from "react"
import { Trophy, Info } from "lucide-react"
import { type ChampionOdds } from "@/lib/data"
import { cn } from "@/lib/utils"
import { CountUp } from "@/components/count-up"
import { TeamFlag } from "@/components/team-flag"

const CONFEDS = [
  { key: "ALL", label: "全部" },
  { key: "UEFA", label: "欧洲" },
  { key: "CONMEBOL", label: "南美" },
  { key: "CONCACAF", label: "中北美" },
  { key: "AFC", label: "亚洲" },
  { key: "CAF", label: "非洲" },
  { key: "OFC", label: "大洋洲" },
]

export function ChampionBoard({ race }: { race: ChampionOdds[] }) {
  const [conf, setConf] = useState("ALL")

  const filtered = useMemo(
    () => race.filter((c) => conf === "ALL" || c.team.confederation === conf),
    [race, conf],
  )

  const top3 = race.slice(0, 3)
  const maxChamp = race[0]?.champion || 1

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent">
          <Trophy className="h-3.5 w-3.5" />
          锦标赛模拟
        </p>
        <h1 className="font-heading text-3xl font-700 tracking-tight text-balance sm:text-4xl">
          AI <span className="text-primary text-glow">夺冠概率</span>榜
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          基于 opus4.8 Elo 多因子引擎对整届赛事进行 2 万次蒙特卡洛模拟得出，并随真实赛果实时更新。已结束的场次直接代入真实比分，
          未赛场次按模型预期进球抽样，再逐轮推演 32 强淘汰赛直至决赛，统计每支球队在各阶段的晋级频率。
        </p>
      </header>

      {/* podium */}
      <Podium teams={top3} />

      {/* model note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          模型基于球队赛前实力（FIFA 排名 / Elo）、场地海拔与东道主加成等客观因子，对东道主（美/墨/加）会计入主场优势，
          因此其概率可能略高于纯实力排序。本榜单为娱乐性质的统计模拟，不构成任何投注建议。
        </p>
      </div>

      {/* confederation filter */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin">
        <div className="flex gap-2 pb-1">
          {CONFEDS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setConf(c.key)}
              className={cn(
                "press shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all",
                conf === c.key
                  ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* full board */}
      <div key={conf} className="stagger overflow-hidden rounded-2xl border border-border bg-card">
        {/* column header */}
        <div className="flex items-center gap-3 border-b border-border bg-secondary/50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          <span className="w-5 shrink-0 text-center">#</span>
          <span className="w-6 shrink-0" />
          <span className="flex-1">球队</span>
          <span className="hidden w-14 shrink-0 text-right sm:block">出线</span>
          <span className="hidden w-14 shrink-0 text-right sm:block">4 强</span>
          <span className="w-14 shrink-0 text-right">决赛</span>
          <span className="w-16 shrink-0 text-right">夺冠</span>
        </div>

        <ul className="divide-y divide-border/60">
          {filtered.map((c) => {
            const rank = race.indexOf(c) + 1
            return (
              <li
                key={c.team.code}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/40"
              >
                <span
                  className={cn(
                    "w-5 shrink-0 text-center font-heading text-sm font-700 tabular-nums",
                    rank <= 3 ? "text-accent" : "text-muted-foreground",
                  )}
                >
                  {rank}
                </span>
                <TeamFlag code={c.team.code} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold">{c.team.name}</span>
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {c.team.group} 组
                    </span>
                  </div>
                  {/* champion probability bar */}
                  <div className="mt-1.5 h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (c.champion / maxChamp) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {c.qualify.toFixed(0)}%
                </span>
                <span className="hidden w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
                  {c.semi.toFixed(1)}%
                </span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-foreground">
                  {c.final.toFixed(1)}%
                </span>
                <span className="w-16 shrink-0 text-right font-heading text-sm font-700 tabular-nums text-primary">
                  {c.champion.toFixed(1)}%
                </span>
              </li>
            )
          })}
        </ul>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">该大洲暂无参赛队</p>
        )}
      </div>
    </div>
  )
}

function Podium({ teams }: { teams: ChampionOdds[] }) {
  // visual order: 2nd, 1st, 3rd
  const order = [teams[1], teams[0], teams[2]]
  const heights = ["h-24", "h-32", "h-20"]
  const tones = ["bg-secondary", "bg-primary", "bg-accent/80"]
  const textTones = ["text-foreground", "text-primary-foreground", "text-accent-foreground"]
  const labels = ["亚军候选", "夺冠热门", "季军候选"]
  return (
    <div className="grid grid-cols-3 items-end gap-3">
      {order.map((c, i) =>
        c ? (
          <div key={c.team.code} className="flex flex-col items-center">
            {i === 1 && <Trophy className="mb-1 h-6 w-6 text-accent" />}
            <TeamFlag code={c.team.code} size="xl" rounded="rounded-lg" className="shadow-lg" />
            <span className="mt-1.5 text-center text-sm font-bold leading-tight">{c.team.name}</span>
            <span className="text-[11px] font-medium text-muted-foreground">{labels[i]}</span>
            <div
              className={cn(
                "mt-2 flex w-full flex-col items-center justify-center rounded-t-xl leading-none",
                heights[i],
                tones[i],
              )}
            >
              <span className={cn("font-heading text-2xl font-700 tabular-nums sm:text-3xl", textTones[i])}>
                <CountUp value={c.champion} decimals={1} suffix="%" />
              </span>
              <span className={cn("mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80", textTones[i])}>
                夺冠概率
              </span>
            </div>
          </div>
        ) : (
          <div key={i} />
        ),
      )}
    </div>
  )
}
