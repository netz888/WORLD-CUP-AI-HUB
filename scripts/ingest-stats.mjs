// 真实赛果统计 + 历史交锋 入库（Phase 0 数据地基）。
// - /fixtures/statistics?fixture= → match_stats（每场每队一行原始统计）
// - /fixtures/headtohead?h2h=A-B  → h2h（两队真实历史交锋；空则不写，前台标"暂无"）
// 用法：API_FOOTBALL_KEY=... node scripts/ingest-stats.mjs [match_key ...]
//       不带参数 = 处理所有已入库阵容（已完赛）的比赛。
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"
const API_DELAY_MS = Number(KEYS.API_FOOTBALL_DELAY_MS || 1500)
let lastApiAt = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(q) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = Math.max(0, lastApiAt + API_DELAY_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastApiAt = Date.now()
    let res, j
    try {
      res = await fetch(BASE + q, { headers: { "x-apisports-key": KEY } })
      j = await res.json()
    } catch (e) {
      if (attempt < 5) { console.log(`  ⏳ 网络异常(${e.message})，3s 后重试 ${q}`); await sleep(3000); continue }
      throw new Error(`network error ${q}: ${e.message}`)
    }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
    if (!hasErr) return j
    const t = JSON.stringify(errs)
    if (t.includes("rateLimit") && attempt < 5) { console.log(`  ⏳ rate limit，65s 后重试`); await sleep(65000); continue }
    throw new Error(`API error ${q}: ${t}`)
  }
}

const pInt = (v) => (v == null ? null : parseInt(String(v).replace("%", ""), 10))
const pReal = (v) => (v == null ? null : parseFloat(String(v)))
function statMap(stats) {
  const m = {}
  for (const s of stats || []) m[s.type] = s.value
  return m
}

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(`CREATE TABLE IF NOT EXISTS match_stats (
  match_key TEXT NOT NULL, side TEXT NOT NULL, team_code TEXT NOT NULL, fixture_id INTEGER,
  possession INTEGER, total_shots INTEGER, shots_on INTEGER, shots_off INTEGER, blocked INTEGER,
  inside_box INTEGER, fouls INTEGER, corners INTEGER, offsides INTEGER, yellow INTEGER, red INTEGER,
  gk_saves INTEGER, passes INTEGER, passes_pct INTEGER, xg REAL, goals_prevented REAL,
  as_of TEXT NOT NULL, PRIMARY KEY (match_key, side)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS h2h (
  match_key TEXT NOT NULL, hist_fixture_id INTEGER NOT NULL, date TEXT NOT NULL,
  home_name TEXT NOT NULL, away_name TEXT NOT NULL, home_goals INTEGER, away_goals INTEGER,
  league TEXT, as_of TEXT NOT NULL, PRIMARY KEY (match_key, hist_fixture_id)
)`)

const upStat = db.prepare(`INSERT INTO match_stats
  (match_key, side, team_code, fixture_id, possession, total_shots, shots_on, shots_off, blocked,
   inside_box, fouls, corners, offsides, yellow, red, gk_saves, passes, passes_pct, xg, goals_prevented, as_of)
  VALUES (@match_key,@side,@team_code,@fixture_id,@possession,@total_shots,@shots_on,@shots_off,@blocked,
   @inside_box,@fouls,@corners,@offsides,@yellow,@red,@gk_saves,@passes,@passes_pct,@xg,@goals_prevented,@as_of)
  ON CONFLICT(match_key, side) DO UPDATE SET
   team_code=excluded.team_code, fixture_id=excluded.fixture_id, possession=excluded.possession,
   total_shots=excluded.total_shots, shots_on=excluded.shots_on, shots_off=excluded.shots_off,
   blocked=excluded.blocked, inside_box=excluded.inside_box, fouls=excluded.fouls, corners=excluded.corners,
   offsides=excluded.offsides, yellow=excluded.yellow, red=excluded.red, gk_saves=excluded.gk_saves,
   passes=excluded.passes, passes_pct=excluded.passes_pct, xg=excluded.xg,
   goals_prevented=excluded.goals_prevented, as_of=excluded.as_of`)
