import "server-only"
import path from "node:path"
import fs from "node:fs"
// 原生模块 better-sqlite3 在本环境无法编译/无预编译包（Could not locate the bindings file），
// 改用基于 Node 内置 node:sqlite 的兼容层（接口与 better-sqlite3 一致），
// drizzle 的 better-sqlite3 适配器可无感使用。
import Database from "./sqlite-node.mjs"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

// SQLite 文件库（服务端专用）。库文件放在 data/wc.db，已在 .gitignore 忽略。
// 抓取脚本 scripts/ingest-lineups.mjs 写入同一个库；本模块负责应用侧只读访问。
const dbPath = process.env.WC_DB_PATH || path.join(process.cwd(), "data", "wc.db")
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma("journal_mode = WAL")

// 轻量建表（免迁移工具）。与 scripts/ingest-lineups.mjs 中的建表语句保持一致。
sqlite.exec(`CREATE TABLE IF NOT EXISTS lineups (
  match_key TEXT NOT NULL,
  side TEXT NOT NULL,
  team_code TEXT NOT NULL,
  team_name TEXT,
  formation TEXT,
  coach TEXT,
  kind TEXT NOT NULL DEFAULT 'confirmed',
  source TEXT NOT NULL DEFAULT 'api-football',
  fixture_id INTEGER,
  start_xi TEXT NOT NULL,
  subs TEXT,
  as_of TEXT NOT NULL,
  PRIMARY KEY (match_key, side)
)`)

sqlite.exec(`CREATE TABLE IF NOT EXISTS events (
  fixture_id INTEGER NOT NULL,
  match_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  minute INTEGER,
  extra INTEGER,
  side TEXT NOT NULL,
  team_code TEXT NOT NULL,
  team_name TEXT,
  type TEXT NOT NULL,
  detail TEXT,
  player TEXT,
  assist TEXT,
  PRIMARY KEY (fixture_id, seq)
)`)

sqlite.exec(`CREATE TABLE IF NOT EXISTS referees (
  match_key TEXT PRIMARY KEY,
  fixture_id INTEGER,
  name TEXT NOT NULL,
  nat TEXT NOT NULL DEFAULT '',
  avg_yellow REAL NOT NULL DEFAULT 4.2,
  avg_red REAL NOT NULL DEFAULT 0.2,
  penalty_rate REAL NOT NULL DEFAULT 0.27,
  note TEXT,
  as_of TEXT NOT NULL
)`)

// 实时比分（由 scripts/poller.mjs 写入，应用侧只读）。进程缺席时此表为空，不影响其它功能。
// status_short/elapsed/extra：原始状态码 + 比赛分钟 + 补时分钟，供前端实时比赛钟（本地推秒）。
sqlite.exec(`CREATE TABLE IF NOT EXISTS live_scores (
  match_key TEXT PRIMARY KEY,
  fixture_id INTEGER,
  home_code TEXT,
  away_code TEXT,
  home_score INTEGER,
  away_score INTEGER,
  status TEXT NOT NULL,
  status_desc TEXT,
  status_short TEXT,
  elapsed INTEGER,
  extra INTEGER,
  kickoff_ms INTEGER,
  round TEXT,
  as_of TEXT NOT NULL
)`)
// 兼容旧库：增列（已存在则忽略）。round：淘汰赛席位解析锚点（API 原始轮次名）。
for (const col of ["status_short TEXT", "elapsed INTEGER", "extra INTEGER", "round TEXT"]) {
  try { sqlite.exec(`ALTER TABLE live_scores ADD COLUMN ${col}`) } catch { /* 已存在 */ }
}

// 夺冠榜实时模拟快照（由 scripts/run-champion-sim.mjs / poller 写入，应用侧只读）。
// 空表时前端回退 lib/champion-sim-data.ts 静态基线。建表语句与该脚本保持一致。
sqlite.exec(`CREATE TABLE IF NOT EXISTS champion_sim (
  team_code TEXT PRIMARY KEY,
  champ REAL NOT NULL DEFAULT 0,
  final REAL NOT NULL DEFAULT 0,
  sf REAL NOT NULL DEFAULT 0,
  qf REAL NOT NULL DEFAULT 0,
  r16 REAL NOT NULL DEFAULT 0,
  qualify REAL NOT NULL DEFAULT 0,
  as_of TEXT NOT NULL
)`)
sqlite.exec(`CREATE TABLE IF NOT EXISTS champion_sim_meta (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  results_hash TEXT NOT NULL DEFAULT '',
  n_sims INTEGER NOT NULL DEFAULT 0,
  as_of TEXT NOT NULL
)`)

export const db = drizzle(sqlite, { schema })

// 原始 better-sqlite3 句柄：用于需要跨多表聚合的请求时实时计算（如球队画像 form/ka/球星状态）。
export const sqliteRaw = sqlite
