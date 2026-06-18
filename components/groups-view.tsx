"use client"

import { useState } from "react"
import { type Standing, type Team } from "@/lib/data"
import { cn } from "@/lib/utils"
import { TeamFlag } from "@/components/team-flag"
import { useLiveStandings } from "@/components/live-provider"

type GroupData = {
  group: string
  standings: (Standing & { team: Team })[]
}

export function GroupsView({ data }: { data: GroupData[] }) {
  const [active, setActive] = useState("ALL")
  const shown = active === "ALL" ? data : data.filter((d) => d.group === active)

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent">
          小组形势
        </p>
        <h1 className="font-heading text-3xl font-700 tracking-tight text-balance sm:text-4xl">
          实时<span className="text-primary text-glow">积分榜</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          各小组实时战绩：场次、胜平负、进失球与积分。前两名出线（绿色），第三名进入最佳成绩排名（金色）。
        </p>
      </header>

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          <Chip active={active === "ALL"} onClick={() => setActive("ALL")}>
            全部
          </Chip>
          {data.map((d) => (
            <Chip key={d.group} active={active === d.group} onClick={() => setActive(d.group)}>
              {d.group} 组
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1 rounded bg-primary" />
          直接出线（前 2）
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1 rounded bg-accent" />
          最佳第三名候选
        </span>
      </div>

      <div key={active} className="stagger grid gap-4 lg:grid-cols-2">
        {shown.map((d) => (
          <GroupTable key={d.group} data={d} />
        ))}
      </div>
    </div>
  )
}

function GroupTable({ data }: { data: GroupData }) {
  // 用合并了实时比分的数据重算积分榜（无实时数据时与静态结果一致）。
  const standings = useLiveStandings(data.group)
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg hover:shadow-primary/5">
      <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary font-heading text-sm font-700 text-primary-foreground">
          {data.group}
        </span>
        <span className="font-heading text-base font-600">{data.group} 组</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase text-muted-foreground">
              <th className="py-2 pl-4 text-left font-semibold">#</th>
              <th className="py-2 text-left font-semibold">球队</th>
              <th className="px-1.5 py-2 text-center font-semibold">赛</th>
              <th className="px-1.5 py-2 text-center font-semibold">胜</th>
              <th className="px-1.5 py-2 text-center font-semibold">平</th>
              <th className="px-1.5 py-2 text-center font-semibold">负</th>
              <th className="px-1.5 py-2 text-center font-semibold">进</th>
              <th className="px-1.5 py-2 text-center font-semibold">失</th>
              <th className="px-1.5 py-2 text-center font-semibold">+/-</th>
              <th className="px-3 py-2 text-center font-semibold text-foreground">积分</th>
              <th className="px-3 py-2 text-right font-semibold text-primary">出线率</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const gd = s.goalsFor - s.goalsAgainst
              return (
                <tr
                  key={s.teamCode}
                  className="border-t border-border/60 transition-colors hover:bg-secondary/40"
                >
                  <td className="relative py-2.5 pl-4">
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r",
                        i < 2 ? "bg-primary" : i === 2 ? "bg-accent" : "bg-transparent",
                      )}
                    />
                    <span className="font-mono text-xs font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <TeamFlag code={s.team.code} size="sm" />
                      <span className="font-semibold">{s.team.name}</span>
                    </div>
                  </td>
                  <Cell>{s.played}</Cell>
                  <Cell className="text-primary">{s.win}</Cell>
                  <Cell>{s.draw}</Cell>
                  <Cell className="text-destructive">{s.loss}</Cell>
                  <Cell>{s.goalsFor}</Cell>
                  <Cell>{s.goalsAgainst}</Cell>
                  <Cell className={cn(gd > 0 && "text-primary", gd < 0 && "text-destructive")}>
                    {gd > 0 ? `+${gd}` : gd}
                  </Cell>
                  <td className="px-3 py-2.5 text-center">
                    <span className="font-heading text-base font-700">{s.points}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-secondary sm:block">
                        <div
                          className="animate-bar h-full rounded-full bg-primary"
                          style={{ width: `${s.qualifyProb}%` }}
                        />
                      </div>
                      <span className="w-9 text-right font-mono text-xs font-bold tabular-nums text-primary">
                        {s.qualifyProb}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn("px-1.5 py-2.5 text-center tabular-nums text-muted-foreground", className)}>
      {children}
    </td>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
