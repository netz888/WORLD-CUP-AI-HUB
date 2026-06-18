// MiMo 赛前关键因素 ingestion
// 只处理赛前事实：伤停、停赛、发布会、天气、赔率走势、近期状态、预测阵容消息
// 输出严格 JSON: { injuries: [], factors: [], sources: [] }

import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const MIMO_KEY = await requireKey("MIMO_API_KEY")
const API_FOOTBALL_KEY = await requireKey("API_FOOTBALL_KEY")
const MIMO_BASE = KEYS.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1"
const MIMO_MODEL = KEYS.MIMO_MODEL || "mimo-v2.5-pro"
const USE_WEB_SEARCH = String(KEYS.MIMO_WEB_SEARCH || "true").toLowerCase() !== "false"
const API_BASE = "https://v3.football.api-sports.io"
const API_DELAY_MS = Number(KEYS.API_FOOTBALL_DELAY_MS || 1500)
const SEARCH_DELAY_MS = Number(KEYS.MIMO_SEARCH_DELAY_MS || 800)

const args = process.argv.slice(2)
const DRY_RUN = args.includes("--dry-run")
const limitIdx = args.indexOf("--limit")
const LIMIT = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1] || "1")) : null
const MATCH_KEYS = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === "--dry-run") continue
  if (a === "--limit") {
    i++
    continue
  }
  if (a.startsWith("--")) continue
  MATCH_KEYS.push(a)
}

const TEAM_ZH = {
  Germany: "德国",
  Brazil: "巴西",
  Morocco: "摩洛哥",
  Mexico: "墨西哥",
  "South Africa": "南非",
  "South Korea": "韩国",
  Czechia: "捷克",
  Canada: "加拿大",
  "Bosnia & Herzegovina": "波黑",
  USA: "美国",
  Paraguay: "巴拉圭",
  Qatar: "卡塔尔",
  Switzerland: "瑞士",
  Haiti: "海地",
  Scotland: "苏格兰",
  Australia: "澳大利亚",
  Turkiye: "土耳其",
  Turkey: "土耳其",
  Netherlands: "荷兰",
  Japan: "日本",
  "Ivory Coast": "科特迪瓦",
  Ecuador: "厄瓜多尔",
  Sweden: "瑞典",
  Tunisia: "突尼斯",
  Belgium: "比利时",
  Egypt: "埃及",
  "Saudi Arabia": "沙特",
  Uruguay: "乌拉圭",
  Iran: "伊朗",
  "New Zealand": "新西兰",
  Spain: "西班牙",
  "Cape Verde Islands": "佛得角",
  "Cape Verde": "佛得角",
  France: "法国",
  Norway: "挪威",
  Senegal: "塞内加尔",
  Iraq: "伊拉克",
  Algeria: "阿尔及利亚",
  Argentina: "阿根廷",
  Austria: "奥地利",
  Jordan: "约旦",
  Colombia: "哥伦比亚",
  Portugal: "葡萄牙",
  Croatia: "克罗地亚",
  England: "英格兰",
  Ghana: "加纳",
  Panama: "巴拿马",
  Curacao: "库拉索",
  "Curaçao": "库拉索",
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastApiAt = 0
let lastSearchAt = 0

const SEARCH_TOPICS = [
  {
    name: "injury-lineup",
    kinds: "injury/suspension/lineup",
    question: "injuries, suspensions, doubtful players, expected XI and lineup stability",
  },
  {
    name: "press-form",
    kinds: "press/form",
    question: "press conference clues, squad mood, recent form news and tactical hints",
  },
  {
    name: "weather-odds",
    kinds: "weather/odds",
    question: "matchday weather, venue conditions, betting odds movement and market signals",
  },
]

function teamZh(name) {
  return TEAM_ZH[name] || name || "未知"
}

function trimText(value, max = 220) {
  const s = String(value || "").replace(/\s+/g, " ").trim()
  return s.length > max ? s.slice(0, max) : s
}

function hasUnsafeClaim(value) {
  const text = String(value || "")
  return /rape|sexual assault|criminal|charges?|accused|allegations?/i.test(text)
    || /强奸|性侵|刑事|犯罪|指控|逮捕|拒绝入境/.test(text)
}

function parseJsonObject(text) {
  let t = String(text || "").trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf("{")
  const end = t.lastIndexOf("}")
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

function normalizeSide(side) {
  const s = String(side || "").toLowerCase()
  return s === "away" ? "away" : "home"
}

function normalizeSources(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((s) => ({
      url: trimText(s?.url || s?.sourceUrl || s?.link || "", 500),
      title: trimText(s?.title || "", 180),
      kind: ["injury", "suspension", "press", "weather", "odds", "form", "lineup"].includes(s?.kind) ? s.kind : "form",
      note: trimText(s?.note || s?.summary || "", 180),
    }))
    .filter((s) => s.url)
}

function mergeSources(groups) {
  const byUrl = new Map()
  for (const group of groups) {
    for (const source of normalizeSources(group?.sources)) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source)
    }
  }
  return Array.from(byUrl.values()).slice(0, 12)
}

