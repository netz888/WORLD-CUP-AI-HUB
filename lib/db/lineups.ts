import "server-only"
import { eq } from "drizzle-orm"
import { db } from "./client"
import { lineups } from "./schema"
import { NAME_ZH } from "./player-names-zh"
import type { Lineup, Coach } from "../data"

export type LineupKind = "predicted" | "confirmed"

function setLineupKindCache(matchKey: string, kind: LineupKind) {
  const g = globalThis as typeof globalThis & { __lineupKindCache__?: Record<string, LineupKind> }
  g.__lineupKindCache__ ??= {}
  g.__lineupKindCache__[matchKey] = kind
}

type XiPlayer = { number: number; name: string; pos: string; grid: string | null }

function posLabel(pos: string): string {
  return pos === "G" ? "门将" : pos === "D" ? "后卫" : pos === "M" ? "中场" : pos === "F" ? "前锋" : "球员"
}

// 展示用短名：优先中文译名（NAME_ZH），否则取英文最后一个词（保留连字符姓氏）。
function shortName(name: string): string {
  if (NAME_ZH[name]) return NAME_ZH[name]
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || name
}

function normalizeLineupKind(kind: string | null | undefined): LineupKind {
  return kind === "predicted" ? "predicted" : "confirmed"
}

// 把 API 的 startXI 转成本站 Lineup 坐标。
// 优先用 API 的 grid("row:col")：row 1=门将、越大越靠前场；缺失则按位置 G/D/M/F 分行兜底。
function toLineup(formation: string | null, startXiJson: string): Lineup {
  const xi = JSON.parse(startXiJson) as XiPlayer[]
  const players: Lineup["players"] = []
  const hasGrid = xi.length > 0 && xi.every((p) => !!p.grid)

  if (hasGrid) {
    const rows = new Map<number, (XiPlayer & { col: number })[]>()
    for (const p of xi) {
      const [r, c] = (p.grid as string).split(":").map(Number)
      if (!rows.has(r)) rows.set(r, [])
      rows.get(r)!.push({ ...p, col: c })
    }
    const rowNums = [...rows.keys()].sort((a, b) => a - b)
    const maxRow = rowNums[rowNums.length - 1]
    for (const r of rowNums) {
      const inRow = rows.get(r)!.sort((a, b) => a.col - b.col)
      const k = inRow.length
      const y = rowNums.length === 1 ? 50 : 8 + ((r - 1) / (maxRow - 1)) * 78
      inRow.forEach((p, i) => {
        const x = k === 1 ? 50 : 12 + (i / (k - 1)) * 76
        players.push({ num: p.number, role: posLabel(p.pos), x, y, name: shortName(p.name) })
      })
    }
  } else {
    const yByPos: Record<string, number> = { G: 8, D: 26, M: 50, F: 80 }
    for (const pos of ["G", "D", "M", "F"]) {
      const grp = xi.filter((p) => p.pos === pos)
      const k = grp.length
      grp.forEach((p, i) => {
        const x = k === 1 ? 50 : 12 + (i / (k - 1)) * 76
        players.push({ num: p.number, role: posLabel(pos), x, y: yByPos[pos] ?? 50, name: shortName(p.name) })
      })
    }
  }

  return { formation: formation || "—", players }
}

export type DbLineupResult = {
  home?: Lineup
  away?: Lineup
  homeCoach?: Coach
  awayCoach?: Coach
  asOf?: string
  kind?: LineupKind
}

// 读取某场（matchKey="主码-客码"）的入库阵容；无数据或任何异常都返回 null，前端回退静态。
export function getDbLineup(matchKey: string): DbLineupResult | null {
  try {
    const rows = db.select().from(lineups).where(eq(lineups.matchKey, matchKey)).all()
    if (!rows.length) return null
    const out: DbLineupResult = {}
    for (const r of rows) {
      const lu = toLineup(r.formation, r.startXi)
      const coach: Coach | undefined = r.coach
        ? { name: NAME_ZH[r.coach] ?? r.coach, nat: r.teamName ?? "", style: "实际公布阵容" }
        : undefined
      if (r.side === "home") {
        out.home = lu
        out.homeCoach = coach
      } else {
        out.away = lu
        out.awayCoach = coach
      }
      out.asOf = r.asOf
      const kind = normalizeLineupKind(r.kind)
      out.kind = out.kind === "confirmed" || kind === "confirmed" ? "confirmed" : "predicted"
      setLineupKindCache(matchKey, out.kind)
    }
    return out
  } catch {
    return null
  }
}
