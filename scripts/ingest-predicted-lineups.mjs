import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const getFlagValue = (name) => {
  const idx = argv.indexOf(name)
  if (idx < 0) return null
  return argv[idx + 1] && !argv[idx + 1].startsWith("-") ? argv[idx + 1] : null
}

const dryRun = hasFlag("--dry-run")
const matchFilter = getFlagValue("--match")
const limitArg = Number(getFlagValue("--limit") || "0")
const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity
const daysAheadArg = Number(getFlagValue("--days") || "7")
const daysAhead = Number.isFinite(daysAheadArg) && daysAheadArg > 0 ? daysAheadArg : 7

const KEYS = await getApiKeys()
const API_FOOTBALL_KEY = await requireKey("API_FOOTBALL_KEY")
const MIMO_API_KEY = await requireKey("MIMO_API_KEY")
const MIMO_BASE_URL = KEYS.MIMO_BASE_URL || "https://api.xiaomimimo.com/v1"
const MIMO_MODEL = KEYS.MIMO_MODEL || "mimo-v2.5-pro"
const MIMO_WEB_SEARCH = !["", "0", "false", "no", "off"].includes(String(KEYS.MIMO_WEB_SEARCH || "").trim().toLowerCase())

const API_BASE = "https://v3.football.api-sports.io"
const WC_LEAGUE_ID = 1
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
const norm = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
const NAME_TO_CODE = {}
for (const [k, v] of Object.entries(RAW)) NAME_TO_CODE[norm(k)] = v
const codeOf = (name) => NAME_TO_CODE[norm(name)] ?? null

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

const hasConfirmedLineup = db.prepare(
  "SELECT 1 FROM lineups WHERE match_key = ? AND kind = 'confirmed' LIMIT 1",
)
const upsertLineup = db.prepare(`INSERT INTO lineups
  (match_key, side, team_code, team_name, formation, coach, kind, source, fixture_id, start_xi, subs, as_of)
  VALUES (@match_key, @side, @team_code, @team_name, @formation, @coach, @kind, @source, @fixture_id, @start_xi, @subs, @as_of)
  ON CONFLICT(match_key, side) DO UPDATE SET
    team_code=excluded.team_code,
    team_name=excluded.team_name,
    formation=excluded.formation,
    coach=excluded.coach,
    kind=excluded.kind,
    source=excluded.source,
    fixture_id=excluded.fixture_id,
    start_xi=excluded.start_xi,
    subs=excluded.subs,
    as_of=excluded.as_of
  WHERE kind <> 'confirmed'`)

let lastApiAt = 0
async function api(q) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = Math.max(0, lastApiAt + 1200 - Date.now())
    if (wait > 0) await sleep(wait)
    lastApiAt = Date.now()
    const res = await fetch(`${API_BASE}${q}`, {
      headers: { "x-apisports-key": API_FOOTBALL_KEY },
    })
    const json = await res.json().catch(() => null)
    const errors = json?.errors
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : !!(errors && Object.keys(errors).length > 0)
    if (res.ok && json && !hasErrors) return json
    const errText = JSON.stringify(errors ?? { status: res.status })
    if (attempt < 4 && (res.status === 429 || errText.includes("rateLimit"))) {
      await sleep(5000)
      continue
    }
    throw new Error(`API-Football request failed for ${q}: ${errText}`)
  }
  throw new Error(`API-Football retry exhausted for ${q}`)
}

function resolveChatUrl(base) {
  const trimmed = String(base || "").trim()
  if (!trimmed) return "https://api.xiaomimimo.com/v1/chat/completions"
  if (trimmed.endsWith("/chat/completions")) return trimmed
  return `${trimmed.replace(/\/+$/, "")}/chat/completions`
}

function boolish(v) {
  return !["", "0", "false", "no", "off"].includes(String(v || "").trim().toLowerCase())
}

function extractJsonText(text) {
  const raw = String(text || "").trim()
  if (!raw) throw new Error("empty model response")
  if (raw.startsWith("{") && raw.endsWith("}")) return raw
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start >= 0 && end > start) return raw.slice(start, end + 1)
  throw new Error("model response does not contain JSON")
}