function factorFromSources(match, sources) {
  const has = (kinds) => sources.some((s) => kinds.includes(s.kind))
  const factors = []
  if (has(["injury", "suspension", "lineup"])) {
    factors.push({
      label: "伤停与停赛",
      home: `${match.home_name} 赛前伤停/阵容消息需按来源跟进。`,
      away: `${match.away_name} 赛前伤停/阵容消息需按来源跟进。`,
      edge: "even",
    })
  }
  if (has(["press", "form"])) {
    factors.push({
      label: "近期状态",
      home: `${match.home_name} 有赛前状态或发布会消息可参考。`,
      away: `${match.away_name} 有赛前状态或发布会消息可参考。`,
      edge: "even",
    })
  }
  if (has(["weather"])) {
    factors.push({
      label: "天气与场地",
      home: "比赛天气和场地条件需要纳入赛前判断。",
      away: "比赛天气和场地条件需要纳入赛前判断。",
      edge: "even",
    })
  }
  if (has(["odds"])) {
    factors.push({
      label: "赔率走势",
      home: "盘口或赔率走势存在赛前市场信号。",
      away: "盘口或赔率走势存在赛前市场信号。",
      edge: "even",
    })
  }
  return factors.slice(0, 5)
}

function supplementFactors(match, factors, sources) {
  const result = [...factors]
  const labels = new Set(result.map((f) => f.label))
  for (const factor of factorFromSources(match, sources)) {
    if (!labels.has(factor.label)) {
      result.push(factor)
      labels.add(factor.label)
    }
  }
  return result.slice(0, 5)
}

function normalizeOutput(parsed) {
  const sources = normalizeSources(parsed?.sources)
  const sourceSet = new Set(sources.map((s) => s.url))
  const injuries = (Array.isArray(parsed?.injuries) ? parsed.injuries : [])
    .map((inj) => ({
      side: normalizeSide(inj?.side),
      player: trimText(inj?.player || "", 80),
      status: ["缺阵", "停赛", "存疑", "恢复中"].includes(inj?.status) ? inj.status : "缺阵",
      note: trimText(inj?.note || "", 220),
      sourceUrl: trimText(inj?.sourceUrl || "", 500),
    }))
    .filter((inj) => inj.player && inj.sourceUrl && sourceSet.has(inj.sourceUrl))
    .filter((inj) => !hasUnsafeClaim(`${inj.player} ${inj.status} ${inj.note}`))

  const factors = (Array.isArray(parsed?.factors) ? parsed.factors : [])
    .map((f) => ({
      label: trimText(f?.label || "", 30),
      home: trimText(f?.home || "", 220),
      away: trimText(f?.away || "", 220),
      edge: ["home", "away", "even"].includes(f?.edge) ? f.edge : "even",
    }))
    .filter((f) => f.label && (f.home || f.away))
    .filter((f) => !hasUnsafeClaim(`${f.label} ${f.home} ${f.away}`))
    .slice(0, 6)

  return { injuries, factors, sources }
}

