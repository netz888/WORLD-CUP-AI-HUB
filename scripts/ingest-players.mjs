// 球员重要度入库（Phase: 球员级分析）。
// 流程：每队 /players?season=2026 → 算每名球员"重要度"(分钟×评分 + 进球/助攻加权) → 队内归一化 →
//        写 players 表。重要度用于：判断核心球员是否首发/伤停 → 缺阵惩罚喂进预测。
// 用法：API_FOOTBALL_KEY=... node scripts/ingest-players.mjs [team_code ...]   不带参=全部参赛队
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"
const DELAY = Number(KEYS.API_FOOTBALL_DELAY_MS || 1500)
let lastAt = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(q) {
  for (let i = 1; i <= 5; i++) {
    const wait = Math.max(0, lastAt + DELAY - Date.now())
    if (wait > 0) await sleep(wait)
    lastAt = Date.now()
    let res, j
    try { res = await fetch(BASE + q, { headers: { "x-apisports-key": KEY } }); j = await res.json() }
    catch (e) { if (i < 5) { console.log(`  ⏳ 网络重试 ${q}`); await sleep(3000); continue } throw e }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
    if (!hasErr) return j
    const t = JSON.stringify(errs)
    if (t.includes("rateLimit") && i < 5) { await sleep(65000); continue }
    throw new Error(`API error ${q}: ${t}`)
  }
}

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(`CREATE TABLE IF NOT EXISTS players (
  team_code TEXT NOT NULL, player_id INTEGER NOT NULL, name TEXT NOT NULL,
  pos TEXT, apps INTEGER, lineups INTEGER, minutes INTEGER,
  rating REAL, goals INTEGER, assists INTEGER,
  importance REAL,        -- 原始重要度
  importance_norm REAL,   -- 队内归一化 (0~1, 队内最高=1)
  is_core INTEGER NOT NULL DEFAULT 0,  -- 是否核心(队内重要度 top)
  as_of TEXT NOT NULL, PRIMARY KEY (team_code, player_id)
)`)
const delTeam = db.prepare("DELETE FROM players WHERE team_code = ?")
const insP = db.prepare(`INSERT INTO players
  (team_code,player_id,name,pos,apps,lineups,minutes,rating,goals,assists,importance,importance_norm,is_core,as_of)
  VALUES (@team_code,@player_id,@name,@pos,@apps,@lineups,@minutes,@rating,@goals,@assists,@importance,@importance_norm,@is_core,@as_of)`)

// 球队三字码 → API-Football team id（从已入库 lineups 的 fixture 反查太绕，直接用 /teams 搜索一次性建表）。
// 这里用 lineups 表里出现过的队名 + /fixtures 已知 id 的方式：改为按队名搜 /teams。
const CODE_NAME = {
  MEX: "Mexico", RSA: "South Africa", KOR: "South Korea", CZE: "Czech Republic", CAN: "Canada",
  BIH: "Bosnia and Herzegovina", USA: "USA", PAR: "Paraguay", QAT: "Qatar", SUI: "Switzerland",
  BRA: "Brazil", MAR: "Morocco", HAI: "Haiti", SCO: "Scotland", AUS: "Australia", TUR: "Turkey",
  GER: "Germany", CUW: "Curacao", NED: "Netherlands", JPN: "Japan", CIV: "Ivory Coast",
  ECU: "Ecuador", SWE: "Sweden", TUN: "Tunisia", ESP: "Spain", CPV: "Cape Verde Islands",
  BEL: "Belgium", EGY: "Egypt", KSA: "Saudi Arabia", URU: "Uruguay", IRN: "Iran",
  NZL: "New Zealand", FRA: "France", SEN: "Senegal", IRQ: "Iraq", NOR: "Norway",
  ARG: "Argentina", ALG: "Algeria", AUT: "Austria", JOR: "Jordan", POR: "Portugal",
  COD: "Congo DR", ENG: "England", CRO: "Croatia", GHA: "Ghana", PAN: "Panama",
  UZB: "Uzbekistan", COL: "Colombia",
}

