// V6 vs V7 逐场对比（在线上 rankToElo 量纲上）。
// 目的：把 V7（历史重训得到、Elo均值~1500量纲）按量纲比例换算到线上 rankToElo 量纲，
// 然后在「站点真实展示的 2026 已完赛 11 场」上，对比 V6 与 V7 的 胜平负/预测比分/λ 与真实赛果。
// 用法：node scripts/compare-v6-v7.mjs
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const v7raw = JSON.parse(readFileSync(path.join(__dirname, "_v7-params.json"), "utf8"))

// —— 量纲换算 ——
// 训练Elo：标准 logistic（/400），评分差经 gdScale 映射净胜。
// 线上 rankToElo 同样是 Elo 点，但分布更宽（顶2080/中1747/底1543，跨度~537）。
// 训练 Elo 跨度约 1393~1691=298。比例 k = 537/298 ≈ 1.80。
// gdScale 与各「Elo点」权重(homeAdv/formWeight)需 ×k 才能在线上量纲产生等价效果。
const K_SCALE = 1.80
const V7_PARAMS = {
  ...v7raw,
  gdScale: Math.round(v7raw.gdScale * K_SCALE),
  homeAdv: Math.round(v7raw.homeAdv * K_SCALE),
  formWeight: Math.round(v7raw.formWeight * K_SCALE),
  drawCloseScale: Math.round(v7raw.drawCloseScale * K_SCALE),
  parkBusGap: Math.round(v7raw.parkBusGap * K_SCALE),
  blowoutGap: Math.round(v7raw.blowoutGap * K_SCALE),
  // 多因子项（线上引擎特有，V7 暂沿用 V6 的 kaWeight/altWeight，本对比聚焦基础映射）
  kaWeight: 45, altWeight: 90,
}
console.log("V7 换算到线上量纲后:", JSON.stringify(V7_PARAMS))

// —— 线上 V6 参数（与 prediction-v2.ts 一致）——
const V6_PARAMS = {
  gdScale: 280, baseTotal: 2.9, homeAdv: 65, rho: -0.12, drawInflMax: 0.55,
  drawCloseScale: 200, parkBusMax: 0.8, parkBusGap: 250, blowoutGap: 200,
  blowoutTotalBoost: 1.0, blowoutSupBoost: 0.7, lambdaFloor: 0.2,
  altWeight: 90, kaWeight: 45, formWeight: 20,
}

// —— 预测核心（吃 rankHome/rankAway，与线上同构）——
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
  Rh -= P.kaWeight * (inp.kaHome || 0); Ra -= P.kaWeight * (inp.kaAway || 0)
  Rh += P.formWeight * (inp.formHome || 0); Ra += P.formWeight * (inp.formAway || 0)
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
  return { home: Math.round(home * 100), draw: Math.round(draw * 100), away: Math.round(away * 100), score: `${best.i}-${best.j}`, lh: +lh.toFixed(2), la: +la.toFixed(2), fav }
}

// —— 站点真实展示的 2026 已完赛（取自 V2_CALIB，含真实比分）——
const MATCHES = [
  { k: "MEX-RSA", rankHome: 15, rankAway: 61, host: "home", alt: 2240, real: [2, 0] },
  { k: "KOR-CZE", rankHome: 22, rankAway: 44, host: "neutral", real: [2, 1] },
  { k: "USA-PAR", rankHome: 14, rankAway: 39, host: "home", real: [4, 1] },
  { k: "CAN-BIH", rankHome: 27, rankAway: 74, host: "home", real: [1, 1] },
  { k: "QAT-SUI", rankHome: 51, rankAway: 17, host: "neutral", real: [1, 1] },
  { k: "BRA-MAR", rankHome: 6, rankAway: 11, host: "neutral", real: [1, 1] },
  { k: "HAI-SCO", rankHome: 83, rankAway: 36, host: "neutral", real: [0, 1] },
  { k: "AUS-TUR", rankHome: 26, rankAway: 25, host: "neutral", real: [2, 0] },
  { k: "GER-CUW", rankHome: 9, rankAway: 82, host: "neutral", real: [7, 1] },
  { k: "CIV-ECU", rankHome: 42, rankAway: 23, host: "neutral", real: [1, 0] },
  { k: "NED-JPN", rankHome: 7, rankAway: 18, host: "neutral", real: [2, 2] },
]

const cls = (h, a) => (h > a ? "home" : h === a ? "draw" : "away")
let v6dir = 0, v7dir = 0, v6ex = 0, v7ex = 0
console.log("\n比赛       真实   | V6 胜平负  比分  λ        | V7 胜平负  比分  λ")
console.log("-".repeat(78))
for (const m of MATCHES) {
  const a = predict(m, V6_PARAMS), b = predict(m, V7_PARAMS)
  const rc = cls(m.real[0], m.real[1])
  const rs = `${m.real[0]}-${m.real[1]}`
  if (a.fav === rc) v6dir++; if (b.fav === rc) v7dir++
  if (a.score === rs) v6ex++; if (b.score === rs) v7ex++
  const mark = (p) => (p.fav === rc ? "✓" : "✗")
  console.log(
    `${m.k.padEnd(9)} ${rs.padEnd(5)} | ${`${a.home}/${a.draw}/${a.away}`.padEnd(10)} ${a.score.padEnd(4)} ${`${a.lh}-${a.la}`.padEnd(8)}${mark(a)} | ${`${b.home}/${b.draw}/${b.away}`.padEnd(10)} ${b.score.padEnd(4)} ${`${b.lh}-${b.la}`.padEnd(8)}${mark(b)}`
  )
}
const n = MATCHES.length
console.log("-".repeat(78))
console.log(`方向命中: V6 ${v6dir}/${n} (${(v6dir / n * 100).toFixed(0)}%)   V7 ${v7dir}/${n} (${(v7dir / n * 100).toFixed(0)}%)`)
console.log(`精确比分: V6 ${v6ex}/${n}            V7 ${v7ex}/${n}`)
