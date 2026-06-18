import "server-only"
import { eq } from "drizzle-orm"
import { db } from "./client"
import { referees } from "./schema"
import { NAME_ZH, NAT_ZH } from "./player-names-zh"

export type DbRefereeResult = {
  name: string
  nat: string
  avgYellow: number
  avgRed: number
  penaltyRate: number
  note: string
}

export function getDbReferee(matchKey: string): DbRefereeResult | null {
  try {
    const rows = db.select().from(referees).where(eq(referees.matchKey, matchKey)).all()
    if (!rows.length) return null
    const r = rows[0]
    const zhName = NAME_ZH[r.name] ?? r.name
    const zhNat = NAT_ZH[r.nat] ?? r.nat
    return {
      name: zhName,
      nat: zhNat,
      avgYellow: r.avgYellow,
      avgRed: r.avgRed,
      penaltyRate: r.penaltyRate,
      note: r.note ?? `主裁判${zhName}（${zhNat}）执法本场，以上数据为世界杯赛事均值（参考）。`,
    }
  } catch {
    return null
  }
}
