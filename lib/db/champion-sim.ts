import "server-only"
import { db } from "./client"
import { championSim } from "./schema"
import type { ChampionSim } from "../champion-sim-data"
import { buildChampionRace, CHAMPION_RACE, type ChampionOdds } from "../data"

// 读取夺冠榜实时模拟快照（由 scripts/run-champion-sim.mjs / poller 写入）。
// 返回与静态 CHAMPION_SIM 同结构的 Record<三字码, ChampionSim>。
// 表不存在 / 无数据 / 异常一律返回 null，让上层无缝回退到 lib/champion-sim-data.ts 静态基线。
export function readChampionSim(): Record<string, ChampionSim> | null {
  try {
    const rows = db.select().from(championSim).all()
    if (!rows.length) return null
    const out: Record<string, ChampionSim> = {}
    for (const r of rows) {
      out[r.teamCode] = {
        champ: r.champ,
        final: r.final,
        sf: r.sf,
        qf: r.qf,
        r16: r.r16,
        qualify: r.qualify,
      }
    }
    return out
  } catch {
    return null
  }
}

// 服务端组装实时夺冠榜：读 DB 快照 → buildChampionRace；DB 空时回退静态 CHAMPION_RACE。
// 供 app/champions 页与 /api/live 使用。
export function getChampionRace(): ChampionOdds[] {
  const sim = readChampionSim()
  return sim ? buildChampionRace(sim) : CHAMPION_RACE
}
