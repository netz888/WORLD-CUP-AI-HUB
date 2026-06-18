// ---------------------------------------------------------------------------
// in-play.ts —— 赛中实时预测引擎（纯函数，可在客户端运行）
//
// 设计：复用赛前引擎（prediction-v2）已烘焙好的 λ（match.detail.xgHome/xgAway），
// 只对"剩余时间"做泊松推演，再叠加当前真实比分。在此基础上施加三类赛中动态修正：
//   1) 时间衰减：剩余时间越少，可再进球的期望越低 → 比分随时间自然锁定。
//   2) 红/黄牌：少一人方剩余 λ 收缩、对方略升；黄牌作为谨慎弱信号小幅压低。
//   3) 比分效应：领先方趋于收缩、落后方压上，强度随比赛临近结束而放大。
// 剩余进球用 Dixon-Coles（沿用 V6 的 rho）做联合分布，最终比分 = 当前比分 + 剩余推演。
//
// 与全站一致：纯数学、可复现、零 AI 推理、零后端负载。仅供娱乐，非投注建议。
// ---------------------------------------------------------------------------

import { ACTIVE_PARAMS } from "./prediction-v2"

const REG_MINUTES = 90 // 常规结束分钟（小组赛无加时）

// —— 赛中修正常数（保守标定，可解释优先）——
const RED_SELF = 0.72 // 每张自方红牌：自方剩余 λ 乘子
const RED_OPP = 1.08 // 每张对方红牌：自方剩余 λ 乘子（多打一人略增）
const YELLOW_CAUTION = 0.012 // 每张黄牌的谨慎压低（最多计 4 张），弱信号
const STATE_MAX_INTENSITY = 0.28 // 比分效应最大强度（rem→0 时达到）

// —— 场面权重（实时技术统计）修正 ——
// 用控球率/射门/射正/xG/角球合成「进攻压力指数」，占优方剩余 λ 上调、劣势方下调。
// 平衡档：最大 ±25%，且强度随样本量（射门+角球总数）增长，开场数据少时几乎不影响。
const FIELD_MAX = 0.25 // 平衡档最大乘子偏移（占优方最多 ×1.25 / 劣势方 ×0.75）
const FIELD_SAMPLE_FULL = 14 // 双方射门+角球达此数视为样本充分（强度满）
// 压力指数权重（xG 信息量最高，控球率最低）
const PW_XG = 1.0
const PW_SOT = 0.45 // 射正
const PW_SHOT = 0.12 // 射门
const PW_COR = 0.08 // 角球
const PW_POSS = 0.015 // 控球率（每 1% 贡献）