function normalizePos(pos) {
  const v = String(pos || "").trim().toUpperCase()
  if (["G", "GK", "GOALKEEPER"].includes(v)) return "G"
  if (["D", "DEF", "DEFENDER", "CB", "LB", "RB", "WB"].includes(v)) return "D"
  if (["M", "MID", "MIDFIELDER", "DM", "CM", "AM", "LM", "RM"].includes(v)) return "M"
  if (["F", "FW", "FORWARD", "ST", "CF", "LW", "RW", "SS"].includes(v)) return "F"
  return ""
}

function normalizePlayer(player) {
  if (!player || typeof player !== "object") return null
  const name = String(player.name || "").trim()
  const pos = normalizePos(player.pos)
  if (!name || !pos) return null
  return { name, pos }
}

function normalizeSource(source) {
  if (!source) return null
  if (typeof source === "string") {
    const url = /^https?:\/\//i.test(source) ? source : ""
    return { title: source, url, publishTime: "" }
  }
  if (typeof source !== "object") return null
  const title = String(source.title || source.name || source.source || "").trim()
  const url = String(source.url || source.link || "").trim()
  const publishTime = String(source.publishTime || source.publishedAt || source.date || "").trim()
  if (!title && !url && !publishTime) return null
  return { title, url, publishTime }
}

function normalizeTeamBlock(block, fallbackTeamName, fallbackTeamCode) {
  if (!block || typeof block !== "object") return null
  const teamName = String(block.teamName || fallbackTeamName || "").trim()
  const teamCode = String(block.teamCode || fallbackTeamCode || "").trim()
  const formation = block.formation == null ? null : String(block.formation).trim() || null
  const startXI = Array.isArray(block.startXI) ? block.startXI.map(normalizePlayer).filter(Boolean) : []
  const doubtful = Array.isArray(block.doubtful)
    ? block.doubtful.map(normalizePlayer).filter(Boolean)
    : []
  const out = Array.isArray(block.out) ? block.out.map(normalizePlayer).filter(Boolean) : []
  const sources = Array.isArray(block.sources) ? block.sources.map(normalizeSource).filter(Boolean) : []
  if (startXI.length !== 11) return null
  if (!sources.length) return null
  return { teamName, teamCode, formation, startXI, doubtful, out, sources }
}

async function predictLineup(match) {
  const chatUrl = resolveChatUrl(MIMO_BASE_URL)
  const userPayload = {
    fixtureId: match.fixture.id,
    kickoff: match.fixture.date,
    league: match.league.name,
    country: match.league.country,
    home: { name: match.teams.home.name, code: match.homeCode },
    away: { name: match.teams.away.name, code: match.awayCode },
    outputSchema: {
      home: {
        teamName: "string",
        teamCode: "string",
        formation: "string|null",
        startXI: [{ name: "string", pos: "G|D|M|F" }],
        doubtful: [{ name: "string", pos: "G|D|M|F" }],
        out: [{ name: "string", pos: "G|D|M|F" }],
        sources: [{ title: "string", url: "string", publishTime: "string" }],
      },
      away: {
        teamName: "string",
        teamCode: "string",
        formation: "string|null",
        startXI: [{ name: "string", pos: "G|D|M|F" }],
        doubtful: [{ name: "string", pos: "G|D|M|F" }],
        out: [{ name: "string", pos: "G|D|M|F" }],
        sources: [{ title: "string", url: "string", publishTime: "string" }],
      },
    },
    rules: [
      "Use web search when available.",
      "Return only valid JSON.",
      "Do not include markdown, code fences, or commentary.",
      "Each side must have exactly 11 players in startXI.",
      "Use only the fields in the schema and keep positions to G, D, M, or F.",
      "If formation is uncertain, set it to null rather than inventing it.",
      "Include doubtful and out lists only when supported by the sources; otherwise use empty arrays.",
      "Each side must include at least one source.",
    ],
  }

  const body = {
    model: MIMO_MODEL,
    messages: [
      {
        role: "system",
        content: "You predict football starting lineups from live web search. Return one strict JSON object only.",
      },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    tools: MIMO_WEB_SEARCH ? [{ type: "web_search" }] : undefined,
    webSearchEnabled: MIMO_WEB_SEARCH,
  }

  const res = await fetch(chatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MIMO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`MiMo request failed: ${res.status} ${JSON.stringify(json?.error ?? json ?? {})}`)
  }
  const content = json?.choices?.[0]?.message?.content
  const parsed = JSON.parse(extractJsonText(content))
  const home = normalizeTeamBlock(parsed.home, match.teams.home.name, match.homeCode)
  const away = normalizeTeamBlock(parsed.away, match.teams.away.name, match.awayCode)
  if (!home || !away) {
    throw new Error("invalid lineup JSON: missing home/away block, sources, or 11 starters")
  }
  return { home, away, raw: parsed }
}

