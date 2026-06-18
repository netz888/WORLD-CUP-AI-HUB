// 阵容抓取脚本（零依赖于 TS，可直接 node 运行）。
// 用法：node scripts/ingest-lineups.mjs [date ...]   默认日期 2026-06-15
// 流程：/fixtures?date=YYYY-MM-DD（免费档放行）→ 本地筛 league.id==1 世界杯 →
//       /fixtures/lineups?fixture=<id> → 映射队名为本站三字码 → upsert 进 data/wc.db。
// 说明：免费档对 season=2026 的查询会被拦，但"按日期 + 按 fixtureId"不受赛季锁限制。
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"
const DATES = process.argv.slice(2).length ? process.argv.slice(2) : ["2026-06-15"]
const WC_LEAGUE_ID = 1

// API 队名 → 本站三字码。键统一用「去重音 + 小写」匹配。
const RAW = {
  Mexico: "MEX", Czechia: "CZE", "Czech Republic": "CZE", "South Africa": "RSA",
  "South Korea": "KOR", "Korea Republic": "KOR", Canada: "CAN",
  "Bosnia and Herzegovina": "BIH", "Bosnia & Herzegovina": "BIH", Qatar: "QAT", Switzerland: "SUI",
  Brazil: "BRA", Haiti: "HAI", Morocco: "MAR", Scotland: "SCO",
  USA: "USA", "United States": "USA", Australia: "AUS", Paraguay: "PAR",
  Turkiye: "TUR", Turkey: "TUR", Curacao: "CUW", Ecuador: "ECU",
  Germany: "GER", "Ivory Coast": "CIV", "Cote d'Ivoire": "CIV",
  Netherlands: "NED", Japan: "JPN", Sweden: "SWE", Tunisia: "TUN",
  Belgium: "BEL", Egypt: "EGY", Iran: "IRN", "New Zealand": "NZL",
  "Cape Verde": "CPV", "Cape Verde Islands": "CPV", "Saudi Arabia": "KSA",
  Spain: "ESP", Uruguay: "URU", France: "FRA", Norway: "NOR",
  Senegal: "SEN", Iraq: "IRQ", Algeria: "ALG", Argentina: "ARG",
  Austria: "AUT", Jordan: "JOR", Colombia: "COL", "DR Congo": "COD",
  "Congo DR": "COD", Portugal: "POR", Uzbekistan: "UZB", Croatia: "CRO",
  England: "ENG", Ghana: "GHA", Panama: "PAN",
}
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
const NAME_TO_CODE = {}
for (const [k, v] of Object.entries(RAW)) NAME_TO_CODE[norm(k)] = v
const codeOf = (name) => NAME_TO_CODE[norm(name)] ?? null

