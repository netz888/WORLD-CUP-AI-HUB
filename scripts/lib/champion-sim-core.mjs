// ---------------------------------------------------------------------------
// champion-sim-core.mjs —— 夺冠榜锦标赛蒙特卡洛模拟器（纯 node，无 tsx 依赖）。
//
// 数据来源：
//   · 引擎：lib/prediction-v2.ts 的 lambdasFromRanks（裸 node 可 import：其唯一 import 是会被
//     类型擦除的 type-only import）。零漂移复用全站同一套 v6 Elo λ 引擎。
//   · 结构：scripts/lib/wc-structure.json（由 scripts/gen-wc-structure.mts 从 lib/data.ts 生成）。
//
// 模型口径（与用户确认）：
//   · 已完赛 → 用真实比分锁死（积分/净胜球真实计入）。
//   · 进行中 + 未开赛 → 一律用赛前 Elo λ 泊松抽样（本期不接 predictInPlay）。
//   · 每组前 2 直接出线；12 个小组第三按 积分→净胜→进球 排序取前 8 进 32 强。
//   · 淘汰赛按席位单淘汰；平局以 λ 微倾斜的点球胜率决出（不模拟具体罚球）。
// 仅供娱乐，非投注建议。
// ---------------------------------------------------------------------------
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { lambdasFromRanks } from "./prediction-core.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
/** @type {{groups:string[],hostCodes:string[],teams:{code:string,rank:number,group:string}[],fixtures:{group:string,home:string,away:string,alt:number}[],knockout:{no:number,stage:string,homeSeat:string,awaySeat:string,alt:number}[],staticResults:Record<string,[number,number]>}} */
const STRUCT = require(path.join(__dirname, "wc-structure.json"))

const HOST = new Set(STRUCT.hostCodes)
const RANK = Object.fromEntries(STRUCT.teams.map((t) => [t.code, t.rank]))
const GROUP_OF = Object.fromEntries(STRUCT.teams.map((t) => [t.code, t.group]))
const TEAMS_IN_GROUP = {}
for (const t of STRUCT.teams) (TEAMS_IN_GROUP[t.group] ??= []).push(t.code)

function hostOf(home, away) {
  return HOST.has(home) ? "home" : HOST.has(away) ? "away" : "neutral"
}

// 泊松抽样（Knuth）。λ 较小（足球进球），循环次数可忽略。
function samplePoisson(lambda) {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= Math.random()
  } while (p > L)
  return k - 1
}

// 抽样一场比赛的比分（赛前 Elo λ）。返回 [homeGoals, awayGoals]。
function sampleMatch(home, away, alt) {
  const { lh, la } = lambdasFromRanks({
    rankHome: RANK[home] ?? 80,
    rankAway: RANK[away] ?? 80,
    host: hostOf(home, away),
    alt: alt ?? 0,
  })
  return [samplePoisson(lh), samplePoisson(la)]
}

// 淘汰赛：抽样 90 分钟比分，平局用 λ 微倾斜的点球胜率决出胜者。返回胜者 code。
function sampleKnockout(home, away, alt) {
  const [hg, ag] = sampleMatch(home, away, alt)
  if (hg > ag) return home
  if (ag > hg) return away
  // 平局 → 点球：以两队 λ 比例做轻度倾斜（强队略占优，但点球高随机）。
  const { lh, la } = lambdasFromRanks({
    rankHome: RANK[home] ?? 80,
    rankAway: RANK[away] ?? 80,
    host: hostOf(home, away),
    alt: alt ?? 0,
  })
  const pHome = 0.5 + 0.5 * ((lh - la) / (lh + la)) * 0.6 // 倾斜系数 0.6，避免过度自信
  return Math.random() < pHome ? home : away
}

// 小组名次排序键：积分→净胜→进球（与 lib/data.ts computeStandings 一致）。
// 末位用 rank 兜底打破完全相等（避免字母序偏置）。
function standingSorter(a, b) {
  if (b.pts !== a.pts) return b.pts - a.pts
  const agd = a.gf - a.ga
  const bgd = b.gf - b.ga
  if (bgd !== agd) return bgd - agd
  if (b.gf !== a.gf) return b.gf - a.gf
  return (RANK[a.code] ?? 80) - (RANK[b.code] ?? 80)
}

// 解析「最佳第三」席位的候选组集合，如 "C/E/F/H/I 组最佳第三" → ['C','E','F','H','I']
function parseBestThirdGroups(seat) {
  const m = seat.match(/^([A-L](?:\/[A-L])*)\s*组最佳第三/)
  if (!m) return null
  return m[1].split("/")
}
// 解析「X 组第 N」→ {group, rank}
function parseGroupRank(seat) {
  const m = seat.match(/^([A-L])\s*组第\s*([12])/)
  if (!m) return null
  return { group: m[1], rank: Number(m[2]) }
}
// 解析「第 N 场胜者/负者」
function parseRef(seat) {
  const m = seat.match(/^第\s*(\d+)\s*场(胜者|负者)/)
  if (!m) return null
  return { match: Number(m[1]), kind: m[2] === "胜者" ? "winner" : "loser" }
}