function factorial(n: number): number {
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}
function poisson(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k)
}
function dcTau(i: number, j: number, lh: number, la: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lh * la * rho
  if (i === 0 && j === 1) return 1 + lh * rho
  if (i === 1 && j === 0) return 1 + la * rho
  if (i === 1 && j === 1) return 1 - rho
  return 1
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// 单侧进攻压力指数：xG 信息量最高，控球率最低。缺失字段按 0 计。
function pressureIndex(s: FieldStatInput): number {
  const xg = Math.max(0, s.xg ?? 0)
  const sot = Math.max(0, s.shotsOnTarget ?? 0)
  const shot = Math.max(0, s.shotsTotal ?? 0)
  const cor = Math.max(0, s.corners ?? 0)
  const poss = clamp(s.possession ?? 50, 0, 100)
  return PW_XG * xg + PW_SOT * sot + PW_SHOT * shot + PW_COR * cor + PW_POSS * poss
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

export type InPlayInput = {
  lambdaPreHome: number // 赛前模型期望进球（match.detail.xgHome）
  lambdaPreAway: number // match.detail.xgAway
  minute: number // 当前比赛分钟（中场休息按 45）
  homeScore: number
  awayScore: number
  redHome?: number
  redAway?: number
  yellowHome?: number
  yellowAway?: number
  // 实时技术统计（任一侧缺失则跳过场面权重修正）
  stats?: {
    home: FieldStatInput
    away: FieldStatInput
  }
}

// 场面权重所需的单侧统计（全部可空，缺失按 0 计）
export type FieldStatInput = {
  possession?: number | null
  shotsTotal?: number | null
  shotsOnTarget?: number | null
  xg?: number | null
  corners?: number | null
}

export type InPlayOutput = {
  homeWin: number // 整数%，三者和=100（指最终结果）
  draw: number
  awayWin: number
  confidence: number // = max(三者)
  finalScore: string // 最可能最终比分 "i - j"
  topFinals: { score: string; prob: number }[] // top4 最终比分（整数%）
  homeScoreMore: number // 主队后续还会再进球的概率（整数%）
  awayScoreMore: number
  lambdaRemHome: number // 剩余时间期望进球（保留两位）
  lambdaRemAway: number
  remPct: number // 剩余时间占比（整数%）
  lean: "home" | "draw" | "away" // 当前倾向（按最高最终结果）
  modifiers: {
    redHome: number
    redAway: number
    yellowHome: number
    yellowAway: number
    stateEffect: "home_defend" | "away_defend" | "none" // 谁在收缩护分
    stateIntensity: number // 0-100 整数，比分效应强度
    // 场面权重（无实时统计时 field.active=false）
    field: {
      active: boolean // 是否参与了本次修正
      homeShare: number // 主队进攻压力占比，0-100 整数
      lean: "home" | "away" | "even" // 场面偏向哪边
      intensity: number // 0-100 整数，实际生效强度（含样本量缩放）
    }
  }
}

export function predictInPlay(input: InPlayInput, P = ACTIVE_PARAMS): InPlayOutput {
  const redHome = input.redHome ?? 0
  const redAway = input.redAway ?? 0
  const yellowHome = input.yellowHome ?? 0
  const yellowAway = input.yellowAway ?? 0
  const gh = Math.max(0, Math.floor(input.homeScore))
  const ga = Math.max(0, Math.floor(input.awayScore))

  // 1) 时间衰减
  const rem = clamp((REG_MINUTES - input.minute) / REG_MINUTES, 0, 1)
  let lh = Math.max(0, input.lambdaPreHome) * rem
  let la = Math.max(0, input.lambdaPreAway) * rem

  // 2) 红牌：自方红牌压低自方、对方红牌略升自方
  lh *= Math.pow(RED_SELF, redHome) * Math.pow(RED_OPP, redAway)
  la *= Math.pow(RED_SELF, redAway) * Math.pow(RED_OPP, redHome)

  // 2b) 黄牌谨慎（弱信号）：每张小幅压低自方，最多计 4 张
  lh *= 1 - YELLOW_CAUTION * Math.min(yellowHome, 4)
  la *= 1 - YELLOW_CAUTION * Math.min(yellowAway, 4)

  // 3) 比分效应：领先方收缩、落后方压上，强度随比赛临近结束放大
  const lead = gh - ga
  const intensity = STATE_MAX_INTENSITY * (1 - rem)
  const g = Math.min(Math.abs(lead), 2) / 2 // 1 球差=0.5，2+ 球差=1
  let stateEffect: InPlayOutput["modifiers"]["stateEffect"] = "none"
  if (lead > 0) {
    lh *= 1 - intensity * g
    la *= 1 + intensity * g
    stateEffect = "home_defend"
  } else if (lead < 0) {
    la *= 1 - intensity * g
    lh *= 1 + intensity * g
    stateEffect = "away_defend"
  }

  // 4) 场面权重（实时技术统计）：占优方剩余 λ 上调、劣势方下调。
  //    强度随样本量缩放——开场射门/角球少时几乎不影响，数据足时才显著。
  let fieldActive = false
  let fieldHomeShare = 50
  let fieldLean: "home" | "away" | "even" = "even"
  let fieldIntensity = 0
  if (input.stats) {
    const ph = pressureIndex(input.stats.home)
    const pa = pressureIndex(input.stats.away)
    const total = ph + pa
    if (total > 0) {
      const share = ph / total // 主队压力占比 0-1
      // 样本量：双方射门+角球总数，越多越可信
      const sample =
        Math.max(0, input.stats.home.shotsTotal ?? 0) +
        Math.max(0, input.stats.away.shotsTotal ?? 0) +
        Math.max(0, input.stats.home.corners ?? 0) +
        Math.max(0, input.stats.away.corners ?? 0)
      const sampleScale = clamp(sample / FIELD_SAMPLE_FULL, 0, 1)
      // 偏离 0.5 的幅度（-1..1），乘最大强度与样本缩放
      const tilt = (share - 0.5) * 2 // 主队占优为正
      const eff = tilt * FIELD_MAX * sampleScale // 实际乘子偏移
      lh *= 1 + eff
      la *= 1 - eff
      fieldActive = sampleScale > 0
      fieldHomeShare = Math.round(share * 100)
      fieldLean = share > 0.55 ? "home" : share < 0.45 ? "away" : "even"
      fieldIntensity = Math.round(Math.abs(eff) * 100)
    }
  }

  lh = Math.max(0, lh)
  la = Math.max(0, la)

  // 剩余进球联合分布（Dixon-Coles，沿用 V6 的 rho）
  const size = 8
  const M: number[][] = []
  for (let i = 0; i < size; i++) {
    M[i] = []
    for (let j = 0; j < size; j++) {
      M[i][j] = poisson(i, lh) * poisson(j, la) * dcTau(i, j, lh, la, P.rho)
    }
  }
  let sum = 0
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) sum += M[i][j]
  if (sum > 0) for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) M[i][j] /= sum

  // 累加最终结果（最终比分 = 当前比分 + 剩余推演）
  let home = 0
  let draw = 0
  let away = 0
  let pHome0 = 0 // 主队后续 0 球的概率
  let pAway0 = 0
  const finals: { score: string; prob: number }[] = []
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = M[i][j]
      const fh = gh + i
      const fa = ga + j
      if (fh > fa) home += p
      else if (fh === fa) draw += p
      else away += p
      if (i === 0) pHome0 += p
      if (j === 0) pAway0 += p
      finals.push({ score: `${fh} - ${fa}`, prob: p })
    }
  }

  // 合并相同最终比分（不同剩余 i/j 不会映射到同一最终比分，这里仅排序）
  finals.sort((a, b) => b.prob - a.prob)

  const [homeWin, drawPct, awayWin] = normalizeTo100(home * 100, draw * 100, away * 100)
  const lean: InPlayOutput["lean"] =
    home >= draw && home >= away ? "home" : away >= draw ? "away" : "draw"
  // 最可能最终比分：取与当前倾向一致类别下概率最高者，避免割裂
  const favCell =
    finals.find((c) => {
      const [fh, fa] = c.score.split(" - ").map(Number)
      const cls = fh > fa ? "home" : fh === fa ? "draw" : "away"
      return cls === lean
    }) ?? finals[0]

  const topFinals = finals.slice(0, 4).map((c) => ({ score: c.score, prob: Math.round(c.prob * 100) }))

  return {
    homeWin,
    draw: drawPct,
    awayWin,
    confidence: Math.max(homeWin, drawPct, awayWin),
    finalScore: favCell.score,
    topFinals,
    homeScoreMore: Math.round((1 - pHome0) * 100),
    awayScoreMore: Math.round((1 - pAway0) * 100),
    lambdaRemHome: +lh.toFixed(2),
    lambdaRemAway: +la.toFixed(2),
    remPct: Math.round(rem * 100),
    lean,
    modifiers: {
      redHome,
      redAway,
      yellowHome,
      yellowAway,
      stateEffect,
      stateIntensity: Math.round(intensity * g * 100),
      field: {
        active: fieldActive,
        homeShare: fieldHomeShare,
        lean: fieldLean,
        intensity: fieldIntensity,
      },
    },
  }
}
