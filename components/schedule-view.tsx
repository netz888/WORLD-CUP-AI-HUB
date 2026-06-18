"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Globe, CalendarCheck } from "lucide-react"
import {
  KNOCKOUT,
  STAGE_FILTERS,
  TIMEZONES,
  buildKnockoutMatch,
  mergeLiveOverlay,
  type Match,
  type KnockoutMatch,
} from "@/lib/data"
import { resolveKnockout } from "@/lib/knockout-resolver"
import { dateKey, formatDateLabel, todayKey } from "@/lib/time"
import { MatchCard } from "@/components/match-card"
import { KnockoutCard } from "@/components/knockout-card"
import { CountUp } from "@/components/count-up"
import { Countdown } from "@/components/countdown"
import { FeaturedSection } from "@/components/featured-section"
import { ChampionRace } from "@/components/champion-race"
import { AccuracyScoreboard } from "@/components/accuracy-scoreboard"
import { useLiveMatches, useLiveOverlay } from "@/components/live-provider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

// 赛程项：小组赛（带实时数据）或淘汰赛槽位，统一按 kickoff 排序与分日。
// 淘汰赛项的 match 在对阵确定后被填充为带真实球队 + AI 预测 + 实时比分的完整 Match；
// 未确定时为 null，由 KnockoutCard 渲染「待定」占位。
type ScheduleItem =
  | { kind: "group"; id: string; kickoff: string; match: Match }
  | { kind: "ko"; id: string; kickoff: string; ko: KnockoutMatch; match: Match | null }

