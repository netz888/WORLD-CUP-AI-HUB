"use client"

import { ViewTransition } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  MapPin,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Activity,
  Users,
  HeartPulse,
  ClipboardList,
  Flag,
  Mountain,
  CloudSun,
  Thermometer,
  Wind,
  Droplets,
  BarChart3,
  Gauge,
  Swords,
  AlertTriangle,
  ArrowLeftRight,
} from "lucide-react"
import { type Match, type MatchEvent, getTeam } from "@/lib/data"
import { formatTime, formatDateLabel } from "@/lib/time"
import { ProbBar } from "@/components/prob-bar"
import { TeamFlag } from "@/components/team-flag"
import { FormRow } from "@/components/form-badge"
import { Pitch } from "@/components/pitch"
import { RadarCompare } from "@/components/radar-compare"
import { useLiveMatches, useLiveEvents, LiveMinute } from "@/components/live-provider"
import { InPlayAnalysis } from "@/components/in-play-analysis"
import { cn } from "@/lib/utils"

const TZ = "Asia/Shanghai"

export function MatchAnalysis({ match: staticMatch }: { match: Match }) {
  // 用实时数据仅叠加该场的状态/比分/分钟；其余字段（含服务端注入的真实阵容 detail、AI 分析）
  // 必须保留 staticMatch 的值——不能整体替换成客户端 MATCHES 版本，否则会丢掉服务端的 DB 覆盖。
  const liveMatches = useLiveMatches()
  const liveVersion = liveMatches.find((m) => m.id === staticMatch.id)
  const match: Match = liveVersion
    ? {
        ...staticMatch,
        status: liveVersion.status,
        kickoff: liveVersion.kickoff,
        homeScore: liveVersion.homeScore,
        awayScore: liveVersion.awayScore,
        minute: liveVersion.minute,
      }
    : staticMatch
  const h = getTeam(match.homeCode)
  const a = getTeam(match.awayCode)
  const live = match.status === "live"
  const finished = match.status === "finished"
  const d = match.detail
  const realData = d.realData ?? (d.dataMode === "real"
    ? { lineups: true, events: true, referee: true, coaches: true, injuries: true, factors: true }
    : {})
  const hasRealLineups = !!realData.lineups
  const hasRealInjuries = !!realData.injuries
  const hasRealCoaches = !!realData.coaches
  const hasRealReferee = !!realData.referee
  // 进行中时轮询该场实时事件时间线；否则用服务端注入的静态事件。
  const timelineEvents = useLiveEvents(`${match.homeCode}-${match.awayCode}`, live, realData.events ? (d.events ?? []) : [])

  const predictedWinner =
    match.ai.homeWin > match.ai.awayWin
      ? h
      : match.ai.awayWin > match.ai.homeWin
        ? a
        : null

  const maxScoreProb = Math.max(...d.scoreProbs.map((s) => s.prob))

  // derive comparative strength metrics (0-100) for radar
  const rankScore = (t: typeof h) => Math.round(100 - Math.min(t.fifaRank, 60) * 1.4)
  const radarAxes = [
    { label: "攻击", home: clampPct(match.ai.homeWin + 25), away: clampPct(match.ai.awayWin + 25) },
    { label: "防守", home: clampPct(100 - match.ai.awayWin - 10), away: clampPct(100 - match.ai.homeWin - 10) },
    { label: "排名", home: rankScore(h), away: rankScore(a) },
    {
      label: "状态",
      // 仅在有联网核实近况时用真实战绩；否则用胜负概率派生的中性值，避免虚构状态差
      home: match.ai.formVerified ? formScore(match.ai.formHome) : clampPct(match.ai.homeWin + match.ai.draw / 2),
      away: match.ai.formVerified ? formScore(match.ai.formAway) : clampPct(match.ai.awayWin + match.ai.draw / 2),
    },
    { label: "控场", home: clampPct(match.ai.homeWin + match.ai.draw / 2), away: clampPct(match.ai.awayWin + match.ai.draw / 2) },
    { label: "深度", home: rankScore(h) - 4, away: rankScore(a) - 4 },
  ]

  return (
    <div className="space-y-5">
      <Link
        href="/"
        transitionTypes={["nav-back"]}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        返回赛程
      </Link>

      {/* match header */}
      <div className="pitch-markings pitch-stripes relative overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-card to-secondary/30 p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(50%_100%_at_50%_0%,oklch(0.85_0.21_145/0.14),transparent)]" />
        <div className="mb-5 flex items-center justify-center gap-2 text-xs">
          <span className="rounded-md bg-secondary px-2 py-0.5 font-bold">
            {match.group} 组 · {match.stage}
          </span>
          <span
            className={cn(
              "font-bold",
              live ? "text-foreground" : finished ? "text-muted-foreground" : "text-primary",
            )}
          >
            {formatDateLabel(match.kickoff, TZ)} {formatTime(match.kickoff, TZ)}
          </span>
          {live ? (
            <span className="flex items-center gap-1 rounded-md bg-destructive/15 px-1.5 py-0.5 font-bold text-destructive">
              <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-destructive" />
              已开赛 <LiveMinute matchKey={`${match.homeCode}-${match.awayCode}`} kickoffISO={match.kickoff} />
            </span>
          ) : finished ? (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-semibold text-muted-foreground">已完赛</span>
          ) : (
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
              未开赛
            </span>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamHead team={h} matchId={match.id} />
          <div className="flex flex-col items-center">
            {finished || live ? (
              <div className="font-heading text-4xl font-700 tabular-nums sm:text-5xl">
                {match.homeScore}
                <span className="mx-1 text-muted-foreground/40">:</span>
                {match.awayScore}
              </div>
            ) : (
              <span className="font-heading text-2xl font-600 text-muted-foreground">
                VS
              </span>
            )}
            <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {match.venue}
            </span>
          </div>
          <TeamHead team={a} matchId={match.id} />
        </div>
      </div>

      {/* 模型推演：常驻三态（未开赛=赛前推演 / 进行中=实时 / 已完赛=复盘），组件内部自适配 */}
      <InPlayAnalysis match={match} />

      {/* AI prediction summary */}
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 glow-ring">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-base font-700 leading-none">AI 综合研判</h2>
              {d.dataMode === "real" ? (
                <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                  联网真实数据
                </span>
              ) : (
                <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  模型推算
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              模型置信度 {match.ai.confidence}%
            </p>
          </div>
          {predictedWinner && (
            <span className="ml-auto flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
              <Trophy className="h-3.5 w-3.5" />
              看好 {predictedWinner.name}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">{match.ai.summary}</p>
      </section>

      {/* calibrated probability + predicted score */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 sm:col-span-2">
          <SectionTitle icon={TrendingUp}>校准后胜平负概率</SectionTitle>
          <ProbBar
            className="mt-4"
            homeWin={match.ai.homeWin}
            draw={match.ai.draw}
            awayWin={match.ai.awayWin}
          />
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <Stat label={`${h.code} 主胜`} value={`${match.ai.homeWin}%`} tone="primary" />
            <Stat label="平局" value={`${match.ai.draw}%`} tone="muted" />
            <Stat label={`${a.code} 客胜`} value={`${match.ai.awayWin}%`} tone="accent" />
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-secondary/50 p-3">
            <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">{d.calibrationNote}</p>
          </div>
        </div>
        <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
          <SectionTitle icon={Target}>最有把握的判断</SectionTitle>
          {d.topInsight ? (
            <div className="flex flex-1 flex-col items-center justify-center py-3">
              <span className="font-heading text-2xl font-700 text-primary text-glow text-center leading-snug">
                {insightText(d.topInsight.label, h.name, a.name)}
              </span>
              <span className="mt-2 font-heading text-4xl font-700 text-primary tabular-nums">{d.topInsight.prob}%</span>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-3 text-center">
              <span className="font-heading text-xl font-700 text-foreground leading-snug">势均力敌</span>
              <span className="mt-2 text-xs text-muted-foreground">无单边强判断，关注盘口与平局</span>
            </div>
          )}
          <div className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>最可能比分</span>
            <span className="font-heading text-base font-700 text-foreground tabular-nums">{match.ai.predictedScore}</span>
            <span className="text-[10px] opacity-70">(单一比分概率天然偏低)</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat label="进球数 >2.5" value={`${d.over25}%`} />
            <MiniStat label="双方均进球" value={`${d.bttRatio}%`} />
          </div>
        </div>
      </div>

      {/* WS1：结果归并桶 + 盘口（取代原始散比分主视图） */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={BarChart3}>结果与盘口</SectionTitle>

        {d.marginBuckets && (
          <div className="mt-4 space-y-2.5">
            {(() => {
              const b = d.marginBuckets!
              const vals = [b.homeBy2Plus, b.homeBy1, b.draw, b.awayBy1, b.awayBy2Plus]
              const mx = Math.max(...vals)
              return (
                <>
                  <BucketBar label={`${h.name}赢2+`} prob={b.homeBy2Plus} max={mx} tone="home" />
                  <BucketBar label={`${h.name}赢1球`} prob={b.homeBy1} max={mx} tone="home" />
                  <BucketBar label="平局" prob={b.draw} max={mx} tone="draw" />
                  <BucketBar label={`${a.name}赢1球`} prob={b.awayBy1} max={mx} tone="away" />
                  <BucketBar label={`${a.name}赢2+`} prob={b.awayBy2Plus} max={mx} tone="away" />
                </>
              )
            })()}
          </div>
        )}

        {d.markets && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MiniStat label={`${h.name}不败`} value={`${d.markets.homeOrDraw}%`} />
            <MiniStat label={`${a.name}不败`} value={`${d.markets.awayOrDraw}%`} />
            <MiniStat label="不平局" value={`${d.markets.homeOrAway}%`} />
            <MiniStat label="进球 >1.5" value={`${d.markets.over15}%`} />
            <MiniStat label="进球 >2.5" value={`${d.markets.over25}%`} />
            <MiniStat label="双方进球" value={`${d.markets.btts}%`} />
          </div>
        )}

        {/* 冷门情形（永远保留）：把尾部概率显性化 */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-accent" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-foreground">
              冷门预警：{d.upsetLabel}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              模型给出约 <span className="font-semibold text-accent">{d.upsetProb}%</span> 的冷门概率，代表比分{" "}
              <span className="font-semibold tabular-nums text-foreground">{d.upsetScore}</span>，不是唯一比分。
              冷门概率来自强队未能取胜的概率矩阵，1:1 只是该冷门分支中最可能的比分。
            </p>
          </div>
        </div>

        {/* 比分明细（默认折叠）：保留原始散比分给想看细节的人 */}
        <details className="mt-4 group">
          <summary className="cursor-pointer select-none text-xs font-semibold text-muted-foreground hover:text-foreground">
            展开比分概率明细（单一比分概率天然偏低，约 10~16%）
          </summary>
          <div className="mt-3 space-y-2">
            {d.scoreProbs.map((s) => {
              const isTop = s.prob === maxScoreProb
              return (
                <div key={s.score} className="flex items-center gap-3">
                  <span className={cn("w-12 shrink-0 font-heading text-sm font-700 tabular-nums", isTop ? "text-primary" : "text-foreground")}>
                    {s.score}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div className={cn("h-full rounded-full", isTop ? "bg-primary" : "bg-primary/35")} style={{ width: `${(s.prob / maxScoreProb) * 100}%` }} />
                  </div>
                  <span className={cn("w-10 shrink-0 text-right text-xs font-semibold tabular-nums", isTop ? "text-primary" : "text-muted-foreground")}>
                    {s.prob}%
                  </span>
                </div>
              )
            })}
          </div>
        </details>
      </section>

      {/* expected goals + projected stats */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Activity}>预期进球与场面预测</SectionTitle>
        <div className="mt-4 space-y-3">
          <CompareStat label="模型预期进球 λ" home={d.xgHome.toFixed(2)} away={d.xgAway.toFixed(2)} hv={d.xgHome} av={d.xgAway} />
          {(d.realXgForHome != null || d.realXgForAway != null) ? (
            <CompareStat
              label="真实场均 xG (本届)"
              home={d.realXgForHome != null ? d.realXgForHome.toFixed(2) : "—"}
              away={d.realXgForAway != null ? d.realXgForAway.toFixed(2) : "—"}
              hv={d.realXgForHome ?? 0}
              av={d.realXgForAway ?? 0}
            />
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5 shrink-0" />
              真实场均 xG：暂无样本（本届首轮或未入库统计），第二轮起逐步纳入预测。
            </div>
          )}
          <CompareStat label="控球率" home={fmtPct(d.possessionHome)} away={fmtPct(100 - d.possessionHome)} hv={d.possessionHome} av={100 - d.possessionHome} />
          <CompareStat label="预计射门" home={`${d.shotsHome}`} away={`${d.shotsAway}`} hv={d.shotsHome} av={d.shotsAway} />
        </div>
      </section>

      {/* head to head */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Swords}>历史交锋 (近 5 次)</SectionTitle>
        <div className="mt-4 flex items-center justify-center gap-4 text-center">
          <HeadStat value={d.h2h.homeWins} label={`${h.code} 胜`} tone="primary" />
          <HeadStat value={d.h2h.draws} label="平" tone="muted" />
          <HeadStat value={d.h2h.awayWins} label={`${a.code} 胜`} tone="accent" />
        </div>
        <ul className="mt-4 space-y-2">
          {d.h2h.last.map((g, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-xs"
            >
              <span className="text-muted-foreground">{g.date}</span>
              <span className="font-heading text-sm font-700 tabular-nums">{g.score}</span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-bold",
                  g.result === "主胜"
                    ? "bg-primary/15 text-primary"
                    : g.result === "客胜"
                      ? "bg-accent/15 text-accent"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {g.result}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* radar strength comparison */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Gauge}>综合实力雷达对比</SectionTitle>
        <div className="mt-4 flex items-center justify-center gap-6 text-xs font-semibold">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            <TeamFlag code={h.code} size="xs" /> {h.name}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
            <TeamFlag code={a.code} size="xs" /> {a.name}
          </span>
        </div>
        <RadarCompare axes={radarAxes} className="mx-auto mt-2" />
      </section>

      {/* lineup comparison: only show official/ingested lineups */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Users}>
          {d.lineupKind === "confirmed" ? "确定阵容" : "预测阵容"}
        </SectionTitle>
        {hasRealLineups ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-5">
            <Pitch team={h} lineup={d.homeLineup} accent="primary" />
            <Pitch team={a} lineup={d.awayLineup} accent="accent" />
          </div>
        ) : (
          <UnavailableNote text="暂无官方首发/阵容数据；开赛前或赛后由 API 入库后自动显示。" />
        )}
      </section>

      {/* match events timeline：进行中实时轮询叠加，完赛用静态最终版 */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Activity}>
          比赛事件{live ? <span className="ml-2 text-xs font-medium text-primary">· 实时</span> : null}
        </SectionTitle>
        {timelineEvents.length > 0 ? (
          <ol className="mt-4 space-y-2.5">
            {timelineEvents.map((e, i) => {
              const t = e.side === "home" ? h : a
              const isGoal = e.type === "Goal"
              const isCard = e.type === "Card"
              const isSub = e.type === "subst"
              const isRed = (e.detail || "").includes("Red")
              return (
                <li key={i} className="flex items-center gap-2.5 text-sm">
                  <span className="w-9 shrink-0 text-right font-heading text-xs font-700 tabular-nums text-muted-foreground">
                    {e.minute}
                    {e.extra ? `+${e.extra}` : ""}&apos;
                  </span>
                  <span className="grid h-5 w-5 shrink-0 place-items-center">
                    {isGoal ? (
                      <Target className="h-4 w-4 text-primary" />
                    ) : isCard ? (
                      <span className={cn("h-3.5 w-2.5 rounded-[2px]", isRed ? "bg-red-500" : "bg-yellow-400")} />
                    ) : isSub ? (
                      <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <TeamFlag code={t.code} size="sm" />
                  <span className={cn("font-medium", isGoal ? "text-foreground" : "text-foreground/90")}>
                    {e.player || "—"}
                  </span>
                  {isGoal && e.assist ? (
                    <span className="text-xs text-muted-foreground">助攻 {e.assist}</span>
                  ) : isSub && e.assist ? (
                    <span className="text-xs text-muted-foreground">← {e.assist}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{eventLabel(e)}</span>
                </li>
              )
            })}
          </ol>
        ) : (
          <UnavailableNote text="暂无事件" />
        )}
      </section>

      {/* injuries */}
      {hasRealInjuries ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <InjuryCard team={h} injuries={d.homeInjuries} />
          <InjuryCard team={a} injuries={d.awayInjuries} />
        </div>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionTitle icon={HeartPulse}>伤停信息</SectionTitle>
          <UnavailableNote text="暂无官方伤停数据；不展示静态推断名单。" />
        </section>
      )}

          {/* star availability —— 球星出场状态：手工球星表×真实首发/替补 */}
      {d.starAvailability && (d.starAvailability.home.length > 0 || d.starAvailability.away.length > 0) ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionTitle icon={Sparkles}>球星出场状态</SectionTitle>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <StarAvailabilityCard team={h} stars={d.starAvailability.home} />
            <StarAvailabilityCard team={a} stars={d.starAvailability.away} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            球星名单为人工维护的国家队核心；状态依据真实首发/替补阵容判定。热门球员未首发会在预测中保守计入。
          </p>
        </section>
      ) : null}

      {/* coaches */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={ClipboardList}>主教练信息</SectionTitle>
        {hasRealCoaches ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <CoachBlock team={h} coach={d.homeCoach} />
            <CoachBlock team={a} coach={d.awayCoach} />
          </div>
        ) : (
          <UnavailableNote text="暂无官方主教练数据；不展示静态推断教练。" />
        )}
      </section>

      {/* referee */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Flag}>裁判信息</SectionTitle>
        {hasRealReferee ? (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold">{d.referee.name}</p>
                <p className="text-[11px] text-muted-foreground">主裁判 · {d.referee.nat}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <MiniStat label="场均黄牌" value={d.referee.avgYellow.toFixed(1)} />
              <MiniStat label="场均红牌" value={d.referee.avgRed.toFixed(2)} />
              <MiniStat label="判点频率" value={d.referee.penaltyRate.toFixed(2)} />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-foreground/85">{d.referee.note}</p>
          </div>
        ) : (
          <UnavailableNote text="暂无官方裁判数据；不展示静态推断裁判。" />
        )}
      </section>

      {/* venue + weather */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Mountain}>比赛场地 · 海拔与天气</SectionTitle>
        <div className="mt-4 mb-4 flex items-center justify-between rounded-lg bg-secondary/50 p-3">
          <div>
            <p className="font-bold">{match.venue}</p>
            <p className="text-[11px] text-muted-foreground">
              {match.city} · 可容纳 {d.venueInfo.capacity.toLocaleString()} 人 · {d.venueInfo.surface}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading text-lg font-700 text-primary">
              {d.venueInfo.altitude}
              <span className="ml-0.5 text-xs text-muted-foreground">m</span>
            </p>
            <p className="text-[10px] text-muted-foreground">
              海拔{d.venueInfo.altitude > 1500 ? " · 高原" : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <WeatherStat icon={CloudSun} label="天气" value={d.venueInfo.weather.condition} />
          <WeatherStat icon={Thermometer} label="气温" value={`${d.venueInfo.weather.tempC}°C`} />
          <WeatherStat icon={Droplets} label="湿度" value={`${d.venueInfo.weather.humidity}%`} />
          <WeatherStat icon={Wind} label="风速" value={`${d.venueInfo.weather.windKmh} km/h`} />
        </div>
      </section>

      {/* form comparison */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Activity}>近期状态对比</SectionTitle>
        {match.ai.formVerified ? (
          <div className="mt-4 space-y-4">
            <FormLine team={h} form={match.ai.formHome} />
            <div className="h-px bg-border" />
            <FormLine team={a} form={match.ai.formAway} />
          </div>
        ) : (
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            暂无该场两队的联网核实近况数据。为保证真实性，本平台仅对已深度分析的场次展示真实近期战绩，其余场次不以模型推算代替。
          </p>
        )}
      </section>

      {/* key points */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <SectionTitle icon={Sparkles}>AI 关键看点</SectionTitle>
        <ul className="mt-4 space-y-3">
          {match.ai.keyPoints.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary/15 text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              <span className="text-sm leading-relaxed text-foreground/90">{p}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* data sources (real-data matches only) */}
      {d.sources && d.sources.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <SectionTitle icon={ClipboardList}>数据来源与时效</SectionTitle>
          <ul className="mt-4 space-y-2">
            {d.sources.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/90 underline-offset-2 hover:text-primary hover:underline"
                >
                  {s.label}
                </a>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{s.date}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            首发为媒体赛前预测阵容（非官方最终名单），标注 (推断) 的字段为模型推断；查不到的数据标注「暂无」。
          </p>
        </section>
      )}

      <p className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
        {d.dataMode === "real"
          ? "以上分析综合联网核实的赛前真实数据与统计模型估算，仅供娱乐参考，不构成任何投注建议。"
          : "以上内容由 AI 模型基于历史数据生成，仅供参考，不构成任何投注建议。"}
      </p>
    </div>
  )
}

function clampPct(v: number) {
  return Math.max(20, Math.min(96, Math.round(v)))
}

function fmtPct(v: number) {
  const rounded = Math.round(v * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

// WS1：把引擎的 topInsight 语义码 + 队名 → 中文文案
function insightText(label: string, homeName: string, awayName: string): string {
  switch (label) {
    case "home_unbeaten": return `${homeName}不败`
    case "away_unbeaten": return `${awayName}不败`
    case "home_by2": return `${homeName}赢 2 球及以上`
    case "away_by2": return `${awayName}赢 2 球及以上`
    case "over25": return "总进球大于 2.5"
    case "btts": return "双方均进球"
    default: return label
  }
}

// WS1：归并桶横条
function BucketBar({ label, prob, max, tone }: { label: string; prob: number; max: number; tone: "home" | "draw" | "away" }) {
  const color = tone === "home" ? "bg-primary" : tone === "away" ? "bg-accent" : "bg-muted-foreground"
  const txt = tone === "home" ? "text-primary" : tone === "away" ? "text-accent" : "text-foreground"
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className={cn("animate-bar h-full rounded-full", color)} style={{ width: `${max > 0 ? (prob / max) * 100 : 0}%` }} />
      </div>
      <span className={cn("w-10 shrink-0 text-right text-xs font-700 tabular-nums", txt)}>{prob}%</span>
    </div>
  )
}

// 把 API 事件 type/detail 映射成中文标签
function eventLabel(e: MatchEvent): string {
  const d = e.detail || ""
  if (e.type === "Goal") {
    if (d.includes("Penalty") && d.includes("Missed")) return "射失点球"
    if (d.includes("Penalty")) return "点球"
    if (d.includes("Own")) return "乌龙球"
    return "进球"
  }
  if (e.type === "Card") {
    if (d.includes("Second Yellow")) return "两黄变红"
    if (d.includes("Red")) return "红牌"
    return "黄牌"
  }
  if (e.type === "subst") return "换人"
  if (e.type === "Var") return "VAR"
  return d || e.type
}

function formScore(form: ("W" | "D" | "L")[]) {
  const pts = form.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0)
  return clampPct((pts / (form.length * 3)) * 100)
}

function TeamHead({ team, matchId }: { team: ReturnType<typeof getTeam>; matchId: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <ViewTransition name={`flag-${matchId}-${team.code}`} share="morph">
        <TeamFlag code={team.code} size="xl" rounded="rounded-lg" className="shadow-lg" />
      </ViewTransition>
      <span className="mt-2 text-sm font-bold sm:text-base">{team.name}</span>
      <span className="text-[11px] font-medium text-muted-foreground">
        FIFA #{team.fifaRank}
      </span>
    </div>
  )
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Sparkles
  children: React.ReactNode
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-4 w-4 text-primary" />
      {children}
    </h3>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "primary" | "accent" | "muted"
}) {
  return (
    <div className="rounded-xl bg-secondary/60 py-3">
      <div
        className={cn(
          "font-heading text-2xl font-700",
          tone === "primary" && "text-primary",
          tone === "accent" && "text-accent",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  )
}

function CompareStat({
  label,
  home,
  away,
  hv,
  av,
}: {
  label: string
  home: string
  away: string
  hv: number
  av: number
}) {
  const total = hv + av || 1
  const homePct = (hv / total) * 100
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
        <span className="text-primary">{home}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-accent">{away}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
        <div className="animate-bar h-full bg-primary" style={{ width: `${homePct}%` }} />
        <div className="h-full flex-1 bg-accent/70" />
      </div>
    </div>
  )
}

function HeadStat({
  value,
  label,
  tone,
}: {
  value: number
  label: string
  tone: "primary" | "accent" | "muted"
}) {
  return (
    <div className="flex-1">
      <div
        className={cn(
          "font-heading text-3xl font-700 tabular-nums",
          tone === "primary" && "text-primary",
          tone === "accent" && "text-accent",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{label}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 py-2 text-center">
      <div className="font-heading text-base font-700 tabular-nums">{value}</div>
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
    </div>
  )
}

function WeatherStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sparkles
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-secondary/50 py-3">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-sm font-bold">{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

function UnavailableNote({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-4 text-sm leading-relaxed text-muted-foreground">
      {text}
    </div>
  )
}

function InjuryCard({
  team,
  injuries,
}: {
  team: ReturnType<typeof getTeam>
  injuries: Match["detail"]["homeInjuries"]
}) {
  const tone: Record<string, string> = {
    缺阵: "bg-destructive/15 text-destructive",
    存疑: "bg-accent/15 text-accent",
    复出: "bg-primary/15 text-primary",
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold">{team.name} · 伤停情况</span>
      </div>
      {injuries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">无重要伤停，主力阵容齐整。</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {injuries.map((inj, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-semibold">{inj.name}</span>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {inj.pos} · {inj.note}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold",
                  tone[inj.status],
                )}
              >
                {inj.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StarAvailabilityCard({
  team,
  stars,
}: {
  team: ReturnType<typeof getTeam>
  stars: NonNullable<Match["detail"]["starAvailability"]>["home"]
}) {
  const tone: Record<string, string> = {
    首发: "bg-primary/15 text-primary",
    替补待命: "bg-accent/15 text-accent",
    轮换未登场: "bg-muted text-muted-foreground",
    未进名单: "bg-destructive/15 text-destructive",
  }
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold">{team.name}</span>
      </div>
      {stars.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">无登记球星。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {stars.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {s.display}
                {s.tier === 1 ? <span className="ml-1 text-[10px] text-amber-500">★</span> : null}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold",
                  tone[s.status] ?? "bg-muted text-muted-foreground",
                )}
              >
                {s.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CoachBlock({
  team,
  coach,
}: {
  team: ReturnType<typeof getTeam>
  coach: Match["detail"]["homeCoach"]
}) {
  return (
    <div className="rounded-xl bg-secondary/50 p-4">
      <div className="flex items-center gap-2">
        <TeamFlag code={team.code} size="sm" />
        <div>
          <p className="text-sm font-bold">{coach.name}</p>
          <p className="text-[11px] text-muted-foreground">{team.name} 主帅</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <span className="rounded-md bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary">
          {coach.style}
        </span>
      </div>
    </div>
  )
}

function FormLine({
  team,
  form,
}: {
  team: ReturnType<typeof getTeam>
  form: ("W" | "D" | "L")[]
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <TeamFlag code={team.code} size="md" />
        <span className="text-sm font-bold">{team.name}</span>
      </div>
      <FormRow form={form} />
    </div>
  )
}
