// 夺冠榜实时模拟运行器
// ───────────────────────────────────────────────────────────────────────────
// 读「已完赛结果集合」（静态 RESULTS 打底 ∪ live_scores 中 status=finished 覆盖），
// 跑 2 万次锦标赛蒙特卡洛（已完赛锁死、其余按 v6 Elo λ 泊松抽样），写 champion_sim 表。
// 「仅赛果变化时重算」：对结果集合算 hash，与 champion_sim_meta.results_hash 比对，
// 未变则跳过（除非 --force）。可独立运行，也被 poller 在有比赛打完时触发。
//
// 用法：
//   node scripts/run-champion-sim.mjs            # 赛果变化才重算
//   node scripts/run-champion-sim.mjs --force    # 强制重算
//   N_SIMS=30000 node scripts/run-champion-sim.mjs
// ───────────────────────────────────────────────────────────────────────────
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { simulate, buildFinished, resultsHash } from "./lib/champion-sim-core.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FORCE = process.argv.includes("--force")
const N_SIMS = Number(process.env.N_SIMS || 20000)

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")

// 建表（与 lib/db/client.ts 保持一致，幂等）。
function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS champion_sim (
    team_code TEXT PRIMARY KEY,
    champ REAL NOT NULL DEFAULT 0,
    final REAL NOT NULL DEFAULT 0,
    sf REAL NOT NULL DEFAULT 0,
    qf REAL NOT NULL DEFAULT 0,
    r16 REAL NOT NULL DEFAULT 0,
    qualify REAL NOT NULL DEFAULT 0,
    as_of TEXT NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS champion_sim_meta (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    results_hash TEXT NOT NULL DEFAULT '',
    n_sims INTEGER NOT NULL DEFAULT 0,
    as_of TEXT NOT NULL
  )`)
}

// 已完赛集合：静态 RESULTS 打底，再用 live_scores 中 status=finished 且比分非空的覆盖（实时权威）。
// 经核心 buildFinished 规范化：主客朝向校正、仅纳入小组赛赛程场次（淘汰赛由模拟推演，不作输入约束）。
function collectFinished(db) {
  let rows = []
  try {
    rows = db
      .prepare(
        `SELECT home_code, away_code, home_score, away_score FROM live_scores
         WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
      )
      .all()
  } catch {
    /* 表不存在则仅用静态基线 */
  }
  return buildFinished(rows)
}

function main() {
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  ensureTables(db)

  const finished = collectFinished(db)
  const hash = resultsHash(finished)
  const prev = db.prepare("SELECT results_hash FROM champion_sim_meta WHERE id = 'singleton'").get()

  if (!FORCE && prev && prev.results_hash === hash) {
    console.log(`[v0] 夺冠模拟跳过：赛果未变（${finished.size} 场已完赛）`)
    db.close()
    return false
  }

  const t0 = Date.now()
  const table = simulate(finished, N_SIMS)
  const asOf = new Date().toISOString()

  const upsert = db.prepare(
    `INSERT INTO champion_sim (team_code, champ, final, sf, qf, r16, qualify, as_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_code) DO UPDATE SET
       champ=excluded.champ, final=excluded.final, sf=excluded.sf,
       qf=excluded.qf, r16=excluded.r16, qualify=excluded.qualify, as_of=excluded.as_of`,
  )
  const writeAll = db.transaction(() => {
    for (const code in table) {
      const v = table[code]
      upsert.run(code, v.champ, v.final, v.sf, v.qf, v.r16, v.qualify, asOf)
    }
    db.prepare(
      `INSERT INTO champion_sim_meta (id, results_hash, n_sims, as_of) VALUES ('singleton', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET results_hash=excluded.results_hash, n_sims=excluded.n_sims, as_of=excluded.as_of`,
    ).run(hash, N_SIMS, asOf)
  })
  writeAll()

  const top = Object.entries(table)
    .sort((a, b) => b[1].champ - a[1].champ)
    .slice(0, 5)
    .map(([c, v]) => `${c} ${v.champ}%`)
    .join(" / ")
  console.log(
    `[v0] 夺冠模拟完成：${finished.size} 场已完赛 × ${N_SIMS} 次，耗时 ${Date.now() - t0}ms，写入 ${Object.keys(table).length} 队。Top5: ${top}`,
  )
  db.close()
  return true
}

main()
