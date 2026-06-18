"use client"

import { createContext, use, useEffect, useMemo, useRef, useState } from "react"
import {
  MATCHES,
  CHAMPION_RACE,
  computeStandings,
  computeMatchMinute,
  liveClockFromStatus,
  tickClock,
  mergeLiveOverlay,
  type LiveOverlay,
  type Match,
  type MatchEvent,
  type Standing,
  type Team,
  type ChampionOdds,
} from "@/lib/data"
import type { MatchStatsPair } from "@/lib/db/match-stats"

const LiveContext = createContext<LiveOverlay>({})
// 实时夺冠榜（随真实赛果更新）。服务端注入初值，轮询 /api/live 刷新；null 时回退静态 CHAMPION_RACE。
const ChampionRaceContext = createContext<ChampionOdds[] | null>(null)

export function LiveProvider({
  overlay: initialOverlay,
  championRace: initialChampionRace = null,
  children,
}: {
  overlay: LiveOverlay
  championRace?: ChampionOdds[] | null
  children: React.ReactNode
}) {
  const [overlay, setOverlay] = useState<LiveOverlay>(initialOverlay)
  const [championRace, setChampionRace] = useState<ChampionOdds[] | null>(initialChampionRace)
  // 记录上次数据签名，只有内容真正变化时才更新 state，
  // 这样轮询不会无谓触发重渲染（页面不会"自己闪一下"）。
  const sigRef = useRef(JSON.stringify(initialOverlay))
  const champSigRef = useRef(JSON.stringify(initialChampionRace))

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" })
        if (!res.ok) return
        const data = await res.json()
        const next: LiveOverlay = data.overlay ?? {}
        const sig = JSON.stringify(next)
        if (!cancelled && sig !== sigRef.current) {
          sigRef.current = sig
          setOverlay(next)
        }
        // 夺冠榜随真实赛果更新（poller 在比赛打完时重算写库）。仅内容变化时换引用。
        if (Array.isArray(data.championRace)) {
          const champSig = JSON.stringify(data.championRace)
          if (!cancelled && champSig !== champSigRef.current) {
            champSigRef.current = champSig
            setChampionRace(data.championRace as ChampionOdds[])
          }
        }
      } catch {
        // 轮询失败时静默忽略，下一轮重试
      }
    }
    // 每 60 秒静默拉取一次最新比分/状态，无需刷新页面。
    const id = setInterval(poll, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return (
    <LiveContext value={overlay}>
      <ChampionRaceContext value={championRace}>{children}</ChampionRaceContext>
    </LiveContext>
  )
}

// 实时夺冠榜 hook：随真实赛果更新；服务端初值 + 60s 轮询刷新，未就绪时回退静态 CHAMPION_RACE。
// count 给定时返回前 count 名（首页小组件用）。
export function useChampionRace(count?: number): ChampionOdds[] {
  const race = use(ChampionRaceContext)
  return useMemo(() => {
    const full = race ?? CHAMPION_RACE
    return typeof count === "number" ? full.slice(0, count) : full
  }, [race, count])
}

// 合并了实时数据的完整比赛列表。只依赖 overlay，
// 因此只在每 60 秒数据真正变化时才换新引用，平时不重建（不闪动）。
export function useLiveMatches(): Match[] {
  const overlay = use(LiveContext)
  return useMemo(() => mergeLiveOverlay(MATCHES, overlay), [overlay])
}

// 原始实时 overlay（homeCode-awayCode → 实时信息）。
// 供淘汰赛席位解析使用：从中识别已确定的淘汰赛真实对阵。
export function useLiveOverlay(): LiveOverlay {
  return use(LiveContext)
}

// 基于实时比分重算的小组积分榜
export function useLiveStandings(group: string): (Standing & { team: Team })[] {
  const matches = useLiveMatches()
  return useMemo(() => computeStandings(group, matches), [group, matches])
}

// 是否存在进行中的比赛
export function useHasLive(): boolean {
  const overlay = use(LiveContext)
  return useMemo(() => Object.values(overlay).some((i) => i.status === "live"), [overlay])
}

// 读取单场比赛的实时信息（状态短码/分钟/补时/比分）。供赛中实时预测使用。
// 只随 overlay（每 60s 真正变化时）换引用，平时稳定，不会无谓重渲染。
export function useLiveInfo(matchKey: string) {
  const overlay = use(LiveContext)
  return overlay[matchKey]
}