async function apiFootball(q) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = Math.max(0, lastApiAt + API_DELAY_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastApiAt = Date.now()
    try {
      const res = await fetch(API_BASE + q, { headers: { "x-apisports-key": API_FOOTBALL_KEY } })
      const j = await res.json()
      const errs = j.errors
      const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
      if (!hasErr) return j
      const t = JSON.stringify(errs)
      if (t.includes("rateLimit") && attempt < 5) {
        await sleep(65000)
        continue
      }
      throw new Error(`API error ${q}: ${t}`)
    } catch (e) {
      if (attempt < 5) {
        await sleep(3000)
        continue
      }
      throw e
    }
  }
}

async function mimoChat(messages, useSearch = false) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = Math.max(0, lastSearchAt + SEARCH_DELAY_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastSearchAt = Date.now()
    try {
      const body = {
        model: MIMO_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 4096,
      }
      if (USE_WEB_SEARCH && useSearch) body.tools = [{ type: "web_search" }]
      const res = await fetch(`${MIMO_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MIMO_KEY}`,
        },
        body: JSON.stringify(body),
      })
      const j = await res.json()
      if (j.error) throw new Error(JSON.stringify(j.error))
      const content = j.choices?.[0]?.message?.content
      if (!content) throw new Error(`empty response: ${JSON.stringify(j).slice(0, 240)}`)
      return { content, raw: j }
    } catch (e) {
      if (attempt < 4) {
        await sleep(4000)
        continue
      }
      throw e
    }
  }
}

async function parseOrRepairJson(content) {
  try {
    return parseJsonObject(content)
  } catch (firstError) {
    const repairRes = await mimoChat(
      [
        { role: "system", content: "Fix invalid JSON. Output valid JSON only. Do not add facts." },
        { role: "user", content: String(content || "").slice(0, 6000) },
      ],
      false,
    )
    try {
      return parseJsonObject(repairRes.content)
    } catch {
      throw firstError
    }
  }
}

function buildSearchPrompt(home, away, kickoff, venueCity, topic) {
  const date = kickoff ? new Date(kickoff).toISOString().slice(0, 10) : ""
  return [
    `Match: ${home.team_name} vs ${away.team_name}. Date: ${date || "unknown"}. City: ${venueCity || "unknown"}.`,
    `Topic: ${topic.name}. Find only: ${topic.question}.`,
    "Return compact JSON only: {\"sources\":[{\"url\":\"\",\"title\":\"\",\"kind\":\"injury|suspension|press|weather|odds|form|lineup\",\"note\":\"\"}]}",
    `Max 4 sources. Allowed kind: ${topic.kinds}. Keep each note under 25 words. No post-match stats.`,
  ].join("\n")
}

function buildFinalPrompt(home, away, kickoff, venueCity, searchText) {
  const date = kickoff ? new Date(kickoff).toISOString().slice(0, 10) : ""
  return [
    "Output valid JSON only.",
    `Match: ${home.team_name} vs ${away.team_name}. Chinese: ${teamZh(home.team_name)} vs ${teamZh(away.team_name)}.`,
    `Kickoff: ${kickoff || "unknown"}. City: ${venueCity || "unknown"}. Date: ${date || "unknown"}.`,
    "Use only sourced pre-match facts. If not sourced, leave arrays empty.",
    `{
  "injuries": [
    { "side": "home", "player": "string", "status": "缺阵", "note": "string", "sourceUrl": "https://..." }
  ],
  "factors": [
    { "label": "伤停与停赛", "home": "string", "away": "string", "edge": "home" }
  ],
  "sources": [
    { "url": "https://...", "title": "string", "kind": "injury" }
  ]
}`,
    "If sources cover at least 3 categories, output at least 3 factors. Otherwise output all supported factors. Max factors 5. Max injuries 6.",
    "Factor labels only: 伤停与停赛、发布会信号、天气与场地、赔率走势、近期状态、预测阵容稳定性.",
    "Search JSON:",
    searchText || "无",
  ].join("\n")
}

