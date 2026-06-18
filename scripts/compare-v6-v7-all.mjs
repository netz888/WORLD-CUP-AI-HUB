// V6 vs V7 在【DB 里全部已完赛场次】上的对比（动态，不写死场次/排名）。
// 数据来源：
//   - 已完赛 + 真实比分：data/wc.db 的 live_scores（status_short FT/AET/PEN 或 status=finished，且有比分）。
//   - 真实 fifaRank / 场馆海拔：从 lib/data.ts 解析（与线上同源，自动随排名更新）。
//   - host：HOST_CODES={USA,MEX,CAN} 规则（与 data.ts v2ForMatch 一致）。
//   - 方法学：与 compare-v6-v7.mjs 一致，只用 rank/host/alt 隔离“参数集”效应（form/ka 对 V6/V7 是相同加项，
//     不改变相对胜负），故此处不注入 form/ka。新增 RPS（三分类排序概率分，越低越好）作更稳健的比较指标。
// 用法：node scripts/compare-v6-v7-all.mjs
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")

// ---- 从 data.ts 解析 排名 / 场馆海拔 / 赛程→场馆 ----
const dataTs = readFileSync(path.join(ROOT, "lib", "data.ts"), "utf8")
const RANK = {}
for (const m of dataTs.matchAll(/code:\s*"(\w+)"[^}]*?fifaRank:\s*(\d+)/g)) RANK[m[1]] = +m[2]
const VENUE_ALT = {}
for (const m of dataTs.matchAll(/key:\s*"([^"]+)"[^}]*?altitude:\s*(\d+)/g)) VENUE_ALT[m[1]] = +m[2]
const FIX_VENUE = {} // "HOME-AWAY" -> venueKey
for (const m of dataTs.matchAll(/\[\s*"(\w+)",\s*"(\w+)",\s*"[^"]*",\s*"[^"]*",\s*"([^"]+)"\s*\]/g))
  FIX_VENUE[`${m[1]}-${m[2]}`] = m[3]
const HOST_CODES = new Set(["USA", "MEX", "CAN"])

// ---- V7 量纲换算（与 compare-v6-v7.mjs 同：K_SCALE=1.80）----
const v7raw = JSON.parse(readFileSync(path.join(__dirname, "_v7-params.json"), "utf8"))
const K_SCALE = 1.8
const V7_PARAMS = {
  ...v7raw,
  gdScale: Math.round(v7raw.gdScale * K_SCALE),
  homeAdv: Math.round(v7raw.homeAdv * K_SCALE),
  formWeight: Math.round(v7raw.formWeight * K_SCALE),
  drawCloseScale: Math.round(v7raw.drawCloseScale * K_SCALE),
  parkBusGap: Math.round(v7raw.parkBusGap * K_SCALE),
  blowoutGap: Math.round(v7raw.blowoutGap * K_SCALE),
  kaWeight: 45,
  altWeight: 90,
}
const V6_PARAMS = {
  gdScale: 280, baseTotal: 2.9, homeAdv: 65, rho: -0.12, drawInflMax: 0.55,
  drawCloseScale: 200, parkBusMax: 0.8, parkBusGap: 250, blowoutGap: 200,
  blowoutTotalBoost: 1.0, blowoutSupBoost: 0.7, lambdaFloor: 0.2,
  altWeight: 90, kaWeight: 45, formWeight: 20,
}

// ---- 预测核心（与 prediction-v2.ts 同构）----
const rankToElo = (r) => 2080 - (Math.max(1, r) - 1) * 6.8
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r }
function pois(k, l) { return (Math.exp(-l) * Math.pow(l, k)) / factorial(k) }
function tau(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho
  if (i === 0 && j === 1) return 1 + lh * rho
  if (i === 1 && j === 0) return 1 + la * rho
  if (i === 1 && j === 1) return 1 - rho
  return 1
}
function predict(inp, P) {
  let Rh = rankToElo(inp.rankHome), Ra = rankToElo(inp.rankAway)
  if (inp.host === "home") Rh += P.homeAdv
  if (inp.host === "away") Ra += P.homeAdv
  const alt = inp.alt || 0
  if (alt > 1500) { const f = Math.min((alt - 1500) / 1500, 1); if (inp.host === "home") Ra -= P.altWeight * f; else if (inp.host === "away") Rh -= P.altWeight * f; else { Rh -= P.altWeight * f * 0.5; Ra -= P.altWeight * f * 0.5 } }
  const diff = Rh - Ra
  let total = P.baseTotal, sup = diff / P.gdScale
  const gap = Math.abs(diff)
  if (gap > P.blowoutGap) { const o = Math.min((gap - P.blowoutGap) / 300, 1.3); total += P.blowoutTotalBoost * o; sup *= 1 + P.blowoutSupBoost * o }
  const lh = Math.max(P.lambdaFloor, total / 2 + sup / 2), la = Math.max(P.lambdaFloor, total / 2 - sup / 2)
  const size = 11, M = []
  for (let i = 0; i < size; i++) { M[i] = []; for (let j = 0; j < size; j++) M[i][j] = pois(i, lh) * pois(j, la) * tau(i, j, lh, la, P.rho) }
  if (P.drawInflMax > 0) { const c = Math.max(0, 1 - Math.abs(diff) / P.drawCloseScale); const b = 1 + P.drawInflMax * c; for (let i = 0; i < size; i++) M[i][i] *= b }
  if (P.parkBusMax > 0 && gap > P.parkBusGap) { const f = Math.min((gap - P.parkBusGap) / 300, 1); const lb = 1 + P.parkBusMax * f; M[0][0] *= lb; M[1][0] *= lb; M[0][1] *= lb }
  let s = 0; for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) s += M[i][j]
  let home = 0, draw = 0, away = 0; const cells = []
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) { const p = M[i][j] / s; const cls = i > j ? "home" : i === j ? "draw" : "away"; if (i > j) home += p; else if (i === j) draw += p; else away += p; cells.push({ i, j, p, cls }) }
  cells.sort((a, b) => b.p - a.p)
  const fav = home >= draw && home >= away ? "home" : away >= draw ? "away" : "draw"
  const best = cells.find((c) => c.cls === fav) || cells[0]
  return { home, draw, away, score: `${best.i}-${best.j}`, lh: +lh.toFixed(2), la: +la.toFixed(2), fav }
}
const clsOf = (h, a) => (h > a ? "home" : h === a ? "draw" : "away")
// 归一化 RPS（三分类 home/draw/away，0~1，越低越好）
function rps(p, realCls) {
  const o = { home: [1, 0, 0], draw: [0, 1, 0], away: [0, 0, 1] }[realCls]
  const cp = [p.home, p.home + p.draw]
  const co = [o[0], o[0] + o[1]]
  return 0.5 * ((cp[0] - co[0]) ** 2 + (cp[1] - co[1]) ** 2)
}

