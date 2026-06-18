import { notFound } from "next/navigation"
import {
  MATCHES,
  getMatch,
  getMatchWithLiveProfile,
  getTeam,
  getKnockoutSlot,
  buildKnockoutMatch,
  mergeLiveOverlay,
} from "@/lib/data"
import { resolveKnockout } from "@/lib/knockout-resolver"
import { getLiveOverlay } from "@/lib/live-overlay"
import { getDbLineup } from "@/lib/db/lineups"
import { teamCoach } from "@/lib/db/team-coaches"
import { getDbEvents } from "@/lib/db/events"
import { getDbReferee } from "@/lib/db/referees"
import { getDbFactors } from "@/lib/db/factors"
import { getDbInjuries } from "@/lib/db/injuries"
import { getLiveProfile } from "@/lib/db/profile-live"
import { MatchAnalysis } from "@/components/match-analysis"
import { PageTransition } from "@/components/page-transition"

export function generateStaticParams() {
  return MATCHES.map((m) => ({ id: m.id }))
}

// Phase 3：请求时渲染，读最新 DB。官方阵容/比分一入库 → 下次访问预测自动重算（不用重 build）。
export const dynamic = "force-dynamic"

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let base = getMatch(id)
  // 淘汰赛 id（m73…m104）：不在静态 MATCHES 中。用实时 overlay 解析对阵，
  // 已确定则就地构建带 AI 预测的完整 Match（与首页同源）；未确定则 404。
  if (!base) {
    const slot = getKnockoutSlot(id)
    if (slot) {
      const overlay = await getLiveOverlay()
      const seat = resolveKnockout(overlay).get(id)
      if (seat) {
        const built = buildKnockoutMatch(slot, seat.homeCode, seat.awayCode)
        if (built) base = mergeLiveOverlay([built], overlay)[0]
      }
    }
  }
  if (!base) notFound()

  // 请求时实时画像：用最新 DB 重算该场预测/球星状态/核心因素；DB 无数据则回退静态快照。
  const matchKey = `${base.homeCode}-${base.awayCode}`
  const liveProfile = getLiveProfile(matchKey)
  const dbL = getDbLineup(matchKey)
  const match = getMatchWithLiveProfile(id, liveProfile, dbL?.kind) ?? base
  const dbEvents = getDbEvents(matchKey)
  const dbRef = getDbReferee(matchKey)
  const dbFactors = getDbFactors(matchKey)
  const dbInjuries = getDbInjuries(matchKey)
  // 两队都入库才显示阵容；只入库一边时不混用另一边的静态假数据。
  const hasLineups = !!(dbL && dbL.home && dbL.away)
  const hasEvents = dbEvents.length > 0
  const hasReferee = dbRef !== null
  const hasFactors = !!(dbFactors && dbFactors.length > 0)
  const hasInjuries = dbInjuries !== null

  // 主教练：球队绑定表兜底（赛前即有），API 入库的实际教练优先覆盖（见 lib/db/team-coaches.ts）。
  const homeBound = teamCoach(base.homeCode)
  const awayBound = teamCoach(base.awayCode)
  const homeCoach =
    dbL?.homeCoach ??
    (homeBound ? { name: homeBound.name, nat: getTeam(base.homeCode).name, style: homeBound.style } : undefined)
  const awayCoach =
    dbL?.awayCoach ??
    (awayBound ? { name: awayBound.name, nat: getTeam(base.awayCode).name, style: awayBound.style } : undefined)
  // 只要两边都拿得到教练（API 或绑定）就展示该区块。
  const hasCoaches = !!(homeCoach && awayCoach)

  const hasDb = hasLineups || hasEvents || hasReferee || hasFactors || hasInjuries || hasCoaches
  const finalMatch = hasDb
    ? {
        ...match,
        detail: {
          ...match.detail,
          homeLineup: dbL?.home ?? match.detail.homeLineup,
          awayLineup: dbL?.away ?? match.detail.awayLineup,
          lineupKind: hasLineups ? dbL?.kind : match.detail.lineupKind,
          homeCoach: homeCoach ?? match.detail.homeCoach,
          awayCoach: awayCoach ?? match.detail.awayCoach,
          events: dbEvents.length > 0 ? dbEvents : match.detail.events,
          // 核心球员可用性是数据驱动实时派生的（match.detail.factors[0]），即便有 GLM 缓存也要保留在最前。
          factors: (() => {
            const starF = match.detail.factors.find((f) => f.label === "核心球员可用性")
            if (hasFactors) return starF ? [starF, ...dbFactors!] : dbFactors!
            return match.detail.factors
          })(),
          homeInjuries: hasInjuries ? dbInjuries!.home : match.detail.homeInjuries,
          awayInjuries: hasInjuries ? dbInjuries!.away : match.detail.awayInjuries,
          referee: dbRef
            ? {
                ...match.detail.referee,
                name: dbRef.name,
                nat: dbRef.nat,
                avgYellow: dbRef.avgYellow,
                avgRed: dbRef.avgRed,
                penaltyRate: dbRef.penaltyRate,
                note: dbRef.note,
              }
            : match.detail.referee,
          dataMode: "real" as const,
          realData: {
            lineups: hasLineups,
            events: hasEvents,
            referee: hasReferee,
            coaches: hasCoaches,
            injuries: hasInjuries,
            factors: hasFactors,
          },
        },
      }
    : match

  return (
    <PageTransition>
      <MatchAnalysis match={finalMatch} />
    </PageTransition>
  )
}