function openDb() {
  const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.exec(`CREATE TABLE IF NOT EXISTS match_factors (
    match_key TEXT NOT NULL, seq INTEGER NOT NULL,
    label TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL, edge TEXT NOT NULL,
    as_of TEXT NOT NULL, PRIMARY KEY (match_key, seq)
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS injuries (
    match_key TEXT NOT NULL, seq INTEGER NOT NULL,
    side TEXT NOT NULL, team_code TEXT NOT NULL,
    player TEXT NOT NULL, pos TEXT, status TEXT NOT NULL, note TEXT,
    as_of TEXT NOT NULL, PRIMARY KEY (match_key, seq)
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS factors_meta (
    match_key TEXT PRIMARY KEY, injuries_checked INTEGER NOT NULL DEFAULT 0, as_of TEXT NOT NULL
  )`)
  return { db, dbPath }
}

function loadMatches(db, keys, limit) {
  if (keys.length) {
    const sql = `
      SELECT l.match_key,
             MIN(l.fixture_id) AS fixture_id,
             MAX(CASE WHEN l.side = 'home' THEN l.team_name END) AS home_name,
             MAX(CASE WHEN l.side = 'away' THEN l.team_name END) AS away_name,
             MAX(CASE WHEN l.side = 'home' THEN l.team_code END) AS home_code,
             MAX(CASE WHEN l.side = 'away' THEN l.team_code END) AS away_code
      FROM lineups l
      WHERE l.match_key IN (${keys.map(() => "?").join(",")})
      GROUP BY l.match_key
      ORDER BY l.match_key
    `
    return db.prepare(sql).all(...keys)
  }

  const sql = `
    SELECT l.match_key,
           MIN(l.fixture_id) AS fixture_id,
           MAX(CASE WHEN l.side = 'home' THEN l.team_name END) AS home_name,
           MAX(CASE WHEN l.side = 'away' THEN l.team_name END) AS away_name,
           MAX(CASE WHEN l.side = 'home' THEN l.team_code END) AS home_code,
           MAX(CASE WHEN l.side = 'away' THEN l.team_code END) AS away_code
    FROM lineups l
    GROUP BY l.match_key
    ORDER BY l.match_key
    ${limit ? "LIMIT ?" : ""}
  `
  return limit ? db.prepare(sql).all(limit) : db.prepare(sql).all()
}

async function fetchFixtureContext(fixtureId) {
  if (!fixtureId) return { venueCity: "" }
  try {
    const fx = await apiFootball(`/fixtures?id=${fixtureId}`)
    const f = fx.response?.[0]
    return {
      venueCity: f?.fixture?.venue?.city || "",
    }
  } catch {
    return { venueCity: "" }
  }
}

async function buildPayload(db, match) {
  const kickoffRow = db.prepare("SELECT kickoff_ms FROM live_scores WHERE match_key = ?").get(match.match_key)
  const kickoff = kickoffRow?.kickoff_ms ? new Date(Number(kickoffRow.kickoff_ms)).toISOString() : ""
  const { venueCity } = await fetchFixtureContext(Number(match.fixture_id || 0))
  const searchTexts = []
  for (const topic of SEARCH_TOPICS) {
    const searchPrompt = buildSearchPrompt(match.home_name, match.away_name, kickoff, venueCity, topic)
    const searchRes = await mimoChat(
      [
        { role: "system", content: "Return compact sourced pre-match facts as JSON only. Do not invent." },
        { role: "user", content: searchPrompt },
      ],
      true,
    )
    try {
      searchTexts.push({ topic: topic.name, ...parseJsonObject(searchRes.content) })
    } catch {
      searchTexts.push({ topic: topic.name, sources: [] })
    }
  }
  const mergedSources = mergeSources(searchTexts)
  const searchText = JSON.stringify({ sources: mergedSources })
  let parsed
  try {
    const finalPrompt = buildFinalPrompt(
      { team_name: match.home_name },
      { team_name: match.away_name },
      kickoff,
      venueCity,
      searchText,
    )
    const finalRes = await mimoChat(
      [
        { role: "system", content: "你是严格 JSON 生成器。只输出 JSON。不要 markdown，不要解释。" },
        { role: "user", content: finalPrompt },
      ],
      false,
    )
    parsed = normalizeOutput(await parseOrRepairJson(finalRes.content))
  } catch {
    parsed = {
      injuries: [],
      factors: factorFromSources(match, mergedSources),
      sources: mergedSources,
    }
  }
  if (!parsed.sources.length) {
    parsed.sources = mergedSources
  }
  if (parsed.sources.length) {
    parsed.factors = supplementFactors(match, parsed.factors, parsed.sources)
  }
  return parsed
}

