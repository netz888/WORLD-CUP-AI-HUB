"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Radio,
  ChevronDown,
  Target,
  Clock,
  ShieldHalf,
  Goal,
  AlertTriangle,
  Square,
  CalendarClock,
  Flag,
  Activity,
  Trophy,
  Check,
  X,
} from "lucide-react"
import { type Match, type MatchEvent, getTeam, liveClockFromStatus, tickClock } from "@/lib/data"
import { predictInPlay } from "@/lib/in-play"
import { ProbBar } from "@/components/prob-bar"
import { TeamFlag } from "@/components/team-flag"
import { useLiveInfo, useLiveEvents, useLiveStats } from "@/components/live-provider"
import { cn } from "@/lib/utils"

type Phase = "upcoming" | "live" | "finished"

// 各阶段的主题与文案配置，驱动同一张常驻卡片的三种形态。
const PHASE_THEME: Record<
  Phase,
  {
    badge: string
    pulse: boolean
    accent: string // 文字/图标强调色
    iconBg: string // 头部图标底色
    border: string // 卡片边框
    bg: string // 卡片渐变背景
    badgeBg: string // 徽标底色
    probLabel: string
    scoreLabel: string
    scoreMoreLabel: string
  }
> = {
  upcoming: {
    badge: "未开赛",
    pulse: false,
    accent: "text-primary",
    iconBg: "bg-primary text-primary-foreground",
    border: "border-primary/30",
    bg: "from-primary/8 to-card",
    badgeBg: "bg-primary/15 text-primary",
    probLabel: "开球前预测概率",
    scoreLabel: "最可能比分",
    scoreMoreLabel: "全场进球预期",
  },
  live: {
    badge: "LIVE",
    pulse: true,
    accent: "text-destructive",
    iconBg: "bg-destructive text-destructive-foreground",
    border: "border-destructive/40",
    bg: "from-destructive/10 to-card",
    badgeBg: "bg-destructive/15 text-destructive",
    probLabel: "实时最终结果概率",
    scoreLabel: "最可能最终比分",
    scoreMoreLabel: "后续还会进球",
  },
  finished: {
    badge: "已完赛",
    pulse: false,
    accent: "text-muted-foreground",
    iconBg: "bg-muted-foreground/80 text-background",
    border: "border-border",
    bg: "from-secondary/40 to-card",
    badgeBg: "bg-secondary text-muted-foreground",
    probLabel: "最终结果",
    scoreLabel: "最终比分",
    scoreMoreLabel: "全场进球",
  },
}

