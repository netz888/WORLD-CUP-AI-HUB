// 拉全 48 队 /players?team&season 的全名（含分页），与 squad 缩写名合并。
// 用法：API_FOOTBALL_KEY=... node scripts/_pull-fullnames.mjs
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"
const DELAY = Number(KEYS.API_FOOTBALL_DELAY_MS || 1400)
const SEASON = process.env.SEASON || "2026"
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

const squads = JSON.parse(fs.readFileSync(path.join(__dirname, "_squads.json"), "utf8"))
// id → {short, full} ；full 用 firstname 第一词 + lastname（贴近 fixtures/lineups 格式）
const out = {}  // code → [{ id, short, full }]
for (const [code, { id }] of Object.entries(squads)) {
  if (!id) { out[code] = []; continue }
  const players = []
  let page = 1, total = 1
  do {
    const j = await api(`/players?team=${id}&season=${SEASON}&page=${page}`)
    total = j.paging?.total || 1
    for (const r of j.response || []) {
      const pl = r.player
      const first = (pl.firstname || "").split(" ")[0]
      const full = first && pl.lastname ? `${first} ${pl.lastname}` : (pl.name || "")
      players.push({ id: pl.id, short: pl.name, full })
    }
    page++
  } while (page <= total)
  out[code] = players
  console.log(`${code} id=${id} → ${players.length} 人 (含全名)`)
}
fs.writeFileSync(path.join(__dirname, "_fullnames.json"), JSON.stringify(out, null, 1))
console.log("\n已写 scripts/_fullnames.json")
