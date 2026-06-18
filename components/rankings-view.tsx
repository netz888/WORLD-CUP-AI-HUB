"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { type Team } from "@/lib/data"
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

export function RankingsView({ teams }: { teams: Team[] }) {
  const [q, setQ] = useState("")
  const [conf, setConf] = useState("ALL")

  const ranked = useMemo(
    () => [...teams].sort((a, b) => a.fifaRank - b.fifaRank),
    [teams],
  )

  const filtered = useMemo(
    () =>
      ranked.filter((t) => {
        const matchConf = conf === "ALL" || t.confederation === conf
        const matchQ =
          q === "" ||
          t.name.includes(q) ||
          t.enName.toLowerCase().includes(q.toLowerCase()) ||
          t.code.toLowerCase().includes(q.toLowerCase())
        return matchConf && matchQ
      }),
    [ranked, q, conf],
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            数据中心
          </p>
          <h1 className="font-heading text-3xl font-700 tracking-tight sm:text-4xl">
            FIFA <span className="text-primary text-glow">世界排名</span>总榜
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            共 {teams.length} 支 2026 世界杯参赛队，按各自的 FIFA 世界排名位次排列（如新西兰世界排名第 85
            位）。支持按大洲筛选与搜索球队。
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card px-5 py-3 text-center">
          <div className="font-heading text-3xl font-700 tabular-nums text-primary">
            <CountUp value={teams.length} />
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">支参赛队</div>
        </div>
      </header>

      {/* podium top 3 */}
      <Podium teams={ranked.slice(0, 3)} />

      {/* controls */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索球队（中文 / 英文 / 代码）"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin">
          <div className="flex gap-2 pb-1">
            {CONFEDS.map((c) => (
              <button
                key={c.key}
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
      </div>

      {/* ranking list */}
      <div key={conf + q} className="stagger overflow-hidden rounded-2xl border border-border bg-card">
        {filtered.map((t, i) => (
          <div
            key={t.code}
            className="flex items-center gap-3 border-b border-border/60 px-4 py-3 transition-colors last:border-0 hover:bg-secondary/40"
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-heading text-lg font-700 tabular-nums",
                i < 3 ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <TeamFlag code={t.code} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-bold">{t.name}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {t.group} 组
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{t.enName}</p>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-heading text-base font-700 tabular-nums text-primary">
                #{t.fifaRank}
              </div>
              <div className="text-[10px] font-medium text-muted-foreground">世界排名</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">未找到匹配的球队</p>
        )}
      </div>
    </div>
  )
}

function Podium({ teams }: { teams: Team[] }) {
  // order: 2nd, 1st, 3rd for visual podium
  const order = [teams[1], teams[0], teams[2]]
  const heights = ["h-24", "h-32", "h-20"]
  const tones = ["bg-secondary", "bg-primary", "bg-accent/80"]
  const textTones = ["text-foreground", "text-primary-foreground", "text-accent-foreground"]
  return (
    <div className="grid grid-cols-3 items-end gap-3">
      {order.map((t, i) =>
        t ? (
          <div key={t.code} className="flex flex-col items-center">
            <TeamFlag code={t.code} size="xl" rounded="rounded-lg" className="shadow-lg" />
            <span className="mt-1 text-center text-sm font-bold leading-tight">{t.name}</span>
            <span className="text-[11px] font-medium text-muted-foreground">{t.enName}</span>
            <div
              className={cn(
                "mt-2 flex w-full flex-col items-center justify-start rounded-t-xl pt-2 leading-none",
                heights[i],
                tones[i],
              )}
            >
              <span className={cn("font-heading text-3xl font-700", textTones[i])}>
                <CountUp value={t.fifaRank} />
              </span>
              <span className={cn("mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80", textTones[i])}>
                世界排名
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
