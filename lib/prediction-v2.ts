// ---------------------------------------------------------------------------
// prediction-v2.ts —— 世界杯 Elo 多因子预测引擎 v6（与 skill 的 learning/backtest.mjs 同源）
//
// 学习闭环结论（详见 skill: worldcup-deep-analysis/learning/calibration-log.md）：
//   v3：排名→评分→λ→Dixon-Coles + 平局校准 + 屠杀拉伸。验证集 1X2 45.5%→54.5%。
//   v4：加多因子（海拔/核心缺阵/近期状态）→ 修正有效评分。
//   v5：实力改用 Elo，训练样本翻倍（2018+2022=96 场），留一届交叉验证。
//   v6：训练样本扩到 ~200 场（2010+2014+2018+2022 小组赛=192 场，全部真实赛果），
//       同时报告【训练集 vs 验证集】命中率以检验过拟合。网格确认 v5 参数仍最优（数值不变）。
//
// v6 关键发现（直接回应“能不能靠拟合更准”）：
//   训练集(192场)精确比分命中 16.1%、验证集/交叉验证 16.7%——两者几乎相等。
//   → 证明①模型没有过拟合、学到的是真实规律；②精确比分 ~16-17% 是这套赛前特征的物理上限，
//     即便允许“拟合”，训练集自己也上不去（同样实力下真实比分本就是高方差随机事件）。
//   1X2 方向命中稳定在 ~55%。想再提升只能引入赔率/确认首发等赛前额外信息，且空间有限。
//
// 诚实声明：精确比分命中存在物理上限（顶级模型单场约 9-12%）。本引擎 ~16-17% 已接近上限，
//   不可能“基本都对”。衡量准度应看方向命中与概率校准(Brier/LogLoss)。仅供娱乐，非投注建议。
// ---------------------------------------------------------------------------

import type { ScoreProb } from "./data"

// 与 learning/backtest.mjs 的 V6 参数保持一致（改这里 = 再训练）。网格确认与 v5 数值相同。
export const V6_PARAMS = {
  gdScale: 280, // Elo 评分差 → 期望净胜球 [grid-best]
  baseTotal: 2.9, // 基准期望总进球 [grid-best]
  homeAdv: 65, // 东道主/准主场 Elo 加成
  rho: -0.12, // Dixon-Coles 低比分相关性
  drawInflMax: 0.2, // WS1：0.55→0.20（192 场训练实测最优；旧 0.55 过强，把 0-0/2-2 顶到前排、拉低命中）
  drawCloseScale: 200, // |Elo 差| 达到该值时平局加成归零（Elo 量纲）
  parkBusMax: 0.8, // “摆大巴”：强弱悬殊时低比分(0-0/1-0)膨胀上限 [grid-validated]
  parkBusGap: 250, // Elo 差超过该值才触发摆大巴修正
  blowoutGap: 200, // Elo 差超过该值视为强弱悬殊 [grid-best]
  blowoutTotalBoost: 1.0, // 悬殊时总进球上调
  blowoutSupBoost: 0.7, // 悬殊时净胜球额外放大 [grid-best]
  lambdaFloor: 0.2,
  // —— 多因子权重（Elo 点）——
  altWeight: 90, // 高原(>1500m)对未适应一方的 Elo 惩罚
  kaWeight: 45, // 每名核心首发缺阵的 Elo 扣减
  formWeight: 20, // 近期状态(净胜球趋势)对 Elo 的影响
}
// 兼容旧引用
export const V5_PARAMS = V6_PARAMS
export const V4_PARAMS = V6_PARAMS
export const V3_PARAMS = V6_PARAMS