// 缓存 team id（避免重复搜）。优先用 lineups 里若存过 id；否则 /teams?name= 搜。
async function teamId(code) {
  const name = CODE_NAME[code]
  if (!name) return null
  const j = await api(`/teams?search=${encodeURIComponent(name)}`)
  // 取国家队：type 通常无，按 name 完全/包含匹配，national=true 优先
  const cand = (j.response || []).filter((t) => t.team?.national)
  const exact = cand.find((t) => t.team.name.toLowerCase() === name.toLowerCase()) || cand[0] || (j.response || [])[0]
  return exact?.team?.id || null
}

// 重要度：分钟数开方(信任度，边际递减) × 评分 + 进球×8 + 助攻×5。评分缺省给 6.0。
function importance(s) {
  const mins = s.games?.minutes || 0
  const rating = parseFloat(s.games?.rating) || 6.0
  const goals = s.goals?.total || 0
  const assists = s.goals?.assists || 0
  return +(Math.sqrt(mins) * (rating - 5) + goals * 8 + assists * 5).toFixed(2)
}

async function processTeam(code, now) {
  const tid = await teamId(code)
  if (!tid) { console.log(`✗ ${code} 未找到 team id`); return false }
  let all = []
  let total = 1
  for (let pg = 1; pg <= total && pg <= 4; pg++) {
    const j = await api(`/players?team=${tid}&season=2026&page=${pg}`)
    all = all.concat(j.response || [])
    total = j.paging?.total || 1
  }
  if (!all.length) { console.log(`✗ ${code} (id ${tid}) 无球员数据`); return false }

  const rows = all.map((p) => {
    const s = p.statistics?.[0] || {}
    return {
      player_id: p.player.id, name: p.player.name, pos: s.games?.position || null,
      apps: s.games?.appearences || 0, lineups: s.games?.lineups || 0, minutes: s.games?.minutes || 0,
      rating: parseFloat(s.games?.rating) || null, goals: s.goals?.total || 0, assists: s.goals?.assists || 0,
      importance: importance(s),
    }
  })
  const maxImp = Math.max(...rows.map((r) => r.importance), 1)
  // 核心：归一化重要度 >= 0.55 且有出场，最多 8 人
  rows.sort((a, b) => b.importance - a.importance)
  let coreCount = 0
  for (const r of rows) {
    r.importance_norm = +(r.importance / maxImp).toFixed(3)
    r.is_core = r.importance_norm >= 0.55 && r.minutes > 0 && coreCount < 8 ? 1 : 0
    if (r.is_core) coreCount++
  }

  const tx = db.transaction(() => {
    delTeam.run(code)
    for (const r of rows) insP.run({ team_code: code, as_of: now, ...r })
  })
  tx()
  const cores = rows.filter((r) => r.is_core).map((r) => r.name).join(", ")
  console.log(`✓ ${code} (id ${tid}) ${rows.length} 人，核心 ${coreCount}：${cores}`)
  return true
}

async function run() {
  const now = new Date().toISOString()
  let codes = process.argv.slice(2)
  if (!codes.length) {
    // 默认：live_scores 里出现的所有队
    const set = new Set()
    for (const r of db.prepare("SELECT home_code, away_code FROM live_scores").all()) {
      if (r.home_code) set.add(r.home_code)
      if (r.away_code) set.add(r.away_code)
    }
    codes = [...set].sort()
  }
  console.log(`待处理 ${codes.length} 队\n`)
  let ok = 0
  for (const c of codes) { try { if (await processTeam(c, now)) ok++ } catch (e) { console.log(`✗ ${c} 失败: ${e.message}`) } }
  const cnt = db.prepare("SELECT COUNT(*) n FROM players").get().n
  const coreCnt = db.prepare("SELECT COUNT(*) n FROM players WHERE is_core = 1").get().n
  console.log(`\n完成：${ok}/${codes.length} 队；players 库内 ${cnt} 人，核心 ${coreCnt} 人 → ${dbPath}`)
}

run().catch((e) => { console.error("失败:", e.message); process.exit(1) })