// 把 8 个出线的小组第三（按候选组约束）分配到 8 个「最佳第三」席位。
// FIFA 用固定 495 组合表；此处用「按候选组数升序的贪心约束匹配」近似（文档已标注）。
// thirds: Map<group, code>（仅含出线的 8 个组）。slots: [{key, groups:[...]}]。
// 返回 Map<slotKey, code>；失败时回退顺序填充。
function assignBestThirds(thirds, slots) {
  const assignment = {}
  const usedGroups = new Set()
  // 先按「可选组数量」升序（约束最紧的先分配），降低冲突。
  const order = [...slots].sort((a, b) => a.groups.length - b.groups.length)
  for (const slot of order) {
    const cand = slot.groups.filter((g) => thirds.has(g) && !usedGroups.has(g))
    if (cand.length) {
      // 在候选里选 rank 最强的第三名（稳定、可复现的偏好）
      cand.sort((g1, g2) => (RANK[thirds.get(g1)] ?? 80) - (RANK[thirds.get(g2)] ?? 80))
      const g = cand[0]
      assignment[slot.key] = thirds.get(g)
      usedGroups.add(g)
    }
  }
  // 兜底：仍有未分配 slot（约束匹配失败），用剩余第三名顺序填充。
  const leftover = [...thirds.entries()].filter(([g]) => !usedGroups.has(g)).map(([, c]) => c)
  let li = 0
  for (const slot of slots) {
    if (!assignment[slot.key] && li < leftover.length) assignment[slot.key] = leftover[li++]
  }
  return assignment
}

// 跑一次完整锦标赛。finished: Map<"HOME-AWAY", [h,a]>。返回 {code: 最远阶段}。
// 阶段编码：qualify(进32强)=1, r16=2, qf=3, sf=4, final=5, champ=6（数值越大越远）。
function simulateOnce(finished) {
  // ---- 1) 小组赛 ----
  const tables = {}
  for (const g of STRUCT.groups) {
    tables[g] = {}
    for (const code of TEAMS_IN_GROUP[g]) tables[g][code] = { code, pts: 0, gf: 0, ga: 0 }
  }
  for (const fx of STRUCT.fixtures) {
    const key = `${fx.home}-${fx.away}`
    const real = finished.get(key)
    const [hg, ag] = real ?? sampleMatch(fx.home, fx.away, fx.alt)
    const t = tables[fx.group]
    const H = t[fx.home]
    const A = t[fx.away]
    H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg
    if (hg > ag) H.pts += 3
    else if (ag > hg) A.pts += 3
    else { H.pts += 1; A.pts += 1 }
  }

  // ---- 2) 名次 ----
  const firsts = {} // group -> code
  const seconds = {} // group -> code
  const thirdsArr = [] // {code, group, pts, gf, ga}
  const reached = {} // code -> stageNum
  for (const g of STRUCT.groups) {
    const sorted = Object.values(tables[g]).sort(standingSorter)
    firsts[g] = sorted[0].code
    seconds[g] = sorted[1].code
    thirdsArr.push({ ...sorted[2], group: g })
    // 前 2 出线 → qualify
    reached[sorted[0].code] = 1
    reached[sorted[1].code] = 1
    reached[sorted[2].code] = 0
    reached[sorted[3].code] = 0
  }

  // ---- 3) 最佳 8 个第三名 ----
  const bestThirds = thirdsArr.sort(standingSorter).slice(0, 8)
  const thirdByGroup = new Map(bestThirds.map((t) => [t.group, t.code]))
  for (const t of bestThirds) reached[t.code] = 1 // 第三名出线也算 qualify

  // ---- 4) 淘汰赛 ----
  const bestThirdSlots = STRUCT.knockout
    .filter((k) => parseBestThirdGroups(k.awaySeat) || parseBestThirdGroups(k.homeSeat))
    .flatMap((k) => {
      const out = []
      const hg = parseBestThirdGroups(k.homeSeat)
      const ag = parseBestThirdGroups(k.awaySeat)
      if (hg) out.push({ key: `${k.no}-home`, groups: hg })
      if (ag) out.push({ key: `${k.no}-away`, groups: ag })
      return out
    })
  const slotAssign = assignBestThirds(thirdByGroup, bestThirdSlots)

  const winners = {} // matchNo -> code
  const losers = {} // matchNo -> code
  const stageNum = { R32: 1, R16: 2, QF: 3, SF: 4, "3RD": 4, FINAL: 5 }

  function resolveSeat(seat, matchNo, side) {
    const gr = parseGroupRank(seat)
    if (gr) return gr.rank === 1 ? firsts[gr.group] : seconds[gr.group]
    if (parseBestThirdGroups(seat)) return slotAssign[`${matchNo}-${side}`] ?? null
    const ref = parseRef(seat)
    if (ref) return ref.kind === "winner" ? winners[ref.match] : losers[ref.match]
    return null
  }

  for (const k of STRUCT.knockout) {
    const home = resolveSeat(k.homeSeat, k.no, "home")
    const away = resolveSeat(k.awaySeat, k.no, "away")
    if (!home || !away) continue // 理论上不会发生；防御
    // 记录进入该轮（home/away 至少到达本阶段）
    const sn = stageNum[k.stage]
    if (k.stage !== "3RD") {
      reached[home] = Math.max(reached[home] ?? 0, sn)
      reached[away] = Math.max(reached[away] ?? 0, sn)
    }
    const w = sampleKnockout(home, away, k.alt)
    const l = w === home ? away : home
    winners[k.no] = w
    losers[k.no] = l
    if (k.stage === "FINAL") reached[w] = 6 // 冠军
  }

  return reached
}