// 单场实时事件时间线：仅在比赛进行中时每 25 秒轮询 /api/match-events，
// 把最新时间线叠加到详情页；非进行中直接用服务端注入的静态 fallback（已完赛即最终版）。
// 拿不到/为空时保留 fallback，绝不让时间线变空。
export function useLiveEvents(
  matchKey: string,
  isLive: boolean,
  fallback: MatchEvent[],
): MatchEvent[] {
  const [polled, setPolled] = useState<MatchEvent[] | null>(null)
  useEffect(() => {
    if (!isLive) {
      setPolled(null)
      return
    }
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`/api/match-events?key=${encodeURIComponent(matchKey)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.events)) {
          setPolled(data.events as MatchEvent[])
        }
      } catch {
        // 轮询失败静默忽略，下一轮重试
      }
    }
    poll()
    const id = setInterval(poll, 25_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [matchKey, isLive])
  return isLive && polled ? polled : fallback
}

// 单场实时技术统计：从 /api/match-stats（force-dynamic 读最新 DB）获取控球率/射门/xG 等。
//   enabled=true 时拉取一次（已完赛拿最终统计）；poll=true 时再每 25 秒轮询（进行中实时刷新）。
//   未开赛 enabled=false 直接返回 null（无统计数据）。
export function useLiveStats(
  matchKey: string,
  enabled: boolean,
  poll: boolean,
): MatchStatsPair | null {
  const [data, setData] = useState<MatchStatsPair | null>(null)
  useEffect(() => {
    if (!enabled) {
      setData(null)
      return
    }
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/match-stats?key=${encodeURIComponent(matchKey)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const d = (await res.json()) as MatchStatsPair
        if (!cancelled && d && d.hasData) setData(d)
      } catch {
        // 失败静默忽略，下一轮重试
      }
    }
    fetchOnce()
    if (!poll) return () => {
      cancelled = true
    }
    const id = setInterval(fetchOnce, 25_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [matchKey, enabled, poll])
  return data
}

// 独立的实时比赛时钟：优先用 poller 写入的真实 API 状态（statusShort/elapsed/extra），
// 客户端逐秒走表（mm:ss），并显示中文状态与伤停补时（45+2'）。
// 缺少真实字段时（如旧数据/免费档）回退到按开球墙上时钟的「约 xx'」估算。
// 只重渲染这一小段，不波及整页比赛卡片。
export function LiveMinute({
  matchKey,
  kickoffISO,
}: {
  matchKey?: string
  kickoffISO?: string
}) {
  const overlay = use(LiveContext)
  const info = matchKey ? overlay[matchKey] : undefined

  // 拿到真实 API 字段：走精确状态机 + 本地逐秒
  const hasReal = !!info && (info.statusShort != null || info.elapsed != null)

  // 秒针锚定固定的 kickoffMs（确定性，刷新不归零）；分钟基准锚定 asOfMs（poller 抓取时刻）。
  // 仅需每秒触发重渲染让 tickClock 用最新 Date.now() 重算，不再维护可变的秒针锚点。
  const [, force] = useState(0)

  useEffect(() => {
    if (!hasReal || !info || !matchKey) return
    const clock = liveClockFromStatus(info.statusShort, info.elapsed, info.extra)
    if (!clock.running) {
      force((n) => n + 1)
      return
    }
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [hasReal, info, matchKey])

  if (hasReal && info) {
    const clock = liveClockFromStatus(info.statusShort, info.elapsed, info.extra)
    if (clock.kind === "finished") return <span suppressHydrationWarning>{clock.label}</span>
    if (!clock.running) {
      // 暂停态（中场休息 / 加时中场 / 中断）：只显示中文状态
      return <span suppressHydrationWarning>{clock.label}</span>
    }
    const t = tickClock(clock, info.kickoffMs ?? 0, info.asOfMs ?? Date.now(), Date.now())
    if (t) {
      const mm = String(t.minute).padStart(2, "0")
      const ss = String(t.second).padStart(2, "0")
      return (
        <span suppressHydrationWarning>
          {mm}:{ss}
        </span>
      )
    }
    return <span suppressHydrationWarning>{clock.label}</span>
  }

  // 回退：免费档/旧数据无真实分钟，按开球墙上时钟估算（加「约」）。
  return <LiveMinuteEstimate kickoffISO={kickoffISO ?? info?.kickoffISO ?? ""} />
}

// 估算版（旧逻辑）：服务端拿不到请求时刻，挂载前显示中性「进行中」，挂载后再算真实分钟。
function LiveMinuteEstimate({ kickoffISO }: { kickoffISO: string }) {
  const koMs = kickoffISO ? new Date(kickoffISO).getTime() : 0
  const [minute, setMinute] = useState<number | null>(null)
  useEffect(() => {
    if (!koMs) return
    const tick = () => setMinute(computeMatchMinute(koMs, Date.now()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [koMs])
  return (
    <span suppressHydrationWarning>
      {minute === null ? "进行中" : <>约 {minute}&apos;</>}
    </span>
  )
}