async function main() {
  const now = new Date()
  const nowIso = now.toISOString()
  const seen = new Map()

  for (let i = 0; i <= daysAhead; i++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i))
      .toISOString()
      .slice(0, 10)
    const fixtures = await api(`/fixtures?date=${date}`)
    for (const fx of fixtures.response || []) {
      if (fx.league?.id !== WC_LEAGUE_ID) continue
      const homeCode = codeOf(fx.teams?.home?.name)
      const awayCode = codeOf(fx.teams?.away?.name)
      if (!homeCode || !awayCode) continue
      const short = fx.fixture?.status?.short || "NS"
      if (!["NS", "TBD", "PST"].includes(short)) continue
      seen.set(fx.fixture.id, { ...fx, homeCode, awayCode, short })
    }
  }

  const matches = [...seen.values()].sort((a, b) => {
    const ak = a.fixture?.timestamp || 0
    const bk = b.fixture?.timestamp || 0
    return ak - bk
  })

  let processed = 0
  let skippedConfirmed = 0
  let skippedOfficial = 0

  for (const match of matches) {
    if (processed >= limit) break
    const matchKey = `${match.homeCode}-${match.awayCode}`
    if (matchFilter && matchFilter !== matchKey) continue

    if (hasConfirmedLineup.get(matchKey)) {
      skippedConfirmed++
      console.log(`skip confirmed ${matchKey}`)
      continue
    }

    const lineupCheck = await api(`/fixtures/lineups?fixture=${match.fixture.id}`)
    if ((lineupCheck.response || []).length >= 2) {
      skippedOfficial++
      console.log(`skip official ${matchKey}`)
      continue
    }

    console.log(`predict ${matchKey} ${match.teams.home.name} vs ${match.teams.away.name}`)
    const predicted = await predictLineup(match)
    const rows = [
      {
        match_key: matchKey,
        side: "home",
        team_code: match.homeCode,
        team_name: predicted.home.teamName || match.teams.home.name,
        formation: predicted.home.formation,
        coach: null,
        kind: "predicted",
        source: "mimo",
        fixture_id: match.fixture.id,
        start_xi: JSON.stringify(predicted.home.startXI),
        subs: JSON.stringify([]),
        as_of: nowIso,
      },
      {
        match_key: matchKey,
        side: "away",
        team_code: match.awayCode,
        team_name: predicted.away.teamName || match.teams.away.name,
        formation: predicted.away.formation,
        coach: null,
        kind: "predicted",
        source: "mimo",
        fixture_id: match.fixture.id,
        start_xi: JSON.stringify(predicted.away.startXI),
        subs: JSON.stringify([]),
        as_of: nowIso,
      },
    ]

    if (dryRun) {
      console.log(JSON.stringify({
        matchKey,
        fixtureId: match.fixture.id,
        home: predicted.home,
        away: predicted.away,
      }, null, 2))
    } else {
      const tx = db.transaction(() => {
        for (const row of rows) upsertLineup.run(row)
      })
      tx()
      console.log(`wrote predicted lineups for ${matchKey}`)
    }

    processed++
  }

  console.log(
    JSON.stringify({
      dbPath,
      dryRun,
      processed,
      skippedConfirmed,
      skippedOfficial,
      matchesSeen: matches.length,
    }),
  )
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err))
  process.exit(1)
})