function writePayload(db, match, payload, now) {
  const delFactors = db.prepare("DELETE FROM match_factors WHERE match_key = ?")
  const delInj = db.prepare("DELETE FROM injuries WHERE match_key = ?")
  const upMeta = db.prepare(`INSERT INTO factors_meta (match_key, injuries_checked, as_of)
    VALUES (@match_key, 1, @as_of)
    ON CONFLICT(match_key) DO UPDATE SET injuries_checked=1, as_of=excluded.as_of`)
  const insFactor = db.prepare(`INSERT INTO match_factors (match_key, seq, label, home, away, edge, as_of)
    VALUES (@match_key, @seq, @label, @home, @away, @edge, @as_of)`)
  const insInj = db.prepare(`INSERT INTO injuries (match_key, seq, side, team_code, player, pos, status, note, as_of)
    VALUES (@match_key, @seq, @side, @team_code, @player, @pos, @status, @note, @as_of)`)

  const tx = db.transaction(() => {
    delFactors.run(match.match_key)
    payload.factors.forEach((f, seq) => {
      insFactor.run({
        match_key: match.match_key,
        seq,
        label: trimText(f.label, 20),
        home: trimText(f.home, 30),
        away: trimText(f.away, 30),
        edge: ["home", "away", "even"].includes(f.edge) ? f.edge : "even",
        as_of: now,
      })
    })

    delInj.run(match.match_key)
    payload.injuries.forEach((inj, seq) => {
      insInj.run({
        match_key: match.match_key,
        seq,
        side: inj.side,
        team_code: inj.side === "away" ? match.away_code || "" : match.home_code || "",
        player: trimText(inj.player, 80),
        pos: "",
        status: trimText(inj.status, 16),
        note: trimText(inj.note, 120),
        as_of: now,
      })
    })

    upMeta.run({ match_key: match.match_key, as_of: now })
  })
  tx()
}

async function processMatch(db, match, now) {
  const payload = await buildPayload(db, match)
  if (DRY_RUN) {
    console.log(`[dry-run] ${match.match_key} sources=${payload.sources.length} factors=${payload.factors.length} injuries=${payload.injuries.length}`)
    return true
  }
  writePayload(db, match, payload, now)
  console.log(`${match.match_key} 写入 factors=${payload.factors.length} injuries=${payload.injuries.length} sources=${payload.sources.length}`)
  return true
}

async function run() {
  const now = new Date().toISOString()
  const { db, dbPath } = openDb()
  const matches = loadMatches(db, MATCH_KEYS, LIMIT)
  if (!matches.length) {
    console.log("未找到可处理的比赛")
    return
  }

  console.log(`待处理 ${matches.length} 场${DRY_RUN ? " [dry-run]" : ""}`)
  let ok = 0
  for (const match of matches) {
    try {
      const r = await processMatch(db, match, now)
      if (r) ok++
    } catch (e) {
      console.log(`${match.match_key} 失败: ${e.message}`)
    }
  }

  const fc = db.prepare("SELECT COUNT(DISTINCT match_key) n FROM match_factors").get().n
  const ic = db.prepare("SELECT COUNT(*) n FROM injuries").get().n
  console.log(`完成：成功 ${ok}/${matches.length} 场；match_factors 覆盖 ${fc} 场，injuries 共 ${ic} 条 → ${dbPath}`)
}

run().catch((e) => {
  console.error("失败:", e.message)
  process.exit(1)
})