// 累加 nSims 次 → 各队各阶段到达频率（百分比）。
// 返回 Record<code, {champ, final, sf, qf, r16, qualify}>（均为 0~100 的百分数）。
export function simulate(finished, nSims = 20000) {
  const acc = {}
  for (const t of STRUCT.teams) acc[t.code] = { champ: 0, final: 0, sf: 0, qf: 0, r16: 0, qualify: 0 }
  for (let i = 0; i < nSims; i++) {
    const reached = simulateOnce(finished)
    for (const code in reached) {
      const s = reached[code]
      const a = acc[code]
      if (!a) continue
      if (s >= 1) a.qualify++
      if (s >= 2) a.r16++
      if (s >= 3) a.qf++
      if (s >= 4) a.sf++
      if (s >= 5) a.final++
      if (s >= 6) a.champ++
    }
  }
  const out = {}
  const pct = (n) => Math.round((n / nSims) * 1000) / 10 // 一位小数
  for (const code in acc) {
    const a = acc[code]
    out[code] = {
      champ: pct(a.champ),
      final: pct(a.final),
      sf: pct(a.sf),
      qf: pct(a.qf),
      r16: pct(a.r16),
      qualify: pct(a.qualify),
    }
  }
  return out
}

// 把 finished 结果集合（含静态 + live 覆盖）算成确定性哈希，用于「仅赛果变化时重算」。
// 仅纳入「已完赛且比分非空」的场次，排序后串联。
export function resultsHash(finishedMap) {
  const parts = [...finishedMap.entries()]
    .map(([k, v]) => `${k}:${v[0]}-${v[1]}`)
    .sort()
  return parts.join("|")
}

// 暴露结构里的静态赛果（无 poller 时的兜底种子）。
export function staticResultsMap() {
  const m = new Map()
  for (const [k, v] of Object.entries(STRUCT.staticResults)) m.set(k, v)
  return m
}

// 小组赛规范键集合：home-away（按赛程编排的主客顺序）。
const FIXTURE_KEYS = new Set(STRUCT.fixtures.map((f) => `${f.home}-${f.away}`))

// 合并「静态赛果 + live 库已完赛」→ 规范化的 finished Map（live 覆盖静态）。
// liveRows: [{ home_code, away_code, home_score, away_score }]（仅含已完赛、比分非空）。
// 朝向校正：若 live 的主客与赛程相反，则交换键与比分，保证比分朝向与 fixture.home/away 一致。
// 仅纳入属于小组赛赛程的场次（淘汰赛结果由模拟推演，不作为输入约束）。
export function buildFinished(liveRows) {
  const m = staticResultsMap()
  for (const r of liveRows ?? []) {
    if (r.home_code == null || r.away_code == null) continue
    if (r.home_score == null || r.away_score == null) continue
    const direct = `${r.home_code}-${r.away_code}`
    const rev = `${r.away_code}-${r.home_code}`
    if (FIXTURE_KEYS.has(direct)) {
      m.set(direct, [r.home_score, r.away_score])
    } else if (FIXTURE_KEYS.has(rev)) {
      m.set(rev, [r.away_score, r.home_score]) // 朝向校正
    }
    // 不在小组赛赛程内（淘汰赛/友谊）→ 忽略
  }
  return m
}

export const TEAM_CODES = STRUCT.teams.map((t) => t.code)