// ---- 读 DB 已完赛 ----
const db = new Database(path.join(ROOT, "data", "wc.db"), { readonly: true })
const rows = db.prepare("SELECT * FROM live_scores").all()
const finished = rows.filter(
  (r) => r.home_score != null && r.away_score != null &&
    (/^(FT|AET|PEN)$/i.test(r.status_short || "") || /finish/i.test(r.status || "")),
)

console.log(`V7 换算到线上量纲: ${JSON.stringify(V7_PARAMS)}\n`)
console.log("比赛       真实  | V6 胜平负   比分  λ        rps   | V7 胜平负   比分  λ        rps")
console.log("-".repeat(92))
let v6dir = 0, v7dir = 0, v6ex = 0, v7ex = 0, v6rps = 0, v7rps = 0, n = 0, skipped = []
for (const r of finished.sort((a, b) => a.match_key.localeCompare(b.match_key))) {
  const [hc, ac] = r.match_key.split("-")
  if (RANK[hc] == null || RANK[ac] == null) { skipped.push(r.match_key); continue }
  const host = HOST_CODES.has(hc) ? "home" : HOST_CODES.has(ac) ? "away" : "neutral"
  const alt = VENUE_ALT[FIX_VENUE[r.match_key]] || 0
  const inp = { rankHome: RANK[hc], rankAway: RANK[ac], host, alt }
  const a = predict(inp, V6_PARAMS), b = predict(inp, V7_PARAMS)
  const rc = clsOf(r.home_score, r.away_score)
  const rs = `${r.home_score}-${r.away_score}`
  const ra = rps(a, rc), rb = rps(b, rc)
  if (a.fav === rc) v6dir++; if (b.fav === rc) v7dir++
  if (a.score === rs) v6ex++; if (b.score === rs) v7ex++
  v6rps += ra; v7rps += rb; n++
  const pct = (p) => `${Math.round(p.home * 100)}/${Math.round(p.draw * 100)}/${Math.round(p.away * 100)}`
  const mk = (p) => (p.fav === rc ? "✓" : "✗")
  console.log(
    `${r.match_key.padEnd(9)} ${rs.padEnd(4)} | ${pct(a).padEnd(11)} ${a.score.padEnd(4)} ${`${a.lh}-${a.la}`.padEnd(8)} ${ra.toFixed(3)}${mk(a)} | ${pct(b).padEnd(11)} ${b.score.padEnd(4)} ${`${b.lh}-${b.la}`.padEnd(8)} ${rb.toFixed(3)}${mk(b)}`,
  )
}
console.log("-".repeat(92))
console.log(`样本 ${n} 场${skipped.length ? `（跳过无排名：${skipped.join(",")}）` : ""}`)
console.log(`方向命中:  V6 ${v6dir}/${n} (${(v6dir / n * 100).toFixed(0)}%)    V7 ${v7dir}/${n} (${(v7dir / n * 100).toFixed(0)}%)`)
console.log(`精确比分:  V6 ${v6ex}/${n}             V7 ${v7ex}/${n}`)
console.log(`平均 RPS:  V6 ${(v6rps / n).toFixed(4)}        V7 ${(v7rps / n).toFixed(4)}   （越低越好）`)
