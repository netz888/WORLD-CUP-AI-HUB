import "server-only"
import { and, eq, ne, or } from "drizzle-orm"
import { db } from "./client"
import { liveScores, matchStats } from "./schema"

export type TeamProfile = {
  code: string
  played: number // 已完赛场次（不含当前场）
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  formGD: number // 场均净胜球（真实，约 -3..3），喂给预测模型 formHome/formAway
  // 真实场均统计（有 match_stats 的场次）
  avgXgFor: number | null
  avgXgAgainst: number | null
  avgPossession: number | null
  avgShots: number | null
  statSamples: number
}

// 从 DB 聚合某队赛前画像。excludeMatchKey：预测某场时排除该场本身，避免数据泄漏。
export function getTeamProfile(code: string, excludeMatchKey?: string): TeamProfile {
  const base: TeamProfile = {
    code, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
    formGD: 0, avgXgFor: null, avgXgAgainst: null, avgPossession: null, avgShots: null, statSamples: 0,
  }
  try {
    const rows = db
      .select()
      .from(liveScores)
      .where(
        and(
          eq(liveScores.status, "finished"),
          or(eq(liveScores.homeCode, code), eq(liveScores.awayCode, code)),
          excludeMatchKey ? ne(liveScores.matchKey, excludeMatchKey) : undefined,
        ),
      )
      .all()

    let xgFor = 0, xgAg = 0, poss = 0, shots = 0, statN = 0
    for (const r of rows) {
      const side: "home" | "away" = r.homeCode === code ? "home" : "away"
      const my = (side === "home" ? r.homeScore : r.awayScore) ?? 0
      const opp = (side === "home" ? r.awayScore : r.homeScore) ?? 0
      base.played++
      base.goalsFor += my
      base.goalsAgainst += opp
      if (my > opp) base.wins++
      else if (my === opp) base.draws++
      else base.losses++

      const myStat = db.select().from(matchStats).where(and(eq(matchStats.matchKey, r.matchKey), eq(matchStats.side, side))).all()[0]
      const opStat = db.select().from(matchStats).where(and(eq(matchStats.matchKey, r.matchKey), eq(matchStats.side, side === "home" ? "away" : "home"))).all()[0]
      if (myStat) {
        statN++
        if (myStat.xg != null) xgFor += myStat.xg
        if (opStat?.xg != null) xgAg += opStat.xg
        if (myStat.possession != null) poss += myStat.possession
        if (myStat.totalShots != null) shots += myStat.totalShots
      }
    }
    if (base.played > 0) base.formGD = +((base.goalsFor - base.goalsAgainst) / base.played).toFixed(2)
    if (statN > 0) {
      base.statSamples = statN
      base.avgXgFor = +(xgFor / statN).toFixed(2)
      base.avgXgAgainst = +(xgAg / statN).toFixed(2)
      base.avgPossession = Math.round(poss / statN)
      base.avgShots = +(shots / statN).toFixed(1)
    }
    return base
  } catch {
    return base
  }
}
