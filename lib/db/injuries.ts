import "server-only"
import { eq, asc } from "drizzle-orm"
import { db } from "./client"
import { injuries, factorsMeta } from "./schema"
import { NAME_ZH } from "./player-names-zh"

export type DbInjury = {
  name: string
  pos: string
  status: "缺阵" | "存疑" | "复出"
  note: string
}

export type DbInjuriesResult = {
  home: DbInjury[]
  away: DbInjury[]
}

// 读取某场伤停。返回 null = 该场从未跑过 ingest-factors（伤停未知，前台保持占位）。
// 返回 {home:[],away:[]} = 已检查但无伤停（前台显示"主力阵容齐整"）。
export function getDbInjuries(matchKey: string): DbInjuriesResult | null {
  try {
    const meta = db.select().from(factorsMeta).where(eq(factorsMeta.matchKey, matchKey)).all()
    if (!meta.length || !meta[0].injuriesChecked) return null
    const rows = db
      .select()
      .from(injuries)
      .where(eq(injuries.matchKey, matchKey))
      .orderBy(asc(injuries.seq))
      .all()
    const map = (side: string): DbInjury[] =>
      rows
        .filter((r) => r.side === side)
        .map((r) => ({
          name: NAME_ZH[r.player] ?? r.player,
          pos: r.pos ?? "",
          status: (["缺阵", "存疑", "复出"].includes(r.status) ? r.status : "缺阵") as DbInjury["status"],
          note: r.note ?? "",
        }))
    return { home: map("home"), away: map("away") }
  } catch {
    return null
  }
}
