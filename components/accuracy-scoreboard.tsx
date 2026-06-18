"use client"

import { useMemo } from "react"
import { Target } from "lucide-react"
import { useLiveMatches } from "@/components/live-provider"
import type { Match } from "@/lib/data"

// 冷门方「不败概率」(平 + 冷门方胜) ≥ 此值视为「AI 已发出冷门预警」，与详情页同口径。
const UPSET_ALERT = 33

type Stats = {
  total: number // 已结算场次
  resultHit: number // 胜平负命中数（胜率最高项 或 冷门代表比分，任一命中即算中）
  exactHit: number // 精确比分命中数（赛前比分概率 Top3 任一命中即算中）
  upsetTotal: number // 实际爆冷场数（赛前热门方未取胜，含被逼平）
  upsetHit: number // 其中 AI 事先预警到的场数（冷门方「不败概率」≥ 阈值）
  avgConf: number // 全部已结算场的平均自报置信度（赛前 AI 自称的把握）
  recent: boolean[] // 近 10 场命中(true)/失手(false)，按时间正序
}

// 真实结果归类：1=主胜 0=平 -1=客胜
function outcome(h: number, a: number): 1 | 0 | -1 {
  return h > a ? 1 : h < a ? -1 : 0
}
// 解析 "1 - 1" / "2-0" 形式的比分串为 [主, 客]，无法解析返回 null。
function parseScore(s: string): [number, number] | null {
  const m = s.match(/(\d+)\s*-\s*(\d+)/)
  return m ? [Number(m[1]), Number(m[2])] : null
}
// AI 胜率最高项的隐含胜平负：1/0/-1
function probOutcome(ai: Match["ai"]): 1 | 0 | -1 {
  const max = Math.max(ai.homeWin, ai.draw, ai.awayWin)
  return ai.homeWin === max ? 1 : ai.awayWin === max ? -1 : 0
}

function computeStats(matches: Match[]): Stats {
  const done = matches
    .filter((m) => m.status === "finished" && m.homeScore != null && m.awayScore != null)
    .sort((x, y) => new Date(x.kickoff).getTime() - new Date(y.kickoff).getTime())

  let resultHit = 0,
    exactHit = 0,
    upsetTotal = 0,
    upsetHit = 0
  let confSum = 0
  const recentAll: boolean[] = []

  for (const m of done) {
    const real = outcome(m.homeScore!, m.awayScore!)
    // 胜平负命中：胜率最高项 或 冷门代表比分(detail.upsetScore) 任一与真实结果一致即算中。
    // 例：POR 1-1 COD，主胜概率最高(未中)，但冷门代表比分 1-1 命中 → 整体算命中。
    const upset = parseScore(m.detail.upsetScore)
    const hit = real === probOutcome(m.ai) || (upset != null && outcome(upset[0], upset[1]) === real)
    recentAll.push(hit)
    confSum += m.ai.confidence
    if (hit) resultHit++
    // 精确比分：赛前比分概率 Top3(按概率降序) 中任一与真实比分完全一致即算中。
    const top3 = [...m.detail.scoreProbs].sort((p, q) => q.prob - p.prob).slice(0, 3)
    if (top3.some((sp) => { const s = parseScore(sp.score); return s != null && s[0] === m.homeScore && s[1] === m.awayScore })) {
      exactHit++
    }
    // 冷门：赛前热门方(胜率更高一侧)未取胜 = 实际爆冷(含被逼平)。
    // upsetHit 统计「AI 事先预警到的」——冷门方不败概率(平 + 冷门方胜)≥ 阈值，
    // 与比赛详情页「逼平或爆冷 X%」同口径。
    const favHome = m.ai.homeWin >= m.ai.awayWin
    const favWon = favHome ? real === 1 : real === -1
    if (!favWon) {
      upsetTotal++
      const underdogNoLose = m.ai.draw + (favHome ? m.ai.awayWin : m.ai.homeWin)
      if (underdogNoLose >= UPSET_ALERT) upsetHit++
    }
  }

  return {
    total: done.length,
    resultHit,
    exactHit,
    upsetTotal,
    upsetHit,
    avgConf: done.length ? Math.round(confSum / done.length) : 0,
    recent: recentAll.slice(-10),
  }
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0
}

