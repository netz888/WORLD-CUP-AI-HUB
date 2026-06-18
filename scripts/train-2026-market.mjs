// D: 2026 富特征评估 —— 模型 vs 市场 vs 融合（模型为主+市场校准）。
// 在 12 场「同时有真实比分 + 赛前市场赔率」的 2026 已完赛上，比较：
//   (1) 纯模型(V7)  (2) 纯市场(de-vig后)  (3) 融合 blend = α·模型 + (1-α)·市场
// 度量 RPS（重合度/校准，越低越好）+ 方向命中。找最优 α。
// 诚实：n=12 极小，α 只能当方向性参考，不是精确拟合；强正则=只在粗网格 {0.5,0.6,...,1.0} 上找。
// 用法：node scripts/train-2026-market.mjs
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const v7raw = JSON.parse(readFileSync(path.join(__dirname, "_v7-params.json"), "utf8"))
const K_SCALE = 1.80
const P = {
  ...v7raw,
  gdScale: Math.round(v7raw.gdScale * K_SCALE), homeAdv: Math.round(v7raw.homeAdv * K_SCALE),
  formWeight: Math.round(v7raw.formWeight * K_SCALE), drawCloseScale: Math.round(v7raw.drawCloseScale * K_SCALE),
  parkBusGap: Math.round(v7raw.parkBusGap * K_SCALE), blowoutGap: Math.round(v7raw.blowoutGap * K_SCALE),
  kaWeight: 45, altWeight: 90,
}
const rankToElo = (r) => 2080 - (Math.max(1, r) - 1) * 6.8
function fac(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r }
function po(k, l) { return (Math.exp(-l) * Math.pow(l, k)) / fac(k) }
function tau(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho
  if (i === 0 && j === 1) return 1 + lh * rho
  if (i === 1 && j === 0) return 1 + la * rho
  if (i === 1 && j === 1) return 1 - rho
  return 1
}
function modelProb(inp) {
  let Rh = rankToElo(inp.rankHome), Ra = rankToElo(inp.rankAway)
  if (inp.host === "home") Rh += P.homeAdv
  if (inp.host === "away") Ra += P.homeAdv
  const alt = inp.alt || 0
  if (alt > 1500) { const f = Math.min((alt - 1500) / 1500, 1); if (inp.host === "home") Ra -= P.altWeight * f; else if (inp.host === "away") Rh -= P.altWeight * f; else { Rh -= P.altWeight * f * 0.5; Ra -= P.altWeight * f * 0.5 } }
  Rh -= P.kaWeight * (inp.kaHome || 0); Ra -= P.kaWeight * (inp.kaAway || 0)
  const diff = Rh - Ra
  let total = P.baseTotal, sup = diff / P.gdScale
  const gap = Math.abs(diff)
  if (gap > P.blowoutGap) { const o = Math.min((gap - P.blowoutGap) / 300, 1.3); total += P.blowoutTotalBoost * o; sup *= 1 + P.blowoutSupBoost * o }
  const lh = Math.max(P.lambdaFloor, total / 2 + sup / 2), la = Math.max(P.lambdaFloor, total / 2 - sup / 2)
  const N = 11, M = []
  for (let i = 0; i < N; i++) { M[i] = []; for (let j = 0; j < N; j++) M[i][j] = po(i, lh) * po(j, la) * tau(i, j, lh, la, P.rho) }
  if (P.drawInflMax > 0) { const c = Math.max(0, 1 - Math.abs(diff) / P.drawCloseScale); const b = 1 + P.drawInflMax * c; for (let i = 0; i < N; i++) M[i][i] *= b }
  if (P.parkBusMax > 0 && gap > P.parkBusGap) { const f = Math.min((gap - P.parkBusGap) / 300, 1); const lb = 1 + P.parkBusMax * f; M[0][0] *= lb; M[1][0] *= lb; M[0][1] *= lb }
  let s = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) s += M[i][j]
  let h = 0, d = 0, a = 0
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = M[i][j] / s; if (i > j) h += p; else if (i === j) d += p; else a += p }
  return [h, d, a]
}

