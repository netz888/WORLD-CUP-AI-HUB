import { db } from "./client"
import { matchStats } from "./schema"
import { eq } from "drizzle-orm"

// 单侧技术统计（与 SofaScore 同口径，全部八项 + 衍生）
export type SideStats = {
  possession: number | null // 控球率 %
  shotsTotal: number | null // 射门
  shotsOnTarget: number | null // 射正
  xg: number | null // 预期进球
  corners: number | null // 角球
  fouls: number | null // 犯规
  passAccuracy: number | null // 传球成功率 %
  offsides: number | null // 越位
}

export type MatchStatsPair = {
  home: SideStats | null
  away: SideStats | null
  hasData: boolean // 至少有一侧有控球率或射门，说明已开始采集
}

const EMPTY: SideStats = {
  possession: null,
  shotsTotal: null,
  shotsOnTarget: null,
  xg: null,
  corners: null,
  fouls: null,
  passAccuracy: null,
  offsides: null,
}

function rowToSide(r: typeof matchStats.$inferSelect): SideStats {
  return {
    possession: r.possession,
    shotsTotal: r.totalShots,
    shotsOnTarget: r.shotsOn,
    xg: r.xg,
    corners: r.corners,
    fouls: r.fouls,
    passAccuracy: r.passesPct,
    offsides: r.offsides,
  }
}

// 读取单场两队技术统计。matchKey 形如 "GHA-PAN"。
export function getMatchStats(matchKey: string): MatchStatsPair {
  const rows = db.select().from(matchStats).where(eq(matchStats.matchKey, matchKey)).all()
  let home: SideStats | null = null
  let away: SideStats | null = null
  for (const r of rows) {
    if (r.side === "home") home = rowToSide(r)
    else if (r.side === "away") away = rowToSide(r)
  }
  const hasData =
    !!(home && (home.possession != null || home.shotsTotal != null)) ||
    !!(away && (away.possession != null || away.shotsTotal != null))
  return { home: home ?? (away ? EMPTY : null), away: away ?? (home ? EMPTY : null), hasData }
}