// 校准评价：实际命中率 vs AI 自报平均置信度。
// 实际明显高于自报 = 偏保守（低估自己）；明显低于 = 偏自信；接近 = 校准良好。
function calibration(actual: number, claimed: number): string {
  const diff = actual - claimed
  if (diff >= 10) return "偏保守"
  if (diff <= -10) return "偏自信"
  return "校准良好"
}

export function AccuracyScoreboard() {
  const matches = useLiveMatches()
  const s = useMemo(() => computeStats(matches), [matches])

  // 尚无已结算比赛：给出占位说明，避免显示一堆 0。
  if (s.total === 0) {
    return (
      <section className="space-y-3">
        <Header total={0} />
        <div className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          赛事尚未开始，AI 预测战绩将在比赛结束后实时更新。
        </div>
      </section>
    )
  }

  const hitRate = pct(s.resultHit, s.total)

  return (
    <section className="space-y-3">
      <Header total={s.total} />
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-center md:gap-8">
        {/* 主指标：胜负命中率 */}
        <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-start md:gap-1 md:border-r md:border-border md:pr-8">
          <div className="flex items-baseline gap-1">
            <span className="font-heading text-5xl font-700 leading-none tabular-nums text-primary">
              {hitRate}
            </span>
            <span className="font-heading text-xl font-700 text-primary">%</span>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">胜平负命中率</p>
            <p className="text-[10px] leading-tight text-muted-foreground/70">含冷门预警比分</p>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${hitRate}%` }} />
            </div>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              命中 {s.resultHit} / {s.total} 场
            </p>
          </div>
        </div>

        {/* 次要指标网格 */}
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Metric label="Top3精确命中比分" value={`${pct(s.exactHit, s.total)}%`} sub={`${s.exactHit} / ${s.total} 场`} />
          <Metric
            label="冷门预警命中"
            value={s.upsetTotal ? `${s.upsetHit} / ${s.upsetTotal}` : "—"}
            sub={s.upsetTotal ? "爆冷场中已预警" : "暂无爆冷场"}
          />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">自报 vs 实际</p>
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-2xl font-700 tabular-nums text-muted-foreground">{s.avgConf}%</span>
              <span className="text-xs text-muted-foreground">→</span>
              <span className="font-heading text-2xl font-700 tabular-nums text-primary">{hitRate}%</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              自报把握 · 实际命中 ·{" "}
              <span className="font-semibold text-foreground">{calibration(hitRate, s.avgConf)}</span>
            </p>
          </div>
          {/* 近期手感条：跨整行 */}
          <div className="col-span-2 space-y-1.5 sm:col-span-3">
            <p className="text-xs font-semibold text-muted-foreground">近期预测手感</p>
            <div className="flex items-center gap-1.5">
              {s.recent.map((hit, i) => (
                <span
                  key={i}
                  title={hit ? "命中" : "失手"}
                  className={`h-2.5 w-2.5 rounded-full ${hit ? "bg-primary" : "bg-muted-foreground/30"}`}
                />
              ))}
              <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">最近 {s.recent.length} 场</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Header({ total }: { total: number }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-heading text-lg font-700 tracking-tight">
        <Target className="h-5 w-5 text-primary" />
        AI 预测战绩
      </h2>
      <span className="text-[11px] text-muted-foreground">
        {total > 0 ? `已结算 ${total} 场 · 仅供娱乐` : "仅供娱乐"}
      </span>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  highlight,
}: {
  label: string
  value: string
  sub: string
  highlight?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`font-heading text-2xl font-700 tabular-nums ${highlight ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}
