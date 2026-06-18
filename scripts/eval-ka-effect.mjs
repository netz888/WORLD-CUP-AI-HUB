// 量化：接入真实核心缺阵 ka 后，2026 已完赛 12 场的命中率动没动。
// 对比：A) 不用 ka（kaHome=kaAway=0）  B) 用真实 ka（team-profiles，钳[0,2]）
// 度量 RPS + 方向命中 + 精确比分。用 V7 换算参数。
// 用法：node scripts/eval-ka-effect.mjs
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const v7raw = JSON.parse(readFileSync(path.join(__dirname, "_v7-params.json"), "utf8"))
const K = 1.80
const P = { ...v7raw, gdScale: Math.round(v7raw.gdScale * K), homeAdv: Math.round(v7raw.homeAdv * K), formWeight: Math.round(v7raw.formWeight * K), drawCloseScale: Math.round(v7raw.drawCloseScale * K), parkBusGap: Math.round(v7raw.parkBusGap * K), blowoutGap: Math.round(v7raw.blowoutGap * K), kaWeight: 45, altWeight: 90 }
const rankToElo = (r) => 2080 - (Math.max(1, r) - 1) * 6.8
function fac(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r }
function po(k, l) { return (Math.exp(-l) * Math.pow(l, k)) / fac(k) }
function tau(i, j, lh, la, rho) { if (i === 0 && j === 0) return 1 - lh * la * rho; if (i === 0 && j === 1) return 1 + lh * rho; if (i === 1 && j === 0) return 1 + la * rho; if (i === 1 && j === 1) return 1 - rho; return 1 }
function predict(inp) {
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
  let h = 0, d = 0, a = 0; const cells = []
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = M[i][j] / s; const cls = i > j ? "home" : i === j ? "draw" : "away"; if (i > j) h += p; else if (i === j) d += p; else a += p; cells.push({ i, j, p, cls }) }
  cells.sort((a, b) => b.p - a.p)
  const fav = h >= d && h >= a ? "home" : a >= d ? "away" : "draw"
  const best = cells.find((c) => c.cls === fav) || cells[0]
  return { p: [h, d, a], score: [best.i, best.j], fav }
}
const META = { "MEX-RSA": { rankHome: 15, rankAway: 61, host: "home", alt: 2240, real: [2, 0] }, "USA-PAR": { rankHome: 14, rankAway: 39, host: "home", real: [4, 1] }, "QAT-SUI": { rankHome: 51, rankAway: 17, host: "neutral", real: [1, 1] }, "BRA-MAR": { rankHome: 6, rankAway: 11, host: "neutral", real: [1, 1] }, "HAI-SCO": { rankHome: 83, rankAway: 36, host: "neutral", real: [0, 1] }, "AUS-TUR": { rankHome: 26, rankAway: 25, host: "neutral", real: [2, 0] }, "GER-CUW": { rankHome: 9, rankAway: 82, host: "neutral", real: [7, 1] }, "NED-JPN": { rankHome: 7, rankAway: 18, host: "neutral", real: [2, 2] }, "SWE-TUN": { rankHome: 38, rankAway: 45, host: "neutral", real: [5, 1] }, "BEL-EGY": { rankHome: 9, rankAway: 29, host: "neutral", real: [1, 1] }, "KSA-URU": { rankHome: 61, rankAway: 16, host: "neutral", real: [1, 1] }, "IRN-NZL": { rankHome: 20, rankAway: 89, host: "neutral", real: [2, 2] } }
const prof = JSON.parse(readFileSync(path.join(__dirname, "..", "lib", "team-profiles.json"), "utf8"))
const clampKa = (c) => (c && c.hasData ? Math.min(2, Math.max(0, c.kaEquiv)) : 0)
const rps = (p, oi) => { const ob = [0, 0, 0]; ob[oi] = 1; let c = 0, co = 0, s = 0; for (let k = 0; k < 2; k++) { c += p[k]; co += ob[k]; s += (c - co) ** 2 } return s }
const oiOf = (h, a) => (h > a ? 0 : h === a ? 1 : 2)
const clsOf = (h, a) => (h > a ? "home" : h === a ? "draw" : "away")

let r0 = { rps: 0, dir: 0, ex: 0 }, r1 = { rps: 0, dir: 0, ex: 0 }, n = 0
console.log("比赛       真实  | 无ka 比分/胜负 | 有ka 比分/胜负  (ka 主/客)")
console.log("-".repeat(72))
for (const k of Object.keys(META)) {
  const m = META[k]; const pre = prof.prematch?.[k]
  const kaH = clampKa(pre?.coreHome), kaA = clampKa(pre?.coreAway)
  const noka = predict({ ...m, kaHome: 0, kaAway: 0 })
  const wka = predict({ ...m, kaHome: kaH, kaAway: kaA })
  const oi = oiOf(m.real[0], m.real[1]), rc = clsOf(m.real[0], m.real[1])
  r0.rps += rps(noka.p, oi); r1.rps += rps(wka.p, oi)
  if (noka.fav === rc) r0.dir++; if (wka.fav === rc) r1.dir++
  if (noka.score[0] === m.real[0] && noka.score[1] === m.real[1]) r0.ex++
  if (wka.score[0] === m.real[0] && wka.score[1] === m.real[1]) r1.ex++
  n++
  const ck = (pr) => (pr.fav === rc ? "✓" : "✗")
  console.log(`${k.padEnd(9)} ${m.real[0]}-${m.real[1]} | ${noka.score.join("-")} ${noka.fav.padEnd(4)}${ck(noka)}      | ${wka.score.join("-")} ${wka.fav.padEnd(4)}${ck(wka)}   (${kaH.toFixed(1)}/${kaA.toFixed(1)})`)
}
console.log("-".repeat(72))
console.log(`无ka : 方向 ${r0.dir}/${n}  精确 ${r0.ex}/${n}  RPS ${(r0.rps / n).toFixed(4)}`)
console.log(`有ka : 方向 ${r1.dir}/${n}  精确 ${r1.ex}/${n}  RPS ${(r1.rps / n).toFixed(4)}`)