// ---------------------------------------------------------------------------
// V7 参数（2026-06 历史全量重训：2010-2022 共 192 场小组赛 + 留一届交叉验证）。
// 训练在标准 Elo 量纲（均值~1500、跨度~298）得到原始参数（见 scripts/_v7-params.json）；
// 本引擎用 rankToElo 量纲（跨度~537），故「Elo 点」类参数需 ×K_SCALE(=537/298≈1.80) 换算；
// 无量纲参数（baseTotal/rho/drawInflMax/parkBus*/blowout*Boost/lambdaFloor）原样保留。
// altWeight/kaWeight 为本引擎多因子项（训练集无覆盖），V7 沿用 V6 标定值；
// h2hWeight 训练判定为 0（历史交锋样本太稀，不入比分预测），本引擎本就无该项，丢弃。
//
// 全量评估（scripts/compare-v6-v7-all.mjs，DB 内 20 场已完赛，rank/host/alt 同源、隔离参数）：
//   方向命中 V6 55% / V7 50%；精确比分 V6 3 / V7 2；平均 RPS V6 0.1804 / V7 0.1769。
//   → 基本打平：V7 概率校准(RPS)略优、更不过度自信；V6 argmax 方向略高，且与页面赛后复盘文案一致。
//   决策：accuracy 打平时默认保持 V6（不破坏既有展示/lesson 文案；改动最小、可逆），V7 一键可切。
// ---------------------------------------------------------------------------
export const V7_PARAMS = {
  gdScale: 270, // 150 ×1.80
  baseTotal: 3.2,
  homeAdv: 72, // 40 ×1.80
  rho: -0.08,
  drawInflMax: 0.2, // 192 场实测最优（V6 的 0.55 过强，反而拉低命中）
  drawCloseScale: 216, // 120 ×1.80
  parkBusMax: 0.9,
  parkBusGap: 270, // 150 ×1.80
  blowoutGap: 288, // 160 ×1.80
  blowoutTotalBoost: 1.0,
  blowoutSupBoost: 0.5,
  lambdaFloor: 0.2,
  altWeight: 90, // 本引擎多因子项，沿用 V6
  kaWeight: 45, // 本引擎多因子项，沿用 V6
  formWeight: 22, // 12 ×1.80
}

// 引擎默认参数开关：false = 保持 V6（默认）；true = 全站切到 V7。改这一行即可切换/回滚。
// 切到 V7 前请同步修订 V2_CALIB 中与 V7 输出矛盾的 lesson 文案（如 BRA-MAR/NED-JPN/AUS-TUR）。
export const USE_V7 = false
export const ACTIVE_PARAMS = USE_V7 ? V7_PARAMS : V6_PARAMS

function factorial(n: number): number {
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}
function poisson(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k)
}
function dcTau(i: number, j: number, lh: number, la: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lh * la * rho
  if (i === 0 && j === 1) return 1 + lh * rho
  if (i === 1 && j === 0) return 1 + la * rho
  if (i === 1 && j === 1) return 1 - rho
  return 1
}

export type V2Input = {
  rankHome: number
  rankAway: number
  host?: "home" | "away" | "neutral"
  // —— 多因子（可选，缺省即不触发）——
  alt?: number // 场地海拔(米)，>1500 视为高原
  kaHome?: number // 主队核心首发缺阵数
  kaAway?: number // 客队核心首发缺阵数
  formHome?: number // 主队近期状态：场均净胜球趋势（约 -3..3）
  formAway?: number // 客队近期状态
  // —— B1：真实场均 xG 收缩融合（可选，缺省即 w=0=纯排名）——
  xgHome?: number // 主队"本届攻防 xG"推得的 λ（已含对手被攻 xG），见 data.ts
  xgAway?: number // 客队同理
  nHome?: number // 主队本届此前样本场数（决定收缩权重）
  nAway?: number // 客队本届此前样本场数
}

// B1 收缩权重 w = n/(n+K_SHRINK)：0 场→纯排名，样本越多越靠真实火力
const K_SHRINK = 2.5

export type MarginBuckets = {
  homeBy2Plus: number // 主赢 2+ 球
  homeBy1: number // 主赢 1 球
  draw: number // 平
  awayBy1: number // 客赢 1 球
  awayBy2Plus: number // 客赢 2+ 球
}

export type Markets = {
  homeOrDraw: number // 主不败（双重机会 1X）
  awayOrDraw: number // 客不败（双重机会 X2）
  homeOrAway: number // 不平（12）
  over15: number // 大 1.5 球
  over25: number // 大 2.5 球
  btts: number // 双方进球
}

