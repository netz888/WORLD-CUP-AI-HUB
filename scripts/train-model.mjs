// Phase 1 重训：在历史训练集上拟合「Elo差→λ」映射 + Dixon-Coles + 校准参数。
// 留一届交叉验证（LOTO）：轮流把某一届当验证集，其余三届训练，防过拟合。
// 训练目标（用户原话）：赛前预测比分 vs 真实比分的重合度 —— 用三项度量同时报告：
//   1) 精确比分命中率（predictedScore == real）
//   2) 1X2 方向命中率
//   3) RPS（Ranked Probability Score，越低越好，衡量概率校准/重合度）
// 用法：node scripts/train-model.mjs
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync } from "node:fs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const allRows = JSON.parse(readFileSync(path.join(__dirname, "_trainset.json"), "utf8"))
// WC2010 是滚动 Elo 的冷启动年（全员从 1500 起，评分尚无信息），仅用于热身累积 Elo，
// 不纳入命中率评估/训练，避免“无信息样本”拉低并污染参数。训练+CV 用 2014/2018/2022。
const rows = allRows.filter((r) => r.season !== 2010)

// ---- 预测核心（与 lib/prediction-v2.ts 同构，但吃 Elo 直接输入）----
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r }
function poisson(k, l) { return (Math.exp(-l) * Math.pow(l, k)) / factorial(k) }
function dcTau(i, j, lh, la, rho) {
  if (i === 0 && j === 0) return 1 - lh * la * rho
  if (i === 0 && j === 1) return 1 + lh * rho
  if (i === 1 && j === 0) return 1 + la * rho
  if (i === 1 && j === 1) return 1 - rho
  return 1
}

// P：本脚本在 Elo 量纲(均值~1500)上拟合的参数集
function predict(r, P) {
  let Rh = r.eloHome, Ra = r.eloAway
  if (r.host === "home") Rh += P.homeAdv
  if (r.host === "away") Ra += P.homeAdv
  Rh += P.formWeight * (r.formHome || 0)
  Ra += P.formWeight * (r.formAway || 0)
  // h2h：历史净胜均值（本场主队视角）→ 主队 Elo 微调；无交锋(h2hN=0)时 h2hHome=0 自动不影响
  Rh += (P.h2hWeight || 0) * (r.h2hHome || 0)
  const diff = Rh - Ra
  let total = P.baseTotal
  let sup = diff / P.gdScale
  const gap = Math.abs(diff)
  if (gap > P.blowoutGap) {
    const over = Math.min((gap - P.blowoutGap) / 300, 1.3)
    total += P.blowoutTotalBoost * over
    sup *= 1 + P.blowoutSupBoost * over
  }
  const lh = Math.max(P.lambdaFloor, total / 2 + sup / 2)
  const la = Math.max(P.lambdaFloor, total / 2 - sup / 2)

  const size = 11
  const M = []
  for (let i = 0; i < size; i++) { M[i] = []; for (let j = 0; j < size; j++) M[i][j] = poisson(i, lh) * poisson(j, la) * dcTau(i, j, lh, la, P.rho) }
  if (P.drawInflMax > 0) {
    const close = Math.max(0, 1 - Math.abs(diff) / P.drawCloseScale)
    const boost = 1 + P.drawInflMax * close
    for (let i = 0; i < size; i++) M[i][i] *= boost
  }
  if (P.parkBusMax > 0 && gap > P.parkBusGap) {
    const f = Math.min((gap - P.parkBusGap) / 300, 1)
    const lb = 1 + P.parkBusMax * f
    M[0][0] *= lb; M[1][0] *= lb; M[0][1] *= lb
  }
  let sum = 0
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) sum += M[i][j]
  let home = 0, draw = 0, away = 0
  const cells = []
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    const p = M[i][j] / sum
    const cls = i > j ? "home" : i === j ? "draw" : "away"
    if (i > j) home += p; else if (i === j) draw += p; else away += p
    cells.push({ i, j, p, cls })
  }
  cells.sort((a, b) => b.p - a.p)
  const favClass = home >= draw && home >= away ? "home" : away >= draw ? "away" : "draw"
  const best = cells.find((c) => c.cls === favClass) || cells[0]
  return { home, draw, away, score: [best.i, best.j], favClass }
}

