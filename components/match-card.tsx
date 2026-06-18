import { ViewTransition } from "react"
import Link from "next/link"
import { ChevronRight, MapPin, Sparkles, Flame } from "lucide-react"
import { type Match, getTeam } from "@/lib/data"
import { formatTime } from "@/lib/time"
import { ProbBar } from "@/components/prob-bar"
import { TeamFlag } from "@/components/team-flag"
import { LiveMinute } from "@/components/live-provider"
import { cn } from "@/lib/utils"

export function MatchCard({ match, tz }: { match: Match; tz: string }) {
  const h = getTeam(match.homeCode)
  const a = getTeam(match.awayCode)
  const live = match.status === "live"
  const finished = match.status === "finished"

  return (
    <Link
      href={`/match/${match.id}`}
      transitionTypes={["nav-forward"]}
      className="group relative block overflow-hidden rounded-2xl border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:glow-ring"
    >
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-0.5 font-bold text-foreground">
            {match.group} 组
          </span>
          {/* 开球时间始终正常显示 */}
          <span
            className={cn(
              "font-bold tabular-nums",
              live ? "text-foreground" : finished ? "text-muted-foreground" : "text-primary",
            )}
          >
            {formatTime(match.kickoff, tz)}
          </span>
          {/* 状态标签：跟在时间之后 */}
          {live ? (
            <span className="flex items-center gap-1 rounded-md bg-destructive/15 px-1.5 py-0.5 font-bold text-destructive">
              <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-destructive" />
              已开赛 <LiveMinute matchKey={`${match.homeCode}-${match.awayCode}`} kickoffISO={match.kickoff} />
            </span>
          ) : finished ? (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-semibold text-muted-foreground">
              已完赛
            </span>
          ) : (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
              未开赛
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {match.city}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamSide matchId={match.id} code={h.code} name={h.name} rank={h.fifaRank} align="start" />

        <div className="flex flex-col items-center px-1">
          {finished || live ? (
            <div className="flex items-center gap-2 font-heading text-3xl font-700 tabular-nums">
              <span className={cn(live && "text-foreground")}>{match.homeScore}</span>
              <span className="text-muted-foreground/50">:</span>
              <span className={cn(live && "text-foreground")}>{match.awayScore}</span>
            </div>
          ) : (
            <span className="font-heading text-xl font-600 text-muted-foreground">VS</span>
          )}
        </div>

        <TeamSide matchId={match.id} code={a.code} name={a.name} rank={a.fifaRank} align="end" />
      </div>

      <div className="mt-4 rounded-xl bg-secondary/50 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Sparkles className="h-3 w-3" />
          AI 胜负预测
          <span className="ml-auto font-medium normal-case text-muted-foreground">
            置信度 {match.ai.confidence}%
          </span>
        </div>
        <ProbBar homeWin={match.ai.homeWin} draw={match.ai.draw} awayWin={match.ai.awayWin} />
        {/* 冷门信号：仅“强弱分明但弱队有翻车概率”的场次显示，势均力敌不显示 */}
        {match.ai.upsetIndex >= 10 && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent/10 px-2 py-1.5 text-[11px]">
            <Flame className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="font-bold text-accent">冷门预警</span>
            <span className="truncate text-muted-foreground">
              {match.ai.upsetLabel} · {match.ai.upsetProb}%
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-center gap-1 text-xs font-semibold text-muted-foreground transition-colors group-hover:text-primary">
        查看完整 AI 分析
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  )
}

function TeamSide({
  matchId,
  code,
  name,
  rank,
  align,
}: {
  matchId: string
  code: string
  name: string
  rank: number
  align: "start" | "end"
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        align === "end" ? "flex-row-reverse text-right" : "text-left",
      )}
    >
      <ViewTransition name={`flag-${matchId}-${code}`} share="morph">
        <TeamFlag code={code} size="lg" />
      </ViewTransition>
      <div className={cn("flex min-w-0 flex-col", align === "end" && "items-end")}>
        <span className="truncate text-sm font-bold leading-tight">{name}</span>
        <span className="text-[11px] font-medium text-muted-foreground">
          FIFA #{rank}
        </span>
      </div>
    </div>
  )
}
