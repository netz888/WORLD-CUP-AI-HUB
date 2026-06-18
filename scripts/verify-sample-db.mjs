import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "data", "sample.wc.db")

const requiredTables = [
  "live_scores",
  "lineups",
  "events",
  "referees",
  "match_stats",
  "champion_sim",
  "champion_sim_meta",
]

const minRows = {
  live_scores: 3,
  lineups: 2,
  events: 2,
  referees: 1,
  match_stats: 2,
  champion_sim: 4,
  champion_sim_meta: 1,
}

function fail(message) {
  console.error(`sample db verification failed: ${message}`)
  process.exit(1)
}

if (!fs.existsSync(dbPath)) {
  fail(`missing database: ${path.relative(root, dbPath)}`)
}

const db = new Database(dbPath, { readonly: true })
const tables = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
)

for (const table of requiredTables) {
  if (!tables.has(table)) fail(`missing table: ${table}`)
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
  if (row.count < minRows[table]) {
    fail(`${table} has ${row.count} rows, expected at least ${minRows[table]}`)
  }
}

const live = db.prepare("SELECT status, status_short FROM live_scores ORDER BY match_key").all()
const statuses = new Set(live.map((row) => row.status))
for (const status of ["upcoming", "live", "finished"]) {
  if (!statuses.has(status)) fail(`live_scores missing ${status} sample`)
}

console.log(`sample db verification passed: ${path.relative(root, dbPath)}`)