export function ScheduleView() {
  const [tz, setTz] = useState("Asia/Shanghai")
  const [stage, setStage] = useState<string>("ALL")
  const matches = useLiveMatches()
  const overlay = useLiveOverlay()

  // 把小组赛（含实时数据的 Match）与淘汰赛占位（KnockoutMatch）统一成一个赛程项列表，
  // 按开球时间混排，淘汰赛因此能按真实日期插入赛程流中。
  const items = useMemo<ScheduleItem[]>(() => {
    const groupItems: ScheduleItem[] = matches.map((m) => ({
      kind: "group",
      id: m.id,
      kickoff: m.kickoff,
      match: m,
    }))
    // 从实时 overlay 解析出「已确定」的淘汰赛对阵（槽位 id → 真实球队）。
    // 未确定的槽位不在 map 中，对应卡片保持「待定」。
    const resolved = resolveKnockout(overlay)
    const koItems: ScheduleItem[] = KNOCKOUT.map((k) => {
      const seat = resolved.get(k.id)
      let match: Match | null = null
      if (seat) {
        // 对阵已定：用同一套 v6 引擎构建带 AI 预测的 Match，再叠加实时比分/状态。
        const base = buildKnockoutMatch(k, seat.homeCode, seat.awayCode)
        if (base) match = mergeLiveOverlay([base], overlay)[0]
      }
      return { kind: "ko", id: k.id, kickoff: k.kickoff, ko: k, match }
    })
    return [...groupItems, ...koItems]
  }, [matches, overlay])

  const filtered = useMemo(
    () =>
      items
        .filter((it) => {
          if (stage === "ALL") return true
          if (stage === "GROUP") return it.kind === "group"
          // 「决赛」筛选同时包含三四名决赛
          if (stage === "FINAL")
            return it.kind === "ko" && (it.ko.stage === "FINAL" || it.ko.stage === "3RD")
          return it.kind === "ko" && it.ko.stage === stage
        })
        .sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff)),
    [items, stage],
  )

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>()
    filtered.forEach((it) => {
      const k = dateKey(it.kickoff, tz)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(it)
    })
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, tz])

  // 真实当前时刻：挂载后在客户端取值，避免 SSR/CSR hydration 不一致。
  const [nowIso, setNowIso] = useState<string | null>(null)
  useEffect(() => {
    setNowIso(new Date().toISOString())
    const t = setInterval(() => setNowIso(new Date().toISOString()), 60000)
    return () => clearInterval(t)
  }, [])

  // "今日" 的日期键随时区变化而变化（同一时刻在不同时区可能是不同日期）。
  const todayK = useMemo(
    () => (nowIso ? todayKey(nowIso, tz) : null),
    [nowIso, tz],
  )

  // 当前时区下今日是否有比赛；若无则取「今日之后最近的一天」作为滚动目标。
  const { hasToday, targetKey } = useMemo(() => {
    const keys = byDay.map(([k]) => k)
    if (!todayK) return { hasToday: false, targetKey: keys[0] }
    if (keys.includes(todayK)) return { hasToday: true, targetKey: todayK }
    const upcoming = keys.find((k) => k >= todayK)
    return { hasToday: false, targetKey: upcoming ?? keys[keys.length - 1] }
  }, [byDay, todayK])

  // 各日期 section 的 DOM 引用，供平滑滚动定位。
  const dayRefs = useRef<Map<string, HTMLElement>>(new Map())

  const scrollToToday = () => {
    if (!targetKey) return
    dayRefs.current.get(targetKey)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="space-y-6">
      <Hero />

      <FeaturedSection tz={tz} />

      <ChampionRace count={8} />

      <AccuracyScoreboard />

      {/* controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={tz} onValueChange={(value) => value && setTz(value)}>
          <SelectTrigger className="w-full gap-2 sm:w-64">
            <Globe className="h-4 w-4 text-primary" />
            <SelectValue placeholder="选择时区">
              {TIMEZONES.find((t) => t.value === tz)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={scrollToToday}
          disabled={!targetKey}
          className="press inline-flex items-center justify-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-all hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarCheck className="h-4 w-4" />
          {hasToday ? "跳转今日赛程" : "跳转最近赛程"}
        </button>
      </div>

      {/* stage filter chips */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin">
        <div className="flex gap-2 pb-1">
          {STAGE_FILTERS.map((s) => (
            <Chip key={s.key} active={stage === s.key} onClick={() => setStage(s.key)}>
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* day sections */}
      <div className="space-y-8">
        {byDay.map(([day, dayItems]) => {
          const isToday = day === todayK
          return (
          <section
            key={day}
            ref={(el) => {
              if (el) dayRefs.current.set(day, el)
              else dayRefs.current.delete(day)
            }}
            className="animate-float-up scroll-mt-24"
          >
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-heading text-lg font-700 tracking-tight">
                {formatDateLabel(dayItems[0].kickoff, tz)}
              </h2>
              {isToday && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                  <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-primary" />
                  今日
                </span>
              )}
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs font-semibold text-muted-foreground">
                {dayItems.length} 场
              </span>
            </div>
            <div className="stagger grid gap-3 md:grid-cols-2">
              {dayItems.map((it) =>
                it.kind === "group" ? (
                  <MatchCard key={it.id} match={it.match} tz={tz} />
                ) : (
                  <KnockoutCard key={it.id} ko={it.ko} match={it.match} tz={tz} />
                ),
              )}
            </div>
          </section>
          )
        })}
      </div>
    </div>
  )
}

function Hero() {
  const stats = [
    { value: 104, label: "场比赛" },
    { value: 48, label: "支球队" },
    { value: 12, label: "个小组" },
    { value: 16, label: "座城市" },
  ]
  return (
    <div className="pitch-markings pitch-stripes relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-card to-secondary/40 p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 animate-glow-drift rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-1/3 h-44 w-44 animate-glow-drift-slow rounded-full bg-accent/10 blur-3xl" />

      <div className="relative grid items-center gap-6 lg:grid-cols-2">
        {/* left: copy + stats */}
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-primary" />
            FIFA World Cup 2026
          </p>
          <h1 className="font-heading text-3xl font-700 leading-none tracking-tight text-balance sm:text-4xl">
            美加墨世界杯 · <span className="text-primary text-glow">AI 实时分析</span>
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            美国 · 加拿大 · 墨西哥联合主办，覆盖小组赛至决赛全部 104 场赛程。点击任意小组赛进入 AI 深度分析，获取胜负概率、比分预测与关键看点；淘汰赛对阵将随小组赛结果实时揭晓。
          </p>

          <div className="stagger mt-5 grid max-w-md grid-cols-4 gap-2">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-border/70 bg-background/40 px-2 py-2.5 text-center"
              >
                <div className="font-heading text-xl font-700 tabular-nums text-primary sm:text-2xl">
                  <CountUp value={s.value} />
                </div>
                <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* right: prominent countdown */}
        <div className="animate-float-up mx-auto w-full max-w-[22rem] rounded-2xl border border-primary/20 bg-background/40 p-5 glow-ring">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 animate-live-pulse rounded-full bg-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              距总决赛开战
            </span>
          </div>
          <Countdown size="lg" />
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            2026 年 7 月 19 日 · MetLife 体育场 · 纽约/新泽西
          </p>
        </div>
      </div>
    </div>
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