export type V2Output = {
  homeWin: number // 整数百分比，三者和=100
  draw: number
  awayWin: number
  confidence: number
  egHome: number // 模型 λ（期望进球）
  egAway: number
  predictedScore: string // "i - j"
  scoreProbs: ScoreProb[] // top6，整数百分比
  over25: number
  bttRatio: number
  blowoutProb: number // P(净胜≥3)，整数百分比 —— "屠杀概率"
  expMargin: number // 期望净胜球（主-客）
  // —— 冷门风险（A 段：显性化尾部概率，绝不让冷门“连榜都上不了”）——
  upsetProb: number // 冷门发生概率（整数%）：热门方“不赢”的合计 = 1 - P(热门胜)
  upsetLabel: string // 冷门情形文字，如“佛得角逼平或爆冷”
  upsetScore: string // 最可能的冷门比分（弱队不输的格子里概率最高者），如“0 - 0”
  // —— WS1：盘口主导展示 ——
  marginBuckets: MarginBuckets // 按净胜球差归并（整数%，五者和=100）
  markets: Markets // 衍生盘口（整数%）
  topInsight: { label: string; prob: number } | null // 最有把握的一句话判断（≥60% 才给）
}

// 文档化的 排名→Elo 单调变换，量纲对齐 2018 真实 Elo 分布（顶≈2080、第50≈1747、第80≈1543）
function rankToElo(rank: number): number {
  return 2080 - (Math.max(1, rank) - 1) * 6.8
}

// 由排名 + 多因子 → 两队“有效实力(Elo)”（含东道主/海拔/缺阵/近期状态）
export function effectiveRatings(input: V2Input, P = ACTIVE_PARAMS): { Rh: number; Ra: number } {
  let Rh = rankToElo(input.rankHome)
  let Ra = rankToElo(input.rankAway)
  const host = input.host ?? "neutral"
  // 1) 东道主/准主场
  if (host === "home") Rh += P.homeAdv
  if (host === "away") Ra += P.homeAdv
  // 2) 海拔：高原(>1500m)对未适应一方不利；东道主默认已适应主场海拔，惩罚对手
  const alt = input.alt ?? 0
  if (alt > 1500) {
    const f = Math.min((alt - 1500) / 1500, 1)
    if (host === "home") Ra -= P.altWeight * f
    else if (host === "away") Rh -= P.altWeight * f
    else {
      Rh -= P.altWeight * f * 0.5
      Ra -= P.altWeight * f * 0.5
    }
  }
  // 3) 核心缺阵
  Rh -= P.kaWeight * (input.kaHome ?? 0)
  Ra -= P.kaWeight * (input.kaAway ?? 0)
  // 4) 近期状态（净胜球趋势）
  Rh += P.formWeight * (input.formHome ?? 0)
  Ra += P.formWeight * (input.formAway ?? 0)
  return { Rh, Ra }
}

// 由有效评分 → 校准后的 λ_home, λ_away
export function lambdasFromRanks(
  input: V2Input,
  P = ACTIVE_PARAMS,
): { lh: number; la: number; ratingDiff: number } {
  const { Rh, Ra } = effectiveRatings(input, P)

  const diff = Rh - Ra
  let total = P.baseTotal
  let sup = diff / P.gdScale

  // 屠杀拉伸：强弱悬殊时强队更倾向多进、净胜更大
  const gap = Math.abs(diff)
  if (gap > P.blowoutGap) {
    const over = Math.min((gap - P.blowoutGap) / 300, 1.3)
    total += P.blowoutTotalBoost * over
    sup *= 1 + P.blowoutSupBoost * over
  }

  const lh = Math.max(P.lambdaFloor, total / 2 + sup / 2)
  const la = Math.max(P.lambdaFloor, total / 2 - sup / 2)

  // B1：真实场均 xG 收缩融合。w = n/(n+K)，0 场→纯排名（=现状）。
  const wH = input.xgHome != null && input.nHome ? input.nHome / (input.nHome + K_SHRINK) : 0
  const wA = input.xgAway != null && input.nAway ? input.nAway / (input.nAway + K_SHRINK) : 0
  const fh = Math.max(P.lambdaFloor, lh * (1 - wH) + (input.xgHome ?? lh) * wH)
  const fa = Math.max(P.lambdaFloor, la * (1 - wA) + (input.xgAway ?? la) * wA)
  return { lh: fh, la: fa, ratingDiff: diff }
}