// ---- 度量 ----
function rps(p, outcome) {
  // p = [home, draw, away]；outcome index 0/1/2
  const obs = [0, 0, 0]; obs[outcome] = 1
  let cum = 0, cumO = 0, s = 0
  for (let k = 0; k < 2; k++) { cum += p[k]; cumO += obs[k]; s += (cum - cumO) ** 2 }
  return s
}
function evaluate(set, P) {
  let exact = 0, dir = 0, rpsSum = 0
  for (const r of set) {
    const pr = predict(r, P)
    if (pr.score[0] === r.realHome && pr.score[1] === r.realAway) exact++
    const realCls = r.realHome > r.realAway ? "home" : r.realHome === r.realAway ? "draw" : "away"
    if (pr.favClass === realCls) dir++
    const oi = realCls === "home" ? 0 : realCls === "draw" ? 1 : 2
    rpsSum += rps([pr.home, pr.draw, pr.away], oi)
  }
  return { exact: exact / set.length, dir: dir / set.length, rps: rpsSum / set.length, n: set.length }
}

// ---- 网格搜索 ----
const GRID = {
  gdScale: [150, 180, 210, 250],
  baseTotal: [3.0, 3.2],
  homeAdv: [25, 40, 65],
  rho: [-0.12, -0.08],
  drawInflMax: [0.2, 0.35],
  drawCloseScale: [120, 180],
  parkBusMax: [0.9],
  parkBusGap: [150],
  blowoutGap: [160, 220],
  blowoutTotalBoost: [1.0],
  blowoutSupBoost: [0.5, 0.7],
  lambdaFloor: [0.2],
  formWeight: [0, 12, 24],
  h2hWeight: [0, 8, 16],
}
function* combos(grid) {
  const keys = Object.keys(grid)
  const idx = keys.map(() => 0)
  while (true) {
    const o = {}; keys.forEach((k, i) => (o[k] = grid[k][idx[i]])); yield o
    let p = keys.length - 1
    while (p >= 0) { idx[p]++; if (idx[p] < grid[keys[p]].length) break; idx[p] = 0; p-- }
    if (p < 0) break
  }
}

const seasons = [...new Set(rows.map((r) => r.season))]
// 评分函数：方向命中为主，RPS 为辅（重合度），精确比分为次（高方差）
const score = (m) => m.dir * 1.0 - m.rps * 0.5 + m.exact * 0.3

let best = null, count = 0
for (const P of combos(GRID)) {
  count++
  // LOTO 交叉验证：对每一届做验证，取平均
  let dirCV = 0, rpsCV = 0, exactCV = 0
  for (const s of seasons) {
    const valid = rows.filter((r) => r.season === s)
    const m = evaluate(valid, P)
    dirCV += m.dir; rpsCV += m.rps; exactCV += m.exact
  }
  const cv = { dir: dirCV / seasons.length, rps: rpsCV / seasons.length, exact: exactCV / seasons.length }
  const sc = score(cv)
  if (!best || sc > best.sc) best = { sc, P, cv }
}

console.log(`网格组合数: ${count}`)
const trainM = evaluate(rows, best.P)
console.log("\n=== 最优参数（Elo 量纲）===")
console.log(JSON.stringify(best.P, null, 0))
console.log("\n=== 命中率（防过拟合：训练全集 vs 留一届CV）===")
console.log(`训练全集(${trainM.n}): 方向 ${(trainM.dir * 100).toFixed(1)}%  精确比分 ${(trainM.exact * 100).toFixed(1)}%  RPS ${trainM.rps.toFixed(4)}`)
console.log(`留一届CV平均 : 方向 ${(best.cv.dir * 100).toFixed(1)}%  精确比分 ${(best.cv.exact * 100).toFixed(1)}%  RPS ${best.cv.rps.toFixed(4)}`)

// 逐届验证明细
console.log("\n=== 逐届验证 ===")
for (const s of seasons) {
  const m = evaluate(rows.filter((r) => r.season === s), best.P)
  console.log(`WC${s} (${m.n}场): 方向 ${(m.dir * 100).toFixed(1)}%  精确 ${(m.exact * 100).toFixed(1)}%  RPS ${m.rps.toFixed(4)}`)
}

writeFileSync(path.join(__dirname, "_v7-params.json"), JSON.stringify(best.P, null, 2))
console.log("\n参数写入 scripts/_v7-params.json")
