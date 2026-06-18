"use client"

import Link from "next/link"
import { getTeam } from "@/lib/data"
import { TeamFlag } from "@/components/team-flag"
import { useLiveMatches, LiveMinute } from "@/components/live-provider"

export function LiveTicker() {
  const matches = useLiveMatches()
  const live = matches.filter((m) => m.status === "live")
  const recent = matches.filter((m) => m.status === "finished").slice(-8)
  const items = [...live, ...recent]
  if (items.length === 0) return null

  const row = (key: string, ariaHidden = false) => (
    <div key={key} aria-hidden={ariaHidden} className="flex shrink-0 items-center gap-4 pr-4">
      {items.map((m) => {
        const h = getTeam(m.homeCode)
        const a = getTeam(m.awayCode)
        const isLive = m.status === "live"
        return (
          <Link
            key={key + m.id}
            href={`/match/${m.id}`}
            className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-secondary"
          >
            {isLive ? (
              <span className="flex items-center gap-1 font-bold text-destructive">
                <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-destructive" />
                <LiveMinute matchKey={`${m.homeCode}-${m.awayCode}`} kickoffISO={m.kickoff} />
              </span>
            ) : (
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                完
              </span>
            )}
            <span className="flex items-center gap-1.5 font-medium">
              <TeamFlag code={h.code} size="xs" /> {h.code}
            </span>
            <span className="font-mono font-bold text-foreground">
              {m.homeScore}-{m.awayScore}
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              {a.code} <TeamFlag code={a.code} size="xs" />
            </span>
          </Link>
        )
      })}
    </div>
  )

  return (
    <div
      className="group/ticker overflow-hidden border-t border-border/60 bg-card/50"
      aria-label="实时比分与近期赛果"
    >
      <div className="flex w-max animate-marquee group-hover/ticker:[animation-play-state:paused]">
        {row("a")}
        {row("b", true)}
      </div>
    </div>
  )
}
