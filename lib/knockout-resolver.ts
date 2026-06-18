// 淘汰赛席位解析器（纯函数，客户端/服务端通用）。
// ───────────────────────────────────────────────────────────────────────────
// 作用：把淘汰赛静态槽位（m73…m104，对阵为「A 组第 2 / 第 73 场胜者」等占位标签）
// 接回 poller 已写入 live_scores 的「真实对阵」。
//
// 为什么不自写 FIFA 规则（小组排名 / 最佳第三名组合表 / 胜者链）：
//   poller 遍历 league=1 当日所有比赛，任何能解析出球队码的对阵都会自动入库（含淘汰赛）。
//   小组赛一结束，API 即逐轮放出淘汰赛真实对阵（直接带真实球队），poller 自动写库。
//   因此我们只需把这些「已确定对阵」接回固定槽位即可：
//     · 远期未确定的轮次在 API 里还没有真实球队 → live_scores 无对应行 → 槽位保持「待定」；
//     · 故天然实现「只解析下一轮、逐阶段自动推进」，无需任何人工干预，也无需推演。
//
// 匹配策略（两级，确保精确）：
//   1) round 锚点：API fixture 的 league.round（"Round of 16"/"Quarter-finals"…）映射到本站
//      stage（R16/QF/…），把候选对阵限定到该 stage 的槽位组内——避免跨轮误配。
//   2) 组内 kickoff 最近邻：同一 stage 内，用开球时间做最近邻 1:1 配对。容差 ±3h，
//      小于相邻淘汰赛场次的最小间隔（3.5h），因此不会把相邻两场错配。
//   round 缺失的候选（老数据/异常）回退到「全局 kickoff 最近邻 ±3h」。
// ───────────────────────────────────────────────────────────────────────────
import { KNOCKOUT, MATCHES, type LiveOverlay, type KnockoutStage } from "@/lib/data"

// 静态小组赛对阵键集合。overlay 中凡不属于这 72 场小组赛的条目，
// 必为 poller 自动写入的「已确定淘汰赛对阵」，据此把淘汰赛行从小组赛行里分离出来。
const GROUP_KEYS = new Set(MATCHES.map((m) => `${m.homeCode}-${m.awayCode}`))

export type ResolvedSeat = { homeCode: string; awayCode: string }

// 匹配容差：真实开球时间与静态 FIFA 赛程时间的允许偏差。
// 取 ±3h：同一场比赛两时间几乎一致，3h 足以吸收时区/录入微调，
// 又小于相邻淘汰赛场次最小间隔（3.5h），杜绝错配。
const TOLERANCE_MS = 3 * 3600 * 1000

// API 原始轮次名 → 本站 stage。小写归一后匹配，容忍 "Round of 16"/"round-of-16" 等写法。
function roundToStage(round: string | null | undefined): KnockoutStage | null {
  if (!round) return null
  const r = round.toLowerCase()
  if (r.includes("16")) return "R16"
  if (r.includes("quarter") || /\bqf\b/.test(r)) return "QF"
  if (r.includes("semi") || /\bsf\b/.test(r)) return "SF"
  if (r.includes("3rd") || r.includes("third")) return "3RD"
  if (r.includes("final")) return "FINAL" // 注意：需在 3rd 之后判断，"3rd Place Final" 已先命中 3RD
  // 32 强（2026 新赛制有 R32；部分数据源用 "Round of 32"）
  if (r.includes("32")) return "R32"
  return null
}

type Candidate = { homeCode: string; awayCode: string; kickoffMs: number; stage: KnockoutStage | null }

// 给定实时 overlay，返回 { 槽位 id → 真实对阵 } 的映射。
// 只包含「已确定对阵」的槽位；未确定的不在 map 中，前端据此保持「待定」。
export function resolveKnockout(overlay: LiveOverlay | null | undefined): Map<string, ResolvedSeat> {
  const resolved = new Map<string, ResolvedSeat>()
  if (!overlay) return resolved

  // 候选：overlay 中「非小组赛」且带 kickoffMs 的条目（即已确定的淘汰赛对阵）。
  const candidates: Candidate[] = Object.entries(overlay)
    .filter(([key, info]) => !GROUP_KEYS.has(key) && info && typeof info.kickoffMs === "number")
    .map(([key, info]) => {
      const dash = key.indexOf("-")
      return {
        homeCode: key.slice(0, dash),
        awayCode: key.slice(dash + 1),
        kickoffMs: info!.kickoffMs as number,
        stage: roundToStage(info!.round),
      }
    })
  if (candidates.length === 0) return resolved

  const usedSlots = new Set<string>()
  const usedCands = new Set<number>()

  // 在给定槽位集合与候选索引集合间做「最近邻贪心 1:1」配对（容差内）。
  const matchWithin = (slots: typeof KNOCKOUT, candIdxs: number[]) => {
    const pairs: { slotId: string; candIdx: number; dist: number }[] = []
    for (const slot of slots) {
      if (usedSlots.has(slot.id)) continue
      const slotMs = Date.parse(slot.kickoff)
      for (const ci of candIdxs) {
        if (usedCands.has(ci)) continue
        const dist = Math.abs(slotMs - candidates[ci].kickoffMs)
        if (dist <= TOLERANCE_MS) pairs.push({ slotId: slot.id, candIdx: ci, dist })
      }
    }
    pairs.sort((a, b) => a.dist - b.dist)
    for (const p of pairs) {
      if (usedSlots.has(p.slotId) || usedCands.has(p.candIdx)) continue
      usedSlots.add(p.slotId)
      usedCands.add(p.candIdx)
      const c = candidates[p.candIdx]
      resolved.set(p.slotId, { homeCode: c.homeCode, awayCode: c.awayCode })
    }
  }

  // 1) 优先按 stage 分组匹配（round 已知的候选）：限定槽位组，最精确。
  const stages: KnockoutStage[] = ["R32", "R16", "QF", "SF", "3RD", "FINAL"]
  for (const st of stages) {
    const slots = KNOCKOUT.filter((k) => k.stage === st)
    const candIdxs = candidates.map((_, i) => i).filter((i) => candidates[i].stage === st)
    if (candIdxs.length) matchWithin(slots, candIdxs)
  }

  // 2) 兜底：round 缺失的候选，对全部未占用槽位做全局最近邻匹配。
  const leftover = candidates.map((_, i) => i).filter((i) => !usedCands.has(i) && candidates[i].stage === null)
  if (leftover.length) matchWithin(KNOCKOUT, leftover)

  return resolved
}