// 赛中实时分析：常驻详情页。未开赛=开球前推演 / 进行中=逐秒重算 / 已完赛=锁定最终结果。
// 输入复用赛前烘焙的 λ（match.detail.xgHome/xgAway），叠加实时比分 + 红黄牌 + 比分效应。
export function InPlayAnalysis({ match }: { match: Match }) {
  const matchKey = `${match.homeCode}-${match.awayCode}`
  const info = useLiveInfo(matchKey)
  const phase: Phase = match.status
  const live = phase === "live"
  const theme = PHASE_THEME[phase]

  // 仅进行中轮询该场实时事件，用于统计红黄牌
  const events = useLiveEvents(matchKey, live, match.detail.events ?? [])

  // 技术统计：赛中轮询实时刷新、已完赛拉一次最终版、未开赛不获取
  const stats = useLiveStats(matchKey, phase !== "upcoming", live)

  // 仅进行中每秒触发重算，让剩余时间/概率随比赛钟平滑推进
  const [, tick] = useState(0)
  const anchorRef = useRef<number>(info?.asOfMs ?? Date.now())
  const sig = `${info?.elapsed ?? ""}|${info?.statusShort ?? ""}|${info?.asOfMs ?? ""}`
  useEffect(() => {
    anchorRef.current = info?.asOfMs ?? Date.now()
  }, [sig])
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [live])

  // 默认仅进行中展开（实时分析为主打）；未开赛/已完赛默认折叠，只留标题行
  const [open, setOpen] = useState(live)

  // 当前比赛分钟：未开赛=0（剩余100%）/ 已完赛=90（锁定）/ 进行中=实时比赛钟
  const minute = useMemo(() => {
    if (phase === "upcoming") return 0
    if (phase === "finished") return 90
    const clock = liveClockFromStatus(info?.statusShort, info?.elapsed, info?.extra)
    if (clock.baseMinute === null) return info?.elapsed ?? 1
    if (!clock.running) return clock.baseMinute
    const t = tickClock(clock, info?.kickoffMs ?? 0, anchorRef.current, Date.now())
    return t ? t.minute : clock.baseMinute
    // sig 变化或每秒 tick 都会触发重算
  }, [phase, info, sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const { redHome, redAway, yellowHome, yellowAway } = useMemo(() => countCards(events), [events])

  const gh = match.homeScore ?? 0
  const ga = match.awayScore ?? 0

  // 仅在赛中、且双侧统计齐全时把技术统计喂给引擎做场面权重修正（已完赛不再改 λ）
  const engineStats =
    live && stats?.home && stats?.away
      ? {
          home: {
            possession: stats.home.possession,
            shotsTotal: stats.home.shotsTotal,
            shotsOnTarget: stats.home.shotsOnTarget,
            xg: stats.home.xg,
            corners: stats.home.corners,
          },
          away: {
            possession: stats.away.possession,
            shotsTotal: stats.away.shotsTotal,
            shotsOnTarget: stats.away.shotsOnTarget,
            xg: stats.away.xg,
            corners: stats.away.corners,
          },
        }
      : undefined

  const out = useMemo(
    () =>
      predictInPlay({
        lambdaPreHome: match.detail.xgHome,
        lambdaPreAway: match.detail.xgAway,
        minute,
        homeScore: gh,
        awayScore: ga,
        redHome,
        redAway,
        yellowHome,
        yellowAway,
        stats: engineStats,
      }),
    [match.detail.xgHome, match.detail.xgAway, minute, gh, ga, redHome, redAway, yellowHome, yellowAway, engineStats],
  )

  const h = getTeam(match.homeCode)
  const a = getTeam(match.awayCode)
  const leanTeam = out.lean === "home" ? h : out.lean === "away" ? a : null

  // 头部副标题随阶段变化
  const subtitle =
    phase === "upcoming"
      ? "尚未开赛 · 以下为开球前模型推演"
      : phase === "finished"
        ? `比赛结束 · 最终 ${gh} : ${ga}`
        : `随比赛进程逐秒重算 · 剩余 ${out.remPct}% 时间 · 当前 ${gh} : ${ga}`

  const HeaderIcon = phase === "upcoming" ? CalendarClock : phase === "finished" ? Flag : Radio
  // 三态统一使用同一标题
  const title = "赛中实时分析"

  return (
    <section className={cn("overflow-hidden rounded-2xl border bg-gradient-to-b glow-ring", theme.border, theme.bg)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 px-5 py-4 text-left transition-colors hover:bg-foreground/5"
        aria-expanded={open}
        aria-label={open ? "收起模型分析" : "展开模型分析"}
      >
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", theme.iconBg)}>
          <HeaderIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-base font-700 leading-none">{title}</h2>
            <span
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                theme.badgeBg,
              )}
            >
              {theme.pulse && <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-destructive" />}
              {theme.badge}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <ChevronDown
          className={cn("ml-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-4 px-5 pb-5">
          {/* 结果概率 */}
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Target className={cn("h-4 w-4", theme.accent)} />
              <span className="text-xs font-semibold text-muted-foreground">{theme.probLabel}</span>
            </div>
            <ProbBar homeWin={out.homeWin} draw={out.draw} awayWin={out.awayWin} />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <LiveStat label={`${h.code} 胜`} value={`${out.homeWin}%`} tone="primary" />
              <LiveStat label="平局" value={`${out.draw}%`} tone="muted" />
              <LiveStat label={`${a.code} 胜`} value={`${out.awayWin}%`} tone="accent" />
            </div>
          </div>

          {/* 研判一句话 */}
          <div className="flex items-start gap-2 rounded-xl bg-secondary/50 p-3">
            <Goal className={cn("mt-0.5 h-4 w-4 shrink-0", theme.accent)} />
            <p className="text-[13px] leading-relaxed text-foreground/90">
              {verdict(phase, out, h.name, a.name, leanTeam?.name, gh, ga)}
            </p>
          </div>

          {/* 技术统计对比（赛中/已完赛且有数据时显示，未开赛自动隐藏） */}
          {stats?.hasData && stats.home && stats.away && (
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className={cn("h-4 w-4", theme.accent)} />
                  <span className="text-xs font-semibold text-muted-foreground">技术统计</span>
                </div>
                {phase === "live" && (
                  <span className="text-[10px] text-muted-foreground">实时 · 每 25 秒刷新</span>
                )}
              </div>
              {/* 场面权重研判（仅赛中且生效时） */}
              {phase === "live" && out.modifiers.field.active && out.modifiers.field.lean !== "even" && (
                <div className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-[12px] leading-relaxed text-foreground/90">
                  {`场面权重：${out.modifiers.field.lean === "home" ? h.name : a.name} 占据主动（进攻压力 ${
                    out.modifiers.field.lean === "home" ? out.modifiers.field.homeShare : 100 - out.modifiers.field.homeShare
                  }%），已据此上调其剩余进球预期（强度 ${out.modifiers.field.intensity}%）。`}
                </div>
              )}
              <div className="space-y-2.5">
                <StatRow label="控球率" home={stats.home.possession} away={stats.away.possession} suffix="%" />
                <StatRow label="射门" home={stats.home.shotsTotal} away={stats.away.shotsTotal} />
                <StatRow label="射正" home={stats.home.shotsOnTarget} away={stats.away.shotsOnTarget} />
                <StatRow label="预期进球 xG" home={stats.home.xg} away={stats.away.xg} decimals={2} />
                <StatRow label="角球" home={stats.home.corners} away={stats.away.corners} />
                <StatRow label="犯规" home={stats.home.fouls} away={stats.away.fouls} lowerBetter />
                <StatRow label="传球成功率" home={stats.home.passAccuracy} away={stats.away.passAccuracy} suffix="%" />
                <StatRow label="越位" home={stats.home.offsides} away={stats.away.offsides} lowerBetter />
              </div>
            </div>
          )}

          {/* 已完赛：赛前预测复盘（命中 + 比分对比）；进行中/未开赛：进球预期 + 最可能比分 */}
          {phase === "finished" ? (
            <FinishedReview match={match} h={h} a={a} gh={gh} ga={ga} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Goal className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-muted-foreground">{theme.scoreMoreLabel}</span>
                </div>
                <div className="space-y-2.5">
                  <ScoreMoreRow code={h.code} name={h.name} prob={out.homeScoreMore} tone="primary" />
                  <ScoreMoreRow code={a.code} name={a.name} prob={out.awayScoreMore} tone="accent" />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-muted-foreground">{theme.scoreLabel}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-heading text-3xl font-700 tabular-nums text-foreground">{out.finalScore}</span>
                  <span className="text-xs text-muted-foreground">
                    {out.topFinals[0] ? `${out.topFinals[0].prob}%` : ""}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {out.topFinals.slice(0, 4).map((s) => (
                    <span
                      key={s.score}
                      className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
                    >
                      {s.score} · {s.prob}%
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 模型参数与生效修正：已完赛不展示（剩余时间为 0，无意义） */}
          {phase !== "finished" && (
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <ShieldHalf className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground">
                  {phase === "upcoming" ? "模型参数" : "实时模型参数"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ParamStat label="主队预计再进球" value={out.lambdaRemHome.toFixed(2)} />
                <ParamStat label="客队预计再进球" value={out.lambdaRemAway.toFixed(2)} />
                <ParamStat label="剩余时间" value={`${out.remPct}%`} />
                <ParamStat
                  label="比分效应"
                  value={out.modifiers.stateEffect === "none" ? "无" : `${out.modifiers.stateIntensity}%`}
                />
              </div>
              {phase === "live" && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {(redHome > 0 || redAway > 0) && (
                    <Chip tone="red" icon={<Square className="h-3 w-3 fill-current" />}>
                      红牌 {h.code} {redHome} : {redAway} {a.code}
                    </Chip>
                  )}
                  {(yellowHome > 0 || yellowAway > 0) && (
                    <Chip tone="yellow" icon={<Square className="h-3 w-3 fill-current" />}>
                      黄牌 {h.code} {yellowHome} : {yellowAway} {a.code}
                    </Chip>
                  )}
                  {out.modifiers.stateEffect === "home_defend" && (
                    <Chip tone="muted" icon={<ShieldHalf className="h-3 w-3" />}>
                      {h.name} 领先护分
                    </Chip>
                  )}
                  {out.modifiers.stateEffect === "away_defend" && (
                    <Chip tone="muted" icon={<ShieldHalf className="h-3 w-3" />}>
                      {a.name} 领先护分
                    </Chip>
                  )}
                  {out.modifiers.field.active && out.modifiers.field.lean !== "even" && (
                    <Chip tone="muted" icon={<Activity className="h-3 w-3" />}>
                      场面偏 {out.modifiers.field.lean === "home" ? h.name : a.name} {out.modifiers.field.intensity}%
                    </Chip>
                  )}
                  {redHome === 0 &&
                    redAway === 0 &&
                    yellowHome === 0 &&
                    yellowAway === 0 &&
                    out.modifiers.stateEffect === "none" &&
                    !(out.modifiers.field.active && out.modifiers.field.lean !== "even") && (
                      <span className="text-[11px] leading-relaxed text-muted-foreground">
                        暂无红黄牌与比分状态修正，纯时间衰减推演。
                      </span>
                    )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {phase === "finished"
                ? "全场复盘 = 赛前模型 λ 叠加最终比分后的锁定结果。模型仅供娱乐，不构成任何投注建议。"
                : "概率 = 赛前模型 λ × 剩余时间衰减 × 红黄牌修正 × 比分状态效应 × 场面权重（实时技术统计），对剩余进球做 Dixon-Coles 推演并叠加当前比分。仅供娱乐，不构成任何投注建议。"}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

// 从事件流统计两队红黄牌数
function countCards(events: MatchEvent[]): {
  redHome: number
  redAway: number
  yellowHome: number
  yellowAway: number
} {
  let redHome = 0
  let redAway = 0
  let yellowHome = 0
  let yellowAway = 0
  for (const e of events) {
    if (e.type !== "Card") continue
    const d = e.detail || ""
    const isRed = d.includes("Red") // 含 "Red Card" 与 "Second Yellow card" 之外的直红
    const isSecondYellow = d.includes("Second Yellow")
    if (isRed || isSecondYellow) {
      if (e.side === "home") redHome++
      else redAway++
    } else if (d.includes("Yellow")) {
      if (e.side === "home") yellowHome++
      else yellowAway++
    }
  }
  return { redHome, redAway, yellowHome, yellowAway }
}

function verdict(
  phase: Phase,
  out: ReturnType<typeof predictInPlay>,
  homeName: string,
  awayName: string,
  leanName: string | undefined,
  gh: number,
  ga: number,
): string {
  // 已完赛：陈述最终结果
  if (phase === "finished") {
    const result = gh > ga ? `${homeName} 取胜` : gh < ga ? `${awayName} 取胜` : "双方握手言和"
    return `比赛结束，最终比分 ${gh} : ${ga}，${result}。以上为赛前模型叠加最终比分后的锁定复盘。`
  }

  const conf = out.confidence
  const lead = leanName ? `${leanName}` : null

  // 未开赛：开球前推演
  if (phase === "upcoming") {
    const head =
      out.lean === "draw"
        ? `开球前推演：双方实力接近，平局概率 ${out.draw}% 领先`
        : `开球前推演：模型看好 ${lead} 取胜（${conf}%）`
    return `${head}。预计最可能比分 ${out.finalScore}，进球预期 ${homeName} ${out.homeScoreMore}% / ${awayName} ${out.awayScoreMore}%。`
  }

  // 进行中：实时研判
  let head: string
  if (out.lean === "draw") {
    head = `当前局势胶着，平局概率 ${out.draw}% 领先`
  } else {
    head = `综合实时比分与剩余时间，模型看好 ${lead} 取胜（${conf}%）`
  }
  let tail: string
  if (out.remPct <= 8) {
    tail = `比赛进入尾声，结果趋于锁定`
  } else if (out.modifiers.stateEffect === "home_defend") {
    tail = `${homeName} 领先后趋于收缩，${awayName} 后续进球概率 ${out.awayScoreMore}%`
  } else if (out.modifiers.stateEffect === "away_defend") {
    tail = `${awayName} 领先后趋于收缩，${homeName} 后续进球概率 ${out.homeScoreMore}%`
  } else {
    tail = `双方后续再进球概率 ${homeName} ${out.homeScoreMore}% / ${awayName} ${out.awayScoreMore}%`
  }
  return `${head}。${tail}。`
}

// 已完赛复盘：把无意义的「全场进球 0%」换成「赛前预测 vs 实际结果」对比。
// 左：模型赛前看好谁、是否命中；右：赛前预测比分 → 实际最终比分。
function FinishedReview({
  match,
  h,
  a,
  gh,
  ga,
}: {
  match: Match
  h: ReturnType<typeof getTeam>
  a: ReturnType<typeof getTeam>
  gh: number
  ga: number
}) {
  const aiLean = match.ai.homeWin > match.ai.awayWin ? "home" : match.ai.awayWin > match.ai.homeWin ? "away" : "draw"
  const actual = gh > ga ? "home" : ga > gh ? "away" : "draw"
  const hit = aiLean === actual
  const leanName = aiLean === "home" ? h.name : aiLean === "away" ? a.name : "平局"
  const actualName = actual === "home" ? h.name : actual === "away" ? a.name : "平局"
  const conf = aiLean === "home" ? match.ai.homeWin : aiLean === "away" ? match.ai.awayWin : match.ai.draw
  const scoreExact = match.ai.predictedScore.replace(/[:：]/g, "-") === `${gh}-${ga}`
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* 结果命中复盘 */}
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground">赛前预测回顾</span>
        </div>
        <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2", hit ? "bg-primary/12" : "bg-accent/12")}>
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-background",
              hit ? "bg-primary" : "bg-accent",
            )}
          >
            {hit ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          </span>
          <span className="text-[13px] font-bold text-foreground">{hit ? "结果命中" : "结果落空"}</span>
          <span className="ml-auto text-[11px] font-medium text-muted-foreground">置信 {conf}%</span>
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
          赛前模型{aiLean === "draw" ? "倾向平局" : `看好 ${leanName} 胜`}（{conf}%），实际
          {actual === "draw" ? "双方战平" : `${actualName} 取胜`}。
        </p>
      </div>
      {/* 预测比分 vs 实际比分 */}
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-muted-foreground">比分对比</span>
        </div>
        <div className="flex items-center justify-around gap-2">
          <div className="text-center">
            <div className="font-heading text-2xl font-700 tabular-nums text-muted-foreground">
              {match.ai.predictedScore}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">赛前预测</div>
          </div>
          <span className="text-lg text-muted-foreground/40">→</span>
          <div className="text-center">
            <div className="font-heading text-3xl font-700 tabular-nums text-foreground">
              {gh}-{ga}
            </div>
            <div className="mt-1 text-[11px] font-semibold text-primary">最终比分</div>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {scoreExact ? "比分精准命中" : "比分未完全命中（单场比分本就难测）"}
        </p>
      </div>
    </div>
  )
}

function LiveStat({ label, value, tone }: { label: string; value: string; tone: "primary" | "muted" | "accent" }) {
  const color = tone === "primary" ? "text-primary" : tone === "accent" ? "text-accent" : "text-foreground"
  return (
    <div className="rounded-lg bg-secondary/50 py-2">
      <div className={cn("font-heading text-xl font-700 tabular-nums", color)}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function ScoreMoreRow({
  code,
  name,
  prob,
  tone,
}: {
  code: string
  name: string
  prob: number
  tone: "primary" | "accent"
}) {
  const color = tone === "primary" ? "bg-primary" : "bg-accent"
  const txt = tone === "primary" ? "text-primary" : "text-accent"
  return (
    <div className="flex items-center gap-3">
      <TeamFlag code={code} size="sm" />
      <span className="w-16 shrink-0 truncate text-xs font-medium text-foreground/90">{name}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        <div className={cn("animate-bar h-full rounded-full", color)} style={{ width: `${prob}%` }} />
      </div>
      <span className={cn("w-10 shrink-0 text-right text-xs font-700 tabular-nums", txt)}>{prob}%</span>
    </div>
  )
}

function ParamStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2.5">
      <div className="font-heading text-lg font-700 leading-none tabular-nums text-foreground">{value}</div>
      <div className="mt-1.5 text-[11px] leading-none text-muted-foreground">{label}</div>
    </div>
  )
}

// SofaScore 式技术统计对比行：中间标签，两侧数值，下方左右对比条（主=primary 左，客=accent 右）。
function StatRow({
  label,
  home,
  away,
  suffix = "",
  decimals = 0,
  lowerBetter = false,
}: {
  label: string
  home: number | null
  away: number | null
  suffix?: string
  decimals?: number
  lowerBetter?: boolean
}) {
  const h = home ?? 0
  const a = away ?? 0
  const total = h + a
  // 对比条占比：总和为 0 时各半
  const hPct = total > 0 ? (h / total) * 100 : 50
  const aPct = 100 - hPct
  const fmt = (v: number | null) => (v == null ? "-" : decimals > 0 ? v.toFixed(decimals) : String(v))
  // 谁更优：lowerBetter 则数值小者高亮
  const hWin = total > 0 && (lowerBetter ? h < a : h > a)
  const aWin = total > 0 && (lowerBetter ? a < h : a > h)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs tabular-nums">
        <span className={cn("font-700", hWin ? "text-primary" : "text-foreground/70")}>
          {fmt(home)}
          {suffix}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className={cn("font-700", aWin ? "text-accent" : "text-foreground/70")}>
          {fmt(away)}
          {suffix}
        </span>
      </div>
      <div className="flex h-1.5 gap-0.5">
        <div className="flex flex-1 justify-end overflow-hidden rounded-l-full bg-secondary">
          <div className="h-full rounded-l-full bg-primary/80" style={{ width: `${hPct}%` }} />
        </div>
        <div className="flex flex-1 overflow-hidden rounded-r-full bg-secondary">
          <div className="h-full rounded-r-full bg-accent/80" style={{ width: `${aPct}%` }} />
        </div>
      </div>
    </div>
  )
}

function Chip({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode
  tone: "red" | "yellow" | "muted"
  icon?: React.ReactNode
}) {
  const cls =
    tone === "red"
      ? "border-red-500/40 bg-red-500/10 text-red-500"
      : tone === "yellow"
        ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-600 dark:text-yellow-400"
        : "border-border bg-secondary text-foreground/80"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold leading-none tabular-nums",
        cls,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
