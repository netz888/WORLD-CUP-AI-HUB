// 实时比分/状态落库脚本（football-data.org → live_scores）。
// 用法：FOOTBALL_DATA_API_KEY=xxx node scripts/ingest-scores.mjs [utc-date]
// - 不传日期：写入 football-data 返回的全部世界杯比赛。
// - 传日期（如 2026-06-16）：只写该 UTC 日期的比赛。
// 说明：前端不直接调用外部 API，只读 live_scores；本脚本可用 cron/pm2 定时运行。
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEY = await requireKey("FOOTBALL_DATA_API_KEY")
const BASE = "https://api.football-data.org/v4"
const COMPETITION_WORLD_CUP = 2000 // FIFA World Cup（season 2026）
const FILTER_DATE = process.argv[2] || null // UTC YYYY-MM-DD

function mapStatus(apiStatus) {
  switch (apiStatus) {
    case "IN_PLAY":
    case "PAUSED":
    case "SUSPENDED":
      return "live"
    case "FINISHED":
    case "AWARDED":
      return "finished"
    default:
      return "upcoming"
  }
}

const TLA_ALIAS = {
  URY: "URU", // Uruguay
}

const NAME_TO_CODE = {
  Mexico: "MEX",
  "South Africa": "RSA",
  "South Korea": "KOR",
  "Korea Republic": "KOR",
  Czechia: "CZE",
  "Czech Republic": "CZE",
  Canada: "CAN",
  "Bosnia-Herzegovina": "BIH",
  "Bosnia and Herzegovina": "BIH",
  Qatar: "QAT",
  Switzerland: "SUI",
  Brazil: "BRA",
  Morocco: "MAR",
  Haiti: "HAI",
  Scotland: "SCO",
  USA: "USA",
  "United States": "USA",
  Australia: "AUS",
  Turkey: "TUR",
  Türkiye: "TUR",
  Germany: "GER",
  Curaçao: "CUW",
  Curacao: "CUW",
  "Ivory Coast": "CIV",
  "Côte d'Ivoire": "CIV",
  Netherlands: "NED",
  Japan: "JPN",
  Sweden: "SWE",
  Tunisia: "TUN",
  Spain: "ESP",
  "Cape Verde": "CPV",
  "Cabo Verde": "CPV",
  Belgium: "BEL",
  Egypt: "EGY",
  "Saudi Arabia": "KSA",
  Uruguay: "URU",
  Iran: "IRN",
  "New Zealand": "NZL",
  France: "FRA",
  Senegal: "SEN",
  Iraq: "IRQ",
  Norway: "NOR",
  Argentina: "ARG",
  Algeria: "ALG",
  Austria: "AUT",
  Jordan: "JOR",
  Portugal: "POR",
  "DR Congo": "COD",
  "Congo DR": "COD",
  England: "ENG",
  Croatia: "CRO",
  Ghana: "GHA",
  Panama: "PAN",
  Uzbekistan: "UZB",
  Colombia: "COL",
  Paraguay: "PAR",
  Ecuador: "ECU",
}

function codeOf(team) {
  if (team?.tla) return TLA_ALIAS[team.tla] ?? team.tla
  return NAME_TO_CODE[team?.name] ?? null
}

async function api(q) {
  const res = await fetch(BASE + q, { headers: { "X-Auth-Token": KEY } })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`football-data ${res.status} on ${q}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(`CREATE TABLE IF NOT EXISTS live_scores (
  match_key TEXT PRIMARY KEY, fixture_id INTEGER,
  home_code TEXT, away_code TEXT,
  home_score INTEGER, away_score INTEGER,
  status TEXT NOT NULL, status_desc TEXT,
  kickoff_ms INTEGER, as_of TEXT NOT NULL
)`)
const upsertScore = db.prepare(`INSERT INTO live_scores
  (match_key, fixture_id, home_code, away_code, home_score, away_score, status, status_desc, kickoff_ms, as_of)
  VALUES (@match_key, @fixture_id, @home_code, @away_code, @home_score, @away_score, @status, @status_desc, @kickoff_ms, @as_of)
  ON CONFLICT(match_key) DO UPDATE SET
    fixture_id=excluded.fixture_id, home_code=excluded.home_code, away_code=excluded.away_code,
    home_score=excluded.home_score, away_score=excluded.away_score,
    status=excluded.status, status_desc=excluded.status_desc,
    kickoff_ms=excluded.kickoff_ms, as_of=excluded.as_of`)

async function run() {
  const now = new Date().toISOString()
  const data = await api(`/competitions/${COMPETITION_WORLD_CUP}/matches`)
  let seen = 0
  let written = 0
  for (const m of data.matches ?? []) {
    const date = String(m.utcDate || "").slice(0, 10)
    if (FILTER_DATE && date !== FILTER_DATE) continue
    seen++
    const hc = codeOf(m.homeTeam)
    const ac = codeOf(m.awayTeam)
    if (!hc || !ac) {
      console.log(`⚠ 跳过 ${m.id}: 队名未映射 (${m.homeTeam?.name} / ${m.awayTeam?.name})`)
      continue
    }
    const matchKey = `${hc}-${ac}`
    const kickoffMs = Date.parse(m.utcDate)
    upsertScore.run({
      match_key: matchKey,
      fixture_id: m.id,
      home_code: hc,
      away_code: ac,
      home_score: m.score?.fullTime?.home ?? null,
      away_score: m.score?.fullTime?.away ?? null,
      status: mapStatus(m.status),
      status_desc: m.status || null,
      kickoff_ms: Number.isFinite(kickoffMs) ? kickoffMs : null,
      as_of: now,
    })
    written++
    console.log(`✓ ${matchKey} ${m.score?.fullTime?.home ?? "-"}-${m.score?.fullTime?.away ?? "-"} ${m.status}`)
  }
  const cnt = db.prepare("SELECT COUNT(*) n FROM live_scores").get().n
  console.log(`\n完成：football-data 读取 ${seen} 场，写入/更新 ${written} 场，live_scores 库内 ${cnt} 场 → ${dbPath}`)
  db.close()
}

run().catch((e) => { console.error("失败:", e.message); process.exit(1) })
