// Polymarket 单场胜平负盘口入库（Phase: 市场信号）。
// 流程：按两队队名搜 Polymarket 事件("X vs. Y") → 取 3 个 win/draw 市场 + clobTokenIds →
//        CLOB prices-history 取【开赛前】快照价(已完赛=赛前1h；未开赛=最新) → 去水归一 → 存 market_odds。
// 用法：node scripts/ingest-market.mjs [match_key ...]   不带参=处理 live_scores 全部场次
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GAMMA = "https://gamma-api.polymarket.com"
const CLOB = "https://clob.polymarket.com"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DELAY = Number(process.env.PM_DELAY_MS || 400)

// 本站三字码 → Polymarket 英文队名（用于搜索/匹配）
const CODE_NAME = {
  MEX: "Mexico", RSA: "South Africa", KOR: "South Korea", CZE: "Czechia", CAN: "Canada",
  BIH: "Bosnia and Herzegovina", USA: "United States", PAR: "Paraguay", QAT: "Qatar",
  SUI: "Switzerland", BRA: "Brazil", MAR: "Morocco", HAI: "Haiti", SCO: "Scotland",
  AUS: "Australia", TUR: "Türkiye", GER: "Germany", CUW: "Curaçao", NED: "Netherlands",
  JPN: "Japan", CIV: "Ivory Coast", ECU: "Ecuador", SWE: "Sweden", TUN: "Tunisia",
  ESP: "Spain", CPV: "Cape Verde", BEL: "Belgium", EGY: "Egypt", KSA: "Saudi Arabia",
  URU: "Uruguay", IRN: "Iran", NZL: "New Zealand", FRA: "France", SEN: "Senegal",
  IRQ: "Iraq", NOR: "Norway", ARG: "Argentina", ALG: "Algeria", AUT: "Austria",
  JOR: "Jordan", POR: "Portugal", COD: "DR Congo", ENG: "England", CRO: "Croatia",
  GHA: "Ghana", PAN: "Panama", UZB: "Uzbekistan", COL: "Colombia",
}
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim()

async function jget(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url)
      return await r.json()
    } catch (e) {
      if (i < 3) { await sleep(1500); continue }
      throw e
    }
  }
}

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(`CREATE TABLE IF NOT EXISTS market_odds (
  match_key TEXT PRIMARY KEY, event_slug TEXT,
  home_p REAL, draw_p REAL, away_p REAL,            -- 去水归一后的胜平负概率
  raw_home REAL, raw_draw REAL, raw_away REAL,      -- 原始 Yes 价
  snapshot_ts INTEGER,                              -- 取价时间(秒) = 开赛前
  pre_match INTEGER NOT NULL DEFAULT 1,             -- 1=赛前快照 0=最新
  volume REAL, as_of TEXT NOT NULL
)`)
const upOdds = db.prepare(`INSERT INTO market_odds
  (match_key,event_slug,home_p,draw_p,away_p,raw_home,raw_draw,raw_away,snapshot_ts,pre_match,volume,as_of)
  VALUES (@match_key,@event_slug,@home_p,@draw_p,@away_p,@raw_home,@raw_draw,@raw_away,@snapshot_ts,@pre_match,@volume,@as_of)
  ON CONFLICT(match_key) DO UPDATE SET event_slug=excluded.event_slug,home_p=excluded.home_p,draw_p=excluded.draw_p,
   away_p=excluded.away_p,raw_home=excluded.raw_home,raw_draw=excluded.raw_draw,raw_away=excluded.raw_away,
   snapshot_ts=excluded.snapshot_ts,pre_match=excluded.pre_match,volume=excluded.volume,as_of=excluded.as_of`)

// 在 prices-history 里取 <= ts 的最后一个价（赛前快照）；ts 为空取最新
async function priceAt(tokenId, ts) {
  const j = await jget(`${CLOB}/prices-history?market=${tokenId}&interval=max&fidelity=60`)
  const h = j.history || []
  if (!h.length) return null
  if (!ts) return h[h.length - 1].p
  let chosen = null
  for (const p of h) { if (p.t <= ts) chosen = p.p; else break }
  return chosen ?? h[0].p // 若全在 ts 之后，退而取最早
}