// 三项四舍五入后强制和为 100（误差给最大项）
function normalizeTo100(h: number, d: number, a: number): [number, number, number] {
  let rh = Math.round(h)
  let rd = Math.round(d)
  let ra = Math.round(a)
  const diff = 100 - (rh + rd + ra)
  if (diff !== 0) {
    const max = Math.max(rh, rd, ra)
    if (max === rh) rh += diff
    else if (max === rd) rd += diff
    else ra += diff
  }
  return [rh, rd, ra]
}

export function predictV2(input: V2Input, P = ACTIVE_PARAMS): V2Output {
  const { lh, la, ratingDiff } = lambdasFromRanks(input, P)
  const size = 11

  const M: number[][] = []
  for (let i = 0; i < size; i++) {
    M[i] = []
    for (let j = 0; j < size; j++) {
      M[i][j] = poisson(i, lh) * poisson(j, la) * dcTau(i, j, lh, la, P.rho)
    }
  }
  // 平局校准：势均力敌时抬高对角线
  if (P.drawInflMax > 0) {
    const closeness = Math.max(0, 1 - Math.abs(ratingDiff) / P.drawCloseScale)
    const boost = 1 + P.drawInflMax * closeness
    for (let i = 0; i < size; i++) M[i][i] *= boost
  }
  // “摆大巴”校准：强弱悬殊时弱队龟缩死守 → 低比分/冷平比标准泊松更常见。
  // 对总进球 ≤1 的格子(0-0,1-0,0-1)按 Elo 差膨胀，gap 越大越强（封顶）。已在 192 场+CV 上验证。
  if (P.parkBusMax > 0) {
    const gap = Math.abs(ratingDiff)
    if (gap > P.parkBusGap) {
      const f = Math.min((gap - P.parkBusGap) / 300, 1)
      const lowBoost = 1 + P.parkBusMax * f
      M[0][0] *= lowBoost
      M[1][0] *= lowBoost
      M[0][1] *= lowBoost
    }
  }
  let sum = 0
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) sum += M[i][j]
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) M[i][j] /= sum

  let home = 0
  let draw = 0
  let away = 0
  let over25 = 0
  let btts = 0
  let blowout = 0
  let expMargin = 0
  let over15 = 0
  // 归并桶累加器（净胜球差）
  let hb2 = 0
  let hb1 = 0
  let ab1 = 0
  let ab2 = 0
  const cells: { score: string; prob: number; cls: "home" | "draw" | "away" }[] = []
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = M[i][j]
      const cls = i > j ? "home" : i === j ? "draw" : "away"
      if (i > j) home += p
      else if (i === j) draw += p
      else away += p
      if (i + j > 2.5) over25 += p
      if (i + j > 1.5) over15 += p
      if (i >= 1 && j >= 1) btts += p
      if (Math.abs(i - j) >= 3) blowout += p
      expMargin += (i - j) * p
      // 归并桶
      const m = i - j
      if (m >= 2) hb2 += p
      else if (m === 1) hb1 += p
      else if (m === -1) ab1 += p
      else if (m <= -2) ab2 += p
      cells.push({ score: `${i} - ${j}`, prob: p, cls })
    }
  }
  cells.sort((a, b) => b.prob - a.prob)

  const [homeWin, drawPct, awayWin] = normalizeTo100(home * 100, draw * 100, away * 100)
  const scoreProbs: ScoreProb[] = cells.slice(0, 6).map((c) => ({ score: c.score, prob: Math.round(c.prob * 100) }))

  // 最可能比分：取与最高 1X2 结果一致类别下的最可能比分，避免"主队 60% 胜却显示 1-1"的割裂感。
  // 用未取整的原始概率判定 favClass，避免四舍五入产生平手伪影（与回测脚本一致）。
  const favClass: "home" | "draw" | "away" =
    home >= draw && home >= away ? "home" : away >= draw ? "away" : "draw"
  const predictedScore = (cells.find((c) => c.cls === favClass) ?? cells[0]).score

  // —— 冷门风险（A 段）——
  // 若有明确热门（主或客），冷门 = 热门“不赢”的概率；势均力敌(favClass=draw)则无单一冷门方。
  const favProb = favClass === "home" ? home : favClass === "away" ? away : Math.max(home, away)
  const upsetProb = favClass === "draw" ? Math.round((1 - Math.max(home, away)) * 100) : Math.round((1 - favProb) * 100)
  // 冷门情形描述（以热门方视角；具体队名由前端拼接）
  const underdog = favClass === "home" ? "away" : favClass === "away" ? "home" : "away"
  const upsetLabel =
    favClass === "draw"
      ? "任一方打破均势"
      : underdog === "away"
        ? "客队逼平或爆冷"
        : "主队逼平或爆冷"
  // 最可能的冷门比分：热门方“不赢”的格子里概率最高者（含平局与弱队取胜）
  const upsetCell = cells.find((c) => c.cls !== favClass) ?? cells[0]
  const upsetScore = upsetCell.score

  // —— WS1：归并桶（五者四舍五入后强制和=100，误差给最大桶）——
  const rawB = [hb2, hb1, draw, ab1, ab2].map((x) => x * 100)
  const rB = rawB.map((x) => Math.round(x))
  const dB = 100 - rB.reduce((s, x) => s + x, 0)
  if (dB !== 0) {
    const mi = rB.indexOf(Math.max(...rB))
    rB[mi] += dB
  }
  const marginBuckets: MarginBuckets = {
    homeBy2Plus: rB[0],
    homeBy1: rB[1],
    draw: rB[2],
    awayBy1: rB[3],
    awayBy2Plus: rB[4],
  }
  const markets: Markets = {
    homeOrDraw: Math.round((home + draw) * 100),
    awayOrDraw: Math.round((away + draw) * 100),
    homeOrAway: Math.round((home + away) * 100),
    over15: Math.round(over15 * 100),
    over25: Math.round(over25 * 100),
    btts: Math.round(btts * 100),
  }
  // 最有把握的一句话判断：候选盘口里取概率最高且 ≥60% 者；接近场无强判断则 null。
  // label 为语义码，前端拼接队名渲染文案。
  const insightCandidates: { label: string; prob: number }[] = [
    { label: "home_unbeaten", prob: markets.homeOrDraw },
    { label: "away_unbeaten", prob: markets.awayOrDraw },
    { label: "home_by2", prob: marginBuckets.homeBy2Plus },
    { label: "away_by2", prob: marginBuckets.awayBy2Plus },
    { label: "over25", prob: markets.over25 },
    { label: "btts", prob: markets.btts },
  ]
  const best = insightCandidates.reduce((a, b) => (b.prob > a.prob ? b : a))
  const topInsight = best.prob >= 60 ? best : null

  return {
    homeWin,
    draw: drawPct,
    awayWin,
    confidence: Math.max(homeWin, drawPct, awayWin),
    egHome: +lh.toFixed(2),
    egAway: +la.toFixed(2),
    predictedScore,
    scoreProbs,
    over25: Math.round(over25 * 100),
    bttRatio: Math.round(btts * 100),
    blowoutProb: Math.round(blowout * 100),
    expMargin: +expMargin.toFixed(2),
    upsetProb,
    upsetLabel,
    upsetScore,
    marginBuckets,
    markets,
    topInsight,
  }
}

