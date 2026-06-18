import "server-only"
import { eq, asc } from "drizzle-orm"
import { db } from "./client"
import { events } from "./schema"
import { NAME_ZH } from "./player-names-zh"
import type { MatchEvent } from "../data"

const zh = (n: string | null): string => (n ? NAME_ZH[n] ?? n : "")

// 读取某场（matchKey="主码-客码"）的真实比赛事件，按 seq 升序。无数据/异常返回 []。
export function getDbEvents(matchKey: string): MatchEvent[] {
  try {
    const rows = db
      .select()
      .from(events)
      .where(eq(events.matchKey, matchKey))
      .orderBy(asc(events.seq))
      .all()
    return rows.map((r) => ({
      minute: r.minute ?? 0,
      extra: r.extra ?? undefined,
      side: (r.side === "home" ? "home" : "away") as "home" | "away",
      type: r.type,
      detail: r.detail ?? "",
      player: zh(r.player),
      assist: r.assist ? zh(r.assist) : undefined,
    }))
  } catch {
    return []
  }
}