const API_DELAY_MS = Number(KEYS.API_FOOTBALL_DELAY_MS || 6500)
const API_RETRY_WAIT_MS = Number(KEYS.API_FOOTBALL_RETRY_WAIT_MS || 65000)
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
    } catch (netErr) {
      // 网络层瞬时抖动（fetch failed / ECONNRESET 等）：重试，不要让整轮运行崩掉。
      if (attempt < 5) {
        console.log(`  ⏳ 网络异常(${netErr.message})，3s 后重试 ${q} [${attempt}/5]`)
        await sleep(3000)
        continue
      }
      throw new Error(`network error on ${q}: ${netErr.message}`)
    }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
    if (!hasErr) return j

    const errText = JSON.stringify(errs)
    if (errText.includes("rateLimit") && attempt < 5) {
      console.log(`  ⏳ API-Football rate limit，等待 ${Math.round(API_RETRY_WAIT_MS / 1000)}s 后重试 ${q}`)
      await sleep(API_RETRY_WAIT_MS)
      continue
    }
    throw new Error(`API error on ${q}: ${errText}`)
  }
  throw new Error(`API error on ${q}: retry exhausted`)
}

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(`CREATE TABLE IF NOT EXISTS lineups (
  match_key TEXT NOT NULL, side TEXT NOT NULL, team_code TEXT NOT NULL,
  team_name TEXT, formation TEXT, coach TEXT,
  kind TEXT NOT NULL DEFAULT 'confirmed', source TEXT NOT NULL DEFAULT 'api-football',
  fixture_id INTEGER, start_xi TEXT NOT NULL, subs TEXT, as_of TEXT NOT NULL,
  PRIMARY KEY (match_key, side)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS events (
  fixture_id INTEGER NOT NULL, match_key TEXT NOT NULL, seq INTEGER NOT NULL,
  minute INTEGER, extra INTEGER, side TEXT NOT NULL, team_code TEXT NOT NULL,
  team_name TEXT, type TEXT NOT NULL, detail TEXT, player TEXT, assist TEXT,
  PRIMARY KEY (fixture_id, seq)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS referees (
  match_key TEXT PRIMARY KEY, fixture_id INTEGER,
  name TEXT NOT NULL, nat TEXT NOT NULL DEFAULT '',
  avg_yellow REAL NOT NULL DEFAULT 4.2, avg_red REAL NOT NULL DEFAULT 0.2,
  penalty_rate REAL NOT NULL DEFAULT 0.27, note TEXT, as_of TEXT NOT NULL
)`)
// 实时比分表：API-Football /fixtures 同时带 goals + status，顺手写入。
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
const upsertRef = db.prepare(`INSERT INTO referees
  (match_key, fixture_id, name, nat, avg_yellow, avg_red, penalty_rate, as_of)
  VALUES (@match_key, @fixture_id, @name, @nat, 4.2, 0.2, 0.27, @as_of)
  ON CONFLICT(match_key) DO UPDATE SET
    fixture_id=excluded.fixture_id, name=excluded.name, nat=excluded.nat, as_of=excluded.as_of`)
// 按 match_key 清旧事件，而不是 fixture_id：不同 API 来源的 fixture_id 可能不一致。
const delEvents = db.prepare(`DELETE FROM events WHERE match_key = ?`)
const insEvent = db.prepare(`INSERT INTO events
  (fixture_id, match_key, seq, minute, extra, side, team_code, team_name, type, detail, player, assist)
  VALUES (@fixture_id, @match_key, @seq, @minute, @extra, @side, @team_code, @team_name, @type, @detail, @player, @assist)`)
const upsert = db.prepare(`INSERT INTO lineups
  (match_key, side, team_code, team_name, formation, coach, kind, source, fixture_id, start_xi, subs, as_of)
  VALUES (@match_key, @side, @team_code, @team_name, @formation, @coach, @kind, @source, @fixture_id, @start_xi, @subs, @as_of)
  ON CONFLICT(match_key, side) DO UPDATE SET
    team_code=excluded.team_code, team_name=excluded.team_name, formation=excluded.formation,
    coach=excluded.coach, kind=excluded.kind, source=excluded.source, fixture_id=excluded.fixture_id,
    start_xi=excluded.start_xi, subs=excluded.subs, as_of=excluded.as_of`)

function statusToKind(short) {
  // API-Football 的 /fixtures/lineups 返回官方阵容；预测阵容只由 MiMo 脚本写入。
  return "confirmed"
}

// API-Football fixture.status.short → 本站 live_scores.status
function statusToLive(short) {
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT"].includes(short)) return "live"
  if (["FT", "AET", "PEN"].includes(short)) return "finished"
  return "upcoming" // NS / TBD / PST / CANC / ABD / AWD / WO 等
}