async function processMatch(matchKey, now) {
  const ls = db.prepare("SELECT home_code,away_code,kickoff_ms,status FROM live_scores WHERE match_key = ?").get(matchKey)
  if (!ls) { console.log(`· ${matchKey} 不在 live_scores`); return false }
  const hn = CODE_NAME[ls.home_code], an = CODE_NAME[ls.away_code]
  if (!hn || !an) { console.log(`· ${matchKey} 队名未映射 (${ls.home_code}/${ls.away_code})`); return false }

  // 搜索事件（含已结束）
  const sr = await jget(`${GAMMA}/public-search?q=${encodeURIComponent(hn + " " + an)}&limit_per_type=10&events_status=all`)
  const nh = norm(hn), na = norm(an)
  const ev = (sr.events || []).find((e) => {
    const t = norm(e.title)
    return /vs/.test(t) && t.includes(nh) && t.includes(na)
  })
  if (!ev) { console.log(`  ✗ ${matchKey} 未找到盘口 (${hn} vs ${an})`); return false }

  await sleep(DELAY)
  const full = await jget(`${GAMMA}/events?slug=${ev.slug}`)
  const e = Array.isArray(full) ? full[0] : full
  if (!e || !e.markets) { console.log(`  ✗ ${matchKey} 事件无 markets`); return false }

  // 识别三个市场
  let rawH = null, rawD = null, rawA = null
  for (const m of e.markets) {
    const q = norm(m.question)
    let yes = null
    try { yes = JSON.parse(m.outcomePrices || "[]")[0] } catch {}
    let tok = null
    try { tok = JSON.parse(m.clobTokenIds || "[]")[0] } catch {}
    // 赛前快照：用 prices-history 取 kickoff 前的价；未开赛则用最新
    const ts = ls.status === "finished" && ls.kickoff_ms ? Math.floor(ls.kickoff_ms / 1000) : null
    let price = yes != null ? Number(yes) : null
    if (tok) { await sleep(DELAY); const p = await priceAt(tok, ts); if (p != null) price = Number(p) }
    if (/draw/.test(q)) rawD = price
    else if (q.includes(nh) && /win/.test(q)) rawH = price
    else if (q.includes(na) && /win/.test(q)) rawA = price
  }
  if (rawH == null || rawD == null || rawA == null) { console.log(`  ✗ ${matchKey} 三市场不全 (H${rawH}/D${rawD}/A${rawA})`); return false }

  const sum = rawH + rawD + rawA
  upOdds.run({
    match_key: matchKey, event_slug: e.slug,
    home_p: +(rawH / sum).toFixed(4), draw_p: +(rawD / sum).toFixed(4), away_p: +(rawA / sum).toFixed(4),
    raw_home: rawH, raw_draw: rawD, raw_away: rawA,
    snapshot_ts: ls.status === "finished" && ls.kickoff_ms ? Math.floor(ls.kickoff_ms / 1000) : null,
    pre_match: ls.status === "finished" ? 1 : 0, volume: e.volume || null, as_of: now,
  })
  const pct = (x) => Math.round((x / sum) * 100)
  console.log(`  ✓ ${matchKey} [${e.slug}] 主${pct(rawH)}/平${pct(rawD)}/客${pct(rawA)} (vol $${Math.round(e.volume || 0)}, ${ls.status === "finished" ? "赛前快照" : "最新"})`)
  return true
}

async function run() {
  const now = new Date().toISOString()
  let keys = process.argv.slice(2)
  if (!keys.length) keys = db.prepare("SELECT match_key FROM live_scores ORDER BY kickoff_ms").all().map((r) => r.match_key)
  console.log(`待处理 ${keys.length} 场\n`)
  let ok = 0
  for (const k of keys) { try { if (await processMatch(k, now)) ok++ } catch (e) { console.log(`  ⚠ ${k} 异常: ${e.message}`) } await sleep(DELAY) }
  console.log(`\n完成：${ok}/${keys.length} 场有盘口 → market_odds`)
}
run().catch((e) => { console.error("失败:", e.message); process.exit(1) })
