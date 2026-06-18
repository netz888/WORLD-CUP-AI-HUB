import { ViewTransition } from "react"
import Link from "next/link"
import { MapPin, HelpCircle, Lock, Trophy, Sparkles, Flame, ChevronRight } from "lucide-react"
import { type KnockoutMatch, type Match, KNOCKOUT_STAGE_LABEL, getTeam } from "@/lib/data"
import { formatTime } from "@/lib/time"
import { ProbBar } from "@/components/prob-bar"
import { TeamFlag } from "@/components/team-flag"
import { LiveMinute } from "@/components/live-provider"
import { cn } from "@/lib/utils"

// 淘汰赛卡片：
// · match 为 null → 对阵未确定，渲染「待定」占位（席位标签 + 问号头像）。
// · match 已填充 → 对阵已由 knockout-resolver 解析出真实球队，渲染真实队名 + 国旗
//   + 实时比分/状态 + AI 预测条，并链接到 /match/:id 深度分析（与小组赛同款）。
export function KnockoutCard({
  ko,
  match,
  tz,
}: {
  ko: KnockoutMatch
  match: Match | null
  tz: string
}) {
  const isFinal = ko.stage === "FINAL"

  const header = (
    <div className="mb-3 flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-0.5 font-bold",
            isFinal ? "bg-primary/15 text-primary" : "bg-secondary text-foreground",
          )}
        >
          {isFinal && <Trophy className="h-3 w-3" aria-hidden="true" />}
          {KNOCKOUT_STAGE_LABEL[ko.stage]}
        </span>
        <span className="font-semibold text-muted-foreground">第 {ko.matchNo} 场</span>
        <span className="font-bold tabular-nums text-primary">{formatTime(ko.kickoff, tz)}</span>
        {match && <StatusTag match={match} />}
      </div>
      <span className="flex items-center gap-1 text-muted-foreground">
        <MapPin className="h-3 w-3" />
        {ko.city}
      </span>
    </div>
  )

  // ── 未确定：保持「待定」占位 ──────────────────────────────────────────────
  if (!match) {
    return (
      <div
        className={cn(
          "relative block overflow-hidden rounded-2xl border bg-card p-4",
          isFinal ? "border-primary/50 glow-ring" : "border-dashed border-border",
        )}
      >
        {header}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <SeatSide label={ko.homeSeat} align="start" />
          <span className="px-1 font-heading text-xl font-600 text-muted-foreground">VS</span>
          <SeatSide label={ko.awaySeat} align="end" />
        </div>
        <div className="mt-4 flex items-center justify-center gap-1.5 rounded-xl bg-secondary/50 px-3 py-2 text-[11px] font-medium text-muted-foreground">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          对阵将在相关比赛结束后确定
        </div>
      </div>
    )
  }

  // ── 已确定：真实球队 + 实时比分 + AI 预测，链接到深度分析 ──────────────────
  const h = getTeam(match.homeCode)
  const a = getTeam(match.awayCode)
  const live = match.status === "live"
  const finished = match.status === "finished"

  return (
    <Link
      href={`/match/${match.id}`}
      transitionTypes={["nav-forward"]}
      className={cn(
        "group relative block overflow-hidden rounded-2xl border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:glow-ring",
        isFinal ? "border-primary/50 glow-ring" : "border-border",
      )}
    >
      {header}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <TeamSide matchId={match.id} code={h.code} name={h.name} rank={h.fifaRank} align="start" />
        <div className="flex flex-col items-center px-1">
          {finished || live ? (
            <div className="flex items-center gap-2 font-heading text-3xl font-700 tabular-nums">
              <span>{match.homeScore}</span>
              <span className="text-muted-foreground/50">:</span>
              <span>{match.awayScore}</span>
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

function StatusTag({ match }: { match: Match }) {
  if (match.status === "live") {
    return (
      <span className="flex items-center gap-1 rounded-md bg-destructive/15 px-1.5 py-0.5 font-bold text-destructive">
        <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-destructive" />
        已开赛 <LiveMinute matchKey={`${match.homeCode}-${match.awayCode}`} kickoffISO={match.kickoff} />
      </span>
    )
  }
  if (match.status === "finished") {
    return (
      <span className="rounded-md bg-secondary px-1.5 py-0.5 font-semibold text-muted-foreground">
        已完赛
      </span>
    )
  }
  return (
    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">未开赛</span>
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
        <span className="text-[11px] font-medium text-muted-foreground">FIFA #{rank}</span>
      </div>
    </div>
  )
}

function SeatSide({ label, align }: { label: string; align: "start" | "end" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        align === "end" ? "flex-row-reverse text-right" : "text-left",
      )}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-muted/30"
        aria-hidden="true"
      >
        <HelpCircle className="h-4 w-4 text-muted-foreground/60" />
      </div>
      <div className={cn("flex min-w-0 flex-col", align === "end" && "items-end")}>
        <span className="text-pretty text-sm font-bold leading-tight text-foreground/80">{label}</span>
        <span className="text-[11px] font-medium text-muted-foreground">待定</span>
      </div>
    </div>
  )
}
