// ---------------------------------------------------------------------------
// gen-wc-structure.mts —— 从 lib/data.ts 一次性导出「夺冠模拟器所需的结构快照」。
//
// 为什么需要它：lib/data.ts 用无扩展名 import + JSON import（bundler 风格），裸 node 无法解析，
// 故夺冠模拟脚本（plain node .mjs）不能直接 import data.ts。本生成器用 tsx 运行（esbuild 内核，
// 原生支持上述语法），把模拟所需的【静态结构数据】固化成 scripts/lib/wc-structure.json，
// 供运行时脚本以纯 node 读取，零运行时 tsx 依赖、与现有脚本体系一致。
//
// 何时重跑（数据源单一，避免漂移）：当 lib/data.ts 的 TEAMS 排名/分组、FIXTURES、KNOCKOUT_RAW、
// 或 RESULTS 发生变化时。命令：  npx tsx scripts/gen-wc-structure.mts
// 注意：动态赛果（live_scores 表）由运行时读取，不进本快照；本快照里的 staticResults 仅作
// 「无 poller 时的兜底种子」。
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  TEAMS,
  GROUPS,
  FIXTURES,
  KNOCKOUT_RAW,
  HOST_CODES,
  VENUE_BY_KEY,
  RESULTS,
} from "../lib/data.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const teams = TEAMS.map((t) => ({ code: t.code, rank: t.fifaRank, group: t.group }))

// fixtures：展开为 {home, away, venueKey, alt}（alt 用于 λ 的高原修正）。
const fixtures: { group: string; home: string; away: string; venueKey: string; alt: number }[] = []
for (const g of GROUPS) {
  for (const fx of FIXTURES[g]) {
    const [home, away, , , venueKey] = fx
    const alt = VENUE_BY_KEY[venueKey]?.altitude ?? 0
    fixtures.push({ group: g, home, away, venueKey, alt })
  }
}

// knockout：{matchNo, stage, homeSeat, awaySeat, alt}（席位标签原样保留，由模拟器解析；alt 供高原修正）。
const knockout = KNOCKOUT_RAW.map(([no, stage, , venueKey, homeSeat, awaySeat]) => ({
  no,
  stage,
  homeSeat,
  awaySeat,
  alt: VENUE_BY_KEY[venueKey]?.altitude ?? 0,
}))

const out = {
  generatedAt: new Date().toISOString(),
  note: "由 scripts/gen-wc-structure.mts 从 lib/data.ts 生成，请勿手改。重跑：npx tsx scripts/gen-wc-structure.mts",
  groups: GROUPS,
  hostCodes: [...HOST_CODES],
  teams,
  fixtures,
  knockout,
  staticResults: RESULTS,
}

const outDir = path.join(__dirname, "lib")
mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, "wc-structure.json")
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8")
console.log(
  `[v0] wc-structure.json 生成完成：${teams.length} 队 / ${fixtures.length} 场小组赛 / ${knockout.length} 场淘汰赛 / ${Object.keys(RESULTS).length} 条静态赛果`,
)