const delH2h = db.prepare("DELETE FROM h2h WHERE match_key = ?")
const insH2h = db.prepare(`INSERT OR REPLACE INTO h2h
  (match_key, hist_fixture_id, date, home_name, away_name, home_goals, away_goals, league, as_of)
  VALUES (@match_key,@hist_fixture_id,@date,@home_name,@away_name,@home_goals,@away_goals,@league,@as_of)`)

async function processMatch(matchKey, now) {
  const lus = db.prepare("SELECT side, team_code, team_name, fixture_id FROM lineups WHERE match_key = ?").all(matchKey)
  const home = lus.find((l) => l.side === "home")
  const away = lus.find((l) => l.side === "away")
  if (!home || !away) { console.log(`· ${matchKey} 阵容不全，跳过`); return }
  const fid = home.fixture_id || away.fixture_id

  // 1) 真实统计
  let homeTeamId = null, awayTeamId = null
  try {
    const st = await api(`/fixtures/statistics?fixture=${fid}`)
    for (const t of st.response || []) {
      const side = t.team?.name === home.team_name ? "home" : "away"
      if (side === "home") homeTeamId = t.team?.id
      else awayTeamId = t.team?.id
      const m = statMap(t.statistics)
      upStat.run({
        match_key: matchKey, side, team_code: side === "home" ? home.team_code : away.team_code,
        fixture_id: fid,
        possession: pInt(m["Ball Possession"]), total_shots: pInt(m["Total Shots"]),
        shots_on: pInt(m["Shots on Goal"]), shots_off: pInt(m["Shots off Goal"]),
        blocked: pInt(m["Blocked Shots"]), inside_box: pInt(m["Shots insidebox"]),
        fouls: pInt(m["Fouls"]), corners: pInt(m["Corner Kicks"]), offsides: pInt(m["Offsides"]),
        yellow: pInt(m["Yellow Cards"]), red: pInt(m["Red Cards"]), gk_saves: pInt(m["Goalkeeper Saves"]),
        passes: pInt(m["Total passes"]), passes_pct: pInt(m["Passes %"]),
        xg: pReal(m["expected_goals"]), goals_prevented: pReal(m["goals_prevented"]), as_of: now,
      })
    }
    console.log(`  ✓ ${matchKey} 统计入库（${(st.response || []).length} 队）`)
  } catch (e) { console.log(`  ⚠ ${matchKey} 统计失败: ${e.message}`) }

  // 2) 真实历史交锋（需要 team id）
  if (homeTeamId && awayTeamId) {
    try {
      const h = await api(`/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&last=10`)
      const tx = db.transaction(() => {
        delH2h.run(matchKey)
        for (const m of h.response || []) {
          insH2h.run({
            match_key: matchKey, hist_fixture_id: m.fixture.id, date: m.fixture.date.slice(0, 10),
            home_name: m.teams.home.name, away_name: m.teams.away.name,
            home_goals: m.goals.home, away_goals: m.goals.away,
            league: m.league?.name || null, as_of: now,
          })
        }
      })
      tx()
      console.log(`  ◆ ${matchKey} 历史交锋 ${(h.response || []).length} 场${(h.response || []).length ? "" : "（暂无）"}`)
    } catch (e) { console.log(`  ⚠ ${matchKey} 交锋失败: ${e.message}`) }
  }
}

async function run() {
  const now = new Date().toISOString()
  let keys = process.argv.slice(2)
  if (!keys.length) keys = db.prepare("SELECT DISTINCT match_key FROM lineups ORDER BY match_key").all().map((r) => r.match_key)
  console.log(`待处理 ${keys.length} 场\n`)
  for (const k of keys) await processMatch(k, now)
  const sc = db.prepare("SELECT COUNT(*) n FROM match_stats").get().n
  const hc = db.prepare("SELECT COUNT(*) n FROM h2h").get().n
  console.log(`\n完成：match_stats ${sc} 行，h2h ${hc} 场 → ${dbPath}`)
}
run().catch((e) => { console.error("失败:", e.message); process.exit(1) })