// —— 2026 已完赛的排名/host/alt/ka（rank+host 取自 V2_CALIB；ka 取自 team-profiles）——
const META = {
  "MEX-RSA": { rankHome: 15, rankAway: 61, host: "home", alt: 2240 },
  "USA-PAR": { rankHome: 14, rankAway: 39, host: "home" },
  "QAT-SUI": { rankHome: 51, rankAway: 17, host: "neutral" },
  "BRA-MAR": { rankHome: 6, rankAway: 11, host: "neutral" },
  "HAI-SCO": { rankHome: 83, rankAway: 36, host: "neutral" },
  "AUS-TUR": { rankHome: 26, rankAway: 25, host: "neutral" },
  "GER-CUW": { rankHome: 9, rankAway: 82, host: "neutral" },
  "NED-JPN": { rankHome: 7, rankAway: 18, host: "neutral" },
  "SWE-TUN": { rankHome: 38, rankAway: 45, host: "neutral" },
  "BEL-EGY": { rankHome: 9, rankAway: 29, host: "neutral" },
  "KSA-URU": { rankHome: 61, rankAway: 16, host: "neutral" },
  "IRN-NZL": { rankHome: 20, rankAway: 89, host: "neutral" },
}
const profiles = JSON.parse(readFileSync(path.join(__dirname, "..", "lib", "team-profiles.json"), "utf8"))
const clampKa = (c) => (c && c.hasData ? Math.min(2, Math.max(0, c.kaEquiv)) : 0)

const db = new Database(path.join(__dirname, "..", "data", "wc.db"))
const ls = db.prepare("SELECT match_key k, home_score h, away_score a FROM live_scores WHERE home_score IS NOT NULL").all()
const mo = Object.fromEntries(db.prepare("SELECT match_key, home_p, draw_p, away_p FROM market_odds").all().map((m) => [m.match_key, m]))

const set = []
for (const r of ls) {
  const m = META[r.k]; const mk = mo[r.k]
  if (!m || !mk) continue
  const pre = profiles.prematch?.[r.k]
  set.push({
    k: r.k, ...m,
    kaHome: clampKa(pre?.coreHome), kaAway: clampKa(pre?.coreAway),
    market: [mk.home_p, mk.draw_p, mk.away_p],
    real: [r.h, r.a],
  })
}
console.log(`评估样本: ${set.length} 场（同时有真实比分+市场+排名）`)

function rps(p, oi) { const ob = [0, 0, 0]; ob[oi] = 1; let c = 0, co = 0, s = 0; for (let k = 0; k < 2; k++) { c += p[k]; co += ob[k]; s += (c - co) ** 2 } return s }
const oiOf = (h, a) => (h > a ? 0 : h === a ? 1 : 2)
const favOf = (p) => (p[0] >= p[1] && p[0] >= p[2] ? 0 : p[2] >= p[1] ? 2 : 1)

function evalBlend(alpha) {
  let rpsSum = 0, dir = 0
  for (const s of set) {
    const mp = modelProb(s)
    const blend = [0, 1, 2].map((i) => alpha * mp[i] + (1 - alpha) * s.market[i])
    const sum = blend[0] + blend[1] + blend[2]
    const p = blend.map((x) => x / sum)
    const oi = oiOf(s.real[0], s.real[1])
    rpsSum += rps(p, oi)
    if (favOf(p) === oi) dir++
  }
  return { rps: rpsSum / set.length, dir: dir / set.length }
}

console.log("\nα(模型权重)  RPS(越低越好)  方向命中")
let best = null
for (let a = 0; a <= 1.0001; a += 0.1) {
  const m = evalBlend(a)
  const tag = a === 1 ? " ←纯模型" : a === 0 ? " ←纯市场" : ""
  console.log(`  α=${a.toFixed(1)}      ${m.rps.toFixed(4)}        ${(m.dir * 100).toFixed(0)}%${tag}`)
  if (!best || m.rps < best.rps) best = { alpha: +a.toFixed(1), ...m }
}
console.log(`\n最优融合: α=${best.alpha}（模型 ${(best.alpha * 100).toFixed(0)}% + 市场 ${((1 - best.alpha) * 100).toFixed(0)}%）  RPS ${best.rps.toFixed(4)}  方向 ${(best.dir * 100).toFixed(0)}%`)
console.log("诚实提示: n=12 极小，此 α 为方向性参考；建议保守取 0.6~0.8（模型为主、市场轻校准）。")
