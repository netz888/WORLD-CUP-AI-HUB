"use client"

import Link from "next/link"
import { Trophy, ChevronRight } from "lucide-react"
import { TeamFlag } from "@/components/team-flag"
import { useChampionRace } from "@/components/live-provider"

const MEDAL = ["text-accent", "text-muted-foreground", "text-primary"] as const

export function ChampionRace({ count = 8 }: { count?: number }) {
  // 实时夺冠榜（随真实赛果更新）；全站已被 LiveProvider 包裹。
  const top = useChampionRace(count)
  const max = top[0]?.champion || 1

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-heading text-lg font-700 tracking-tight">
          <Trophy className="h-5 w-5 text-accent" />
          AI 夺冠概率榜
        </h2>
        <Link
          href="/champions"
          className="press flex items-center gap-0.5 text-[11px] font-semibold text-primary transition-colors hover:text-primary/80"
        >
          完整榜单
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <ul className="divide-y divide-border/60">
          {top.map((c, i) => (
            <li
              key={c.team.code}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/40"
            >
              <span
                className={`w-5 shrink-0 text-center font-heading text-sm font-700 tabular-nums ${
                  i < 3 ? MEDAL[i] : "text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
              <TeamFlag code={c.team.code} size="sm" />
              <span className="w-20 shrink-0 truncate text-sm font-bold">{c.team.name}</span>

              {/* probability bar */}
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (c.champion / max) * 100)}%` }}
                />
              </div>

              <span className="w-12 shrink-0 text-right font-heading text-sm font-700 tabular-nums text-primary">
                {c.champion.toFixed(1)}%
              </span>
              <span className="hidden w-24 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                进决赛 {c.final.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
