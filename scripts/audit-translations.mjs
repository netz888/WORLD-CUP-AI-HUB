import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const dbPath = process.env.WC_DB_PATH || path.join(root, "data", "wc.db")
const mapPath = path.join(root, "lib", "db", "player-names-zh.ts")

function objectKeysFromExport(source, name) {
  const start = source.indexOf(`export const ${name}`)
  if (start < 0) return new Set()
  const brace = source.indexOf("{", start)
  let depth = 0
  let end = brace
  for (; end < source.length; end++) {
    const ch = source[end]
    if (ch === "{") depth++
    if (ch === "}") {
      depth--
      if (depth === 0) break
    }
  }
  const body = source.slice(brace + 1, end)
  const keys = new Set()
  const re = /"([^"]+)"\s*:/g
  let m
  while ((m = re.exec(body))) keys.add(m[1])
  return keys
}

function unique(values) {
  return [...new Set(values.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()))].sort()
}

function printMissing(title, values) {
  console.log(`\n${title}: ${values.length}`)
  for (const v of values.slice(0, 200)) console.log(`- ${v}`)
  if (values.length > 200) console.log(`... and ${values.length - 200} more`)
}

const source = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, "utf8") : ""
const nameMap = objectKeysFromExport(source, "NAME_ZH")
const natMap = objectKeysFromExport(source, "NAT_ZH")

if (!fs.existsSync(dbPath)) {
  console.log(`No database found at ${dbPath}`)
  process.exit(0)
}

const db = new Database(dbPath, { readonly: true })

const lineupNames = unique(
  db.prepare("SELECT start_xi, subs, coach FROM lineups").all().flatMap((r) => {
    const names = []
    for (const col of ["start_xi", "subs"]) {
      try {
        const arr = JSON.parse(r[col] || "[]")
        for (const p of arr) if (p?.name) names.push(p.name)
      } catch {}
    }
    if (r.coach) names.push(r.coach)
    return names
  }),
)

const eventNames = unique(
  db.prepare("SELECT player, assist FROM events").all().flatMap((r) => [r.player, r.assist]),
)
const injuryNames = unique(db.prepare("SELECT player FROM injuries").all().map((r) => r.player))
const refereeNames = unique(db.prepare("SELECT name FROM referees").all().map((r) => r.name))
const refereeNats = unique(db.prepare("SELECT nat FROM referees").all().map((r) => r.nat))

printMissing("Missing lineup/player/coach translations", lineupNames.filter((n) => !nameMap.has(n)))
printMissing("Missing event translations", eventNames.filter((n) => !nameMap.has(n)))
printMissing("Missing injury translations", injuryNames.filter((n) => !nameMap.has(n)))
printMissing("Missing referee name translations", refereeNames.filter((n) => !nameMap.has(n)))
printMissing("Missing referee nationality translations", refereeNats.filter((n) => !natMap.has(n)))

db.close()
