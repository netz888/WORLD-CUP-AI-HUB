// 一次性：拉全 48 队 squad，导出「未入译库」的球员名清单（含缩写名与全名两种形式）。
// 用法：API_FOOTBALL_KEY=... node scripts/_pull-squads.mjs
// 产物：scripts/_squads.json（全量 squad）、scripts/_untranslated.json（待译清单）
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"

const DELAY = Number(KEYS.API_FOOTBALL_DELAY_MS || 1500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
async function api(q) {
  for (let a = 1; a <= 4; a++) {
    const w = Math.max(0, last + DELAY - Date.now()); if (w) await sleep(w); last = Date.now()
    let res, j
    try {
      res = await fetch(BASE + q, { headers: { "x-apisports-key": KEY } })
      const buf = await res.arrayBuffer()
      j = JSON.parse(new TextDecoder("utf-8").decode(buf))
    }
    catch (e) { if (a < 4) { await sleep(3000); continue } throw e }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length : errs && Object.keys(errs).length
    if (!hasErr) return j
    if (JSON.stringify(errs).includes("rateLimit") && a < 4) { await sleep(60000); continue }
    throw new Error(`API err ${q}: ${JSON.stringify(errs)}`)
  }
}

// 48 队：三字码 → API 搜索名（用最容易命中 national:true 的官方英文名）
const TEAMS = {
  CAN: "Canada", MEX: "Mexico", USA: "USA", ARG: "Argentina", BRA: "Brazil", URU: "Uruguay",
  COL: "Colombia", ECU: "Ecuador", PAR: "Paraguay", FRA: "France", ESP: "Spain", ENG: "England",
  GER: "Germany", NED: "Netherlands", POR: "Portugal", BEL: "Belgium", CRO: "Croatia", SUI: "Switzerland",
  AUT: "Austria", NOR: "Norway", SWE: "Sweden", TUR: "Turkey", CZE: "Czechia", SCO: "Scotland",
  MAR: "Morocco", SEN: "Senegal", CIV: "Ivory Coast", TUN: "Tunisia", EGY: "Egypt", ALG: "Algeria",
  RSA: "South Africa", JPN: "Japan", KOR: "South Korea", IRN: "Iran", AUS: "Australia", QAT: "Qatar",
  KSA: "Saudi Arabia", UZB: "Uzbekistan", NZL: "New Zealand", BIH: "Bosnia", HAI: "Haiti",
  CPV: "Cape Verde", CUW: "Curacao", COD: "Congo DR", IRQ: "Iraq", JOR: "Jordan", GHA: "Ghana", PAN: "Panama",
}

const idCache = {}
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
// 选成年男足：排除女足(W)与各级青年队(U17/U19/U20/U21/U23)等；优先 team.code 非空（成年队才有标准 code）。
const isYouthOrWomen = (nm) => /\sW(\s|$)/.test(nm) || /U-?\d/.test(nm) || /Women/i.test(nm)
async function teamId(code, name) {
  const j = await api("/teams?search=" + encodeURIComponent(name))
  const nat = (j.response || []).filter((t) => t.team.national)
  const senior = nat.filter((t) => !isYouthOrWomen(t.team.name))
  // 1) 名字精确等于搜索名（成年男足通常就是纯国名，如 "Canada"/"New Zealand"）
  let pick = senior.find((t) => norm(t.team.name) === norm(name))
  // 2) 否则取有 code 且非青年/女足的
  if (!pick) pick = senior.find((t) => t.team.code)
  // 3) 兜底第一个 senior
  if (!pick) pick = senior[0]
  if (!pick) { console.log(`  ⚠ ${code} (${name}) 未找到成年男足 id`); return null }
  return { id: pick.team.id, picked: pick.team.name }
}

const squads = {}
for (const [code, name] of Object.entries(TEAMS)) {
  const r = await teamId(code, name)
  if (!r) { squads[code] = { id: null, players: [] }; continue }
  const s = await api("/players/squads?team=" + r.id)
  const players = (s.response?.[0]?.players || []).map((p) => ({ name: p.name, number: p.number, position: p.position }))
  squads[code] = { id: r.id, picked: r.picked, players }
  console.log(`${code} (${name}) → ${r.picked} id=${r.id} → ${players.length} 人`)
}
fs.writeFileSync(path.join(__dirname, "_squads.json"), JSON.stringify(squads, null, 1))
console.log("\n已写 scripts/_squads.json")
