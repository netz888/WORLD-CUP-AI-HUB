import "server-only"
import { eq, asc } from "drizzle-orm"
import { db } from "./client"
import { matchFactors } from "./schema"

export type DbFactor = {
  label: string
  home: string
  away: string
  edge: "home" | "away" | "even"
}

// 读取某场的「关键因素对比」（GLM 整合真实数据生成、已入库）。无则返回 null。
export function getDbFactors(matchKey: string): DbFactor[] | null {
  try {
    const rows = db
      .select()
      .from(matchFactors)
      .where(eq(matchFactors.matchKey, matchKey))
      .orderBy(asc(matchFactors.seq))
      .all()
    if (!rows.length) return null
    return rows.map((r) => ({
      label: r.label,
      home: r.home,
      away: r.away,
      edge: (["home", "away", "even"].includes(r.edge) ? r.edge : "even") as DbFactor["edge"],
    }))
  } catch {
    return null
  }
}
