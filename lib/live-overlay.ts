import "server-only"
import { getLiveScores } from "./db/live-scores"
import { MATCHES } from "./data"

// 静态小组赛对阵键集合：用于区分 live_scores 里的「小组赛行」与「淘汰赛行」。
const GROUP_KEYS = new Set(MATCHES.map((m) => `${m.homeCode}-${m.awayCode}`))

// 实时 overlay（服务端专用）。
// 只读本地 live_scores 表；外部 API 由脚本定时写库，不在前台请求链路调用。
// - 免费双源：football-data.org 写比分状态，API-Football 写阵容/事件/裁判。
// - 单源模式：API-Football 同时写比分状态 + 完整数据。
// - 表空/异常时返回空 overlay，前端回退静态赛程，绝不崩。

export type LiveStatus = "live" | "finished" | "upcoming"

export type LiveInfo = {
  status: LiveStatus
  homeScore: number | null
  awayScore: number | null
  kickoffISO: string
  // 该场比赛真实开球的 UTC 时间戳（ms），用于客户端推算"已开赛 xx 分钟"
  kickoffMs: number
  asOf: string | null
  asOfMs: number | null
  apiStatus: string
  // API 返回的状态短码（NS/1H/HT/2H/ET/BT/FT/AET/PEN…），前端据此映射中文 + 是否走秒
  statusShort: string | null
  // API 返回的比赛进行分钟（仅分钟，不含秒）。HT/BT 时为半场结束分钟
  elapsed: number | null
  // 伤停补时分钟（status.extra）。如上半场 45+2 时 extra=2；无补时为 null
  extra: number | null
  // API 原始轮次名（"Round of 16"/"Quarter-finals"/…）。淘汰赛席位解析锚点；小组赛为 null
  round: string | null
}

// overlay 键：`${homeCode}-${awayCode}`，与应用内球队三字码一致（MEX、CIV…）
export type LiveOverlay = Record<string, LiveInfo>

export async function getLiveOverlay(): Promise<LiveOverlay> {
  const overlay: LiveOverlay = {}
  // 读 live_scores（ingest 脚本写入）。表空/异常 → 空 overlay → 前端回退静态。
  try {
    for (const s of getLiveScores()) {
      // 「未开赛且无比分」的条目：小组赛跳过（静态赛程已含，省 payload）；
      // 但淘汰赛要保留——对阵一经 API 确定（即便尚未开赛）前端就能据此把占位符
      // 替换为真实球队，实现「对阵确定即显示」。淘汰赛行 = 不在小组赛对阵集合里的行。
      const isUpcomingEmpty = s.homeScore === null && s.awayScore === null && s.status === "upcoming"
      if (isUpcomingEmpty && GROUP_KEYS.has(s.matchKey)) continue
      const koMs = s.kickoffMs ?? Date.now()
      overlay[s.matchKey] = {
        status: s.status,
        homeScore: s.homeScore,
        awayScore: s.awayScore,
        kickoffISO: new Date(koMs).toISOString(),
        kickoffMs: koMs,
        asOf: s.asOf ?? null,
        asOfMs: s.asOf ? Date.parse(s.asOf) : null,
        apiStatus: s.statusDesc ?? "db",
        statusShort: s.statusShort,
        elapsed: s.elapsed,
        extra: s.extra,
        round: s.round,
      }
    }
  } catch {
    // 忽略本地层异常，返回已累积的 overlay（可能为空）
  }
  return overlay
}