// ---------------------------------------------------------------------------
// 校准注册表：哪些比赛用 v5 重算（11 场已完赛 + 4 场未开赛）
// finished 场次附真实比分 real:[home,away] 与一句赛后复盘 lesson。
// host：2026 东道主美/墨/加在小组赛享主场；其余中立。排名取赛前 FIFA 排名。
// ---------------------------------------------------------------------------
export type CalibEntry = V2Input & {
  real?: [number, number]
  lesson?: string
}

export const V2_CALIB: Record<string, CalibEntry> = {
  // —— 已完赛（11 场，含赛后复盘）——
  "MEX-RSA": { rankHome: 15, rankAway: 61, host: "home", alt: 2240, real: [2, 0], lesson: "东道主 + 排名优势 + 墨西哥城 2240m 高原（v5 海拔因子额外压制客队），主胜约 83% 且预测 2-0，与真实 2-0 完全一致。" },
  "KOR-CZE": { rankHome: 22, rankAway: 44, host: "neutral", real: [2, 1], lesson: "中等强弱差，模型 维持主胜（约 50%）并命中走势；真实 2-1。" },
  "USA-PAR": { rankHome: 14, rankAway: 39, host: "home", real: [4, 1], lesson: "东道主 + 排名鸿沟，模型 主胜约 60% 且 P(屠杀) 升至约 19%；真实 4-1 仍超模型中枢，印证强打弱易爆大比分。" },
  "CAN-BIH": { rankHome: 27, rankAway: 74, host: "home", real: [1, 1], lesson: "纸面一边倒（模型 主胜约 77%、P(屠杀) 35%）却 1-1 被逼平——真·爆冷，模型与市场均难预见。" },
  "QAT-SUI": { rankHome: 51, rankAway: 17, host: "neutral", real: [1, 1], lesson: "瑞士被卡塔尔逼平的冷门；v3 仍偏向瑞士（客胜约 63%），属低估弱旅韧性的个案。" },
  "BRA-MAR": { rankHome: 6, rankAway: 11, host: "neutral", real: [1, 1], lesson: "势均力敌（主胜 37% / 平 31% / 客胜 32%，三者接近），模型未给单边强判断；真实 1-1，落在概率最密集的平局区间。" },
  "HAI-SCO": { rankHome: 83, rankAway: 36, host: "neutral", real: [0, 1], lesson: "苏格兰实力占优，模型 客胜约 68% 并预测小球低比分，与 0-1 一致。" },
  "AUS-TUR": { rankHome: 26, rankAway: 25, host: "neutral", real: [2, 0], lesson: "两队几乎等强（主胜 34% / 平 31% / 客胜 35%，无明显热门）；真实澳大利亚 2-0，属均势局里的单边爆发，三结果都在合理区间内。" },
  "GER-CUW": { rankHome: 9, rankAway: 82, host: "neutral", real: [7, 1], lesson: "排名鸿沟最大的一场，模型 主胜约 90%、λ 升至 3.4+、P(屠杀) 54% 并预测 3-0；真实 7-1 仍属极端尾部，说明屠杀上不封顶。" },
  "CIV-ECU": { rankHome: 42, rankAway: 23, host: "neutral", real: [1, 0], lesson: "厄瓜多尔纸面更强，模型 仍偏向客胜；科特迪瓦 1-0 爆冷，属动机型逆转的个案。" },
  "NED-JPN": { rankHome: 7, rankAway: 18, host: "neutral", real: [2, 2], lesson: "实力接近，模型 微偏荷兰（主胜 41% / 平 30% / 客胜 29%）；真实 2-2 打平，平局概率虽非最高但仍占近三成，属均势局的常见结局。" },

  // —— 未开赛（4 场，用 v5 重算；排名同步 2026-06 快照）——
  "ESP-CPV": { rankHome: 2, rankAway: 67, host: "neutral" },
  "KSA-URU": { rankHome: 61, rankAway: 16, host: "neutral" },
  "BEL-EGY": { rankHome: 9, rankAway: 29, host: "neutral" },
  "SWE-TUN": { rankHome: 38, rankAway: 45, host: "neutral" },
}

export function getV2(key: string): (V2Output & { real?: [number, number]; lesson?: string }) | null {
  const e = V2_CALIB[key]
  if (!e) return null
  const out = predictV2(e)
  return { ...out, real: e.real, lesson: e.lesson }
}