async function run() {
  const now = new Date().toISOString()
  let total = 0
  let eventTotal = 0
  for (const date of DATES) {
    const fx = await api(`/fixtures?date=${date}`)
    const wc = fx.response.filter((f) => f.league.id === WC_LEAGUE_ID)
    console.log(`\n[${date}] 世界杯场次: ${wc.length}`)
    for (const f of wc) {
      const fid = f.fixture.id
      const hc = codeOf(f.teams.home.name)
      const ac = codeOf(f.teams.away.name)
      if (!hc || !ac) {
        console.log(`  ⚠ 跳过 fixture ${fid}: 队名未映射 (${f.teams.home.name} / ${f.teams.away.name})`)
        continue
      }
      const matchKey = `${hc}-${ac}`
      const statusShort = f.fixture.status?.short || "NS"
      upsertScore.run({
        match_key: matchKey,
        fixture_id: fid,
        home_code: hc,
        away_code: ac,
        home_score: f.goals?.home ?? null,
        away_score: f.goals?.away ?? null,
        status: statusToLive(statusShort),
        status_desc: f.fixture.status?.long || statusShort,
        kickoff_ms: f.fixture.timestamp ? f.fixture.timestamp * 1000 : Date.parse(f.fixture.date),
        as_of: now,
      })
      console.log(`  ↻ ${matchKey} 比分/状态 ${f.goals?.home ?? "-"}-${f.goals?.away ?? "-"} ${statusShort}`)

      // 裁判：API 返回 "Name, Country" 格式字符串。裁判可能早于阵容公布，必须在阵容判断前写库。
      const refStr = f.fixture.referee || ""
      if (refStr) {
        const commaIdx = refStr.lastIndexOf(", ")
        const refName = commaIdx >= 0 ? refStr.slice(0, commaIdx).trim() : refStr.trim()
        const refNat = commaIdx >= 0 ? refStr.slice(commaIdx + 2).trim() : ""
        upsertRef.run({ match_key: matchKey, fixture_id: fid, name: refName, nat: refNat, as_of: now })
        console.log(`  裁判 ${matchKey}: ${refName} (${refNat})`)
      }

      const lu = await api(`/fixtures/lineups?fixture=${fid}`)
      if (!lu.response.length) {
        console.log(`  · ${matchKey} 暂无阵容数据`)
        continue
      }
      const kind = statusToKind(statusShort)
      for (const t of lu.response) {
        const side = codeOf(t.team.name) === hc ? "home" : "away"
        const startXi = (t.startXI || []).map((x) => ({
          number: x.player.number, name: x.player.name, pos: x.player.pos, grid: x.player.grid,
        }))
        const subs = (t.substitutes || []).map((x) => ({
          number: x.player.number, name: x.player.name, pos: x.player.pos,
        }))
        upsert.run({
          match_key: matchKey, side, team_code: side === "home" ? hc : ac,
          team_name: t.team.name, formation: t.formation || null,
          coach: (t.coach && t.coach.name) || null, kind, source: "api-football",
          fixture_id: fid, start_xi: JSON.stringify(startXi),
          subs: JSON.stringify(subs), as_of: now,
        })
        total++
        console.log(`  ✓ ${matchKey} ${side} ${t.team.name} (${t.formation || "?"}) XI=${startXi.length} 主帅=${(t.coach && t.coach.name) || "?"}`)
      }
      // 事件（进球/红黄牌/换人/VAR）：先清该场旧事件再整批写入
      try {
        const ev = await api(`/fixtures/events?fixture=${fid}`)
        delEvents.run(matchKey)
        let seq = 0
        for (const e of ev.response) {
          const evCode = codeOf(e.team.name)
          insEvent.run({
            fixture_id: fid, match_key: matchKey, seq: seq++,
            minute: e.time?.elapsed ?? null, extra: e.time?.extra ?? null,
            side: evCode === hc ? "home" : "away",
            team_code: evCode === hc ? hc : ac, team_name: e.team.name,
            type: e.type, detail: e.detail || null,
            player: (e.player && e.player.name) || null,
            assist: (e.assist && e.assist.name) || null,
          })
        }
        eventTotal += ev.response.length
        console.log(`  ◆ ${matchKey} 事件 ${ev.response.length} 条`)
      } catch (err) {
        console.log(`  ⚠ ${matchKey} 事件抓取失败: ${err.message}`)
      }
    }
  }
  const cnt = db.prepare("SELECT COUNT(*) n FROM lineups").get().n
  const ecnt = db.prepare("SELECT COUNT(*) n FROM events").get().n
  const scnt = db.prepare("SELECT COUNT(*) n FROM live_scores").get().n
  console.log(`\n完成：阵容写入/更新 ${total} 行（库内 ${cnt}），事件写入 ${eventTotal} 条（库内 ${ecnt}），比分状态 ${scnt} 场 → ${dbPath}`)
}

run().catch((e) => { console.error("失败:", e.message); process.exit(1) })
