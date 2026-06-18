import "server-only"
import { db } from "./client"
import { liveScores } from "./schema"

export type LiveScoreEntry = {
  matchKey: string // "GER-CUW"
  homeScore: number | null
  awayScore: number | null
  status: "live" | "finished" | "upcoming"
  statusDesc: string | null
  statusShort: string | null
  elapsed: number | null
  extra: number | null
  kickoffMs: number | null
  round: string | null
  asOf: string | null
}

// 读取本地实时进程写入的全部比分行。表不存在/无数据/异常一律返回 []，
// 让上层（getLiveOverlay）无缝回退到空 overlay（前端用静态赛程）。
export function getLiveScores(): LiveScoreEntry[] {
  try {
    const rows = db.select().from(liveScores).all()
    return rows.map((r) => ({
      matchKey: r.matchKey,
      homeScore: r.homeScore ?? null,
      awayScore: r.awayScore ?? null,
      status:
        r.status === "live" ? "live" : r.status === "finished" ? "finished" : "upcoming",
      statusDesc: r.statusDesc ?? null,
      statusShort: r.statusShort ?? null,
      elapsed: r.elapsed ?? null,
      extra: r.extra ?? null,
      kickoffMs: r.kickoffMs ?? null,
      round: r.round ?? null,
      asOf: r.asOf ?? null,
    }))
  } catch {
    return []
  }
}
