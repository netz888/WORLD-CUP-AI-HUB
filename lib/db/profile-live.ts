import "server-only"
import { sqliteRaw } from "./client"
import { getTeamProfile } from "./team-profile"
import starData from "../star-players.json"

// 请求时实时画像（Phase 3 断点3）：把 build-profiles.mjs 的 form/ka/球星状态逻辑搬到运行时，
// 直接读最新 DB → 官方阵容一入库，下次访问预测即自动重算，无需重跑脚本或重 build。
// 与 scripts/build-profiles.mjs 保持同一套算法；离线 team-profiles.json 仅作 DB 不可用时的回退。

export type LiveForm = { games: number; formGD: number; recent: string[] }
export type StarStatus = { display: string; tier: number; status: string }
export type LiveCore = { hasData: boolean; kaEquiv: number; absent: string[]; stars: StarStatus[] }
export type LiveProfile = {
  home: LiveForm
  away: LiveForm
  coreHome: LiveCore
  coreAway: LiveCore
  // B1：真实场均 xG 推得的 λ + 样本数（无 match_stats 样本则为 undefined/0）。
  xgLambdaHome?: number
  xgLambdaAway?: number
  nHome?: number
  nAway?: number
  realXgForHome?: number
  realXgForAway?: number
}

// —— 名字归一（必须与 build-profiles.mjs / star-players.ts 完全一致）——
const stripAccents = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
const norm = (s: string) => stripAccents(s).toLowerCase().replace(/[.\-']/g, " ").replace(/\s+/g, " ").trim()
const lastTok = (n: string) => { const t = norm(n).split(" "); return t[t.length - 1] || "" }

function corePresent(coreName: string, xiNames: string[], xiLastSet: Set<string>) {
  const cl = lastTok(coreName)
  if (cl && xiLastSet.has(cl)) return true
  const coreToks = new Set(norm(coreName).split(" ").filter((t) => t.length >= 3))
  for (const xn of xiNames) {
    const xt = norm(xn).split(" ").filter((t) => t.length >= 3)
    if (xt.some((t) => coreToks.has(t))) return true
  }
  return false
}
function matchesStar(playerName: string, starKey: string) {
  const toks = norm(playerName).split(" ").filter((t) => t.length >= 3)
  const keyToks = norm(starKey).split(" ").filter((t) => t.length >= 3)
  if (!keyToks.length) return false
  if (keyToks.length === 1) return lastTok(playerName) === keyToks[0] || toks.includes(keyToks[0])
  return keyToks.every((t) => toks.includes(t))
}

const TIER_FLOOR = starData.tierFloor as Record<string, number>
type StarRow = { key: string; teamCode: string; tier: number; display: string }
function teamStars(teamCode: string) {
  const m = new Map<string, { tier: number; floor: number; display: string }>()
  for (const s of starData.stars as StarRow[]) {
    if (s.teamCode === teamCode) m.set(s.key, { tier: s.tier, floor: TIER_FLOOR[String(s.tier)], display: s.display })
  }
  return m
}

type LiveScoreRow = { match_key: string; home_code: string; away_code: string; home_score: number | null; away_score: number | null; kickoff_ms: number | null; status: string }
type PlayerRow = { name: string; importance_norm: number }

// 赛前 form：仅统计本场开球之前已完赛的比赛（无数据泄漏）。
function formBefore(code: string, beforeMs: number): LiveForm {
  const rows = sqliteRaw
    .prepare(`SELECT home_code, away_code, home_score, away_score FROM live_scores
      WHERE status = 'finished' AND (home_code = ? OR away_code = ?) AND kickoff_ms < ?`)
    .all(code, code, beforeMs) as LiveScoreRow[]
  let gf = 0, ga = 0, n = 0
  const recent: string[] = []
  for (const r of rows) {
    const side = r.home_code === code ? "home" : "away"
    const my = (side === "home" ? r.home_score : r.away_score) ?? 0
    const opp = (side === "home" ? r.away_score : r.home_score) ?? 0
    gf += my; ga += opp; n++
    recent.push(my > opp ? "W" : my === opp ? "D" : "L")
  }
  return { games: n, formGD: n ? +((gf - ga) / n).toFixed(2) : 0, recent }
}

// 本届"曾首发"集合（区分真缺阵 vs 轮换）。每次请求构建一次，量小可接受。
function tournamentStarters(teamCode: string): Set<string> {
  const set = new Set<string>()
  const rows = sqliteRaw.prepare("SELECT start_xi FROM lineups WHERE team_code = ?").all(teamCode) as { start_xi: string }[]
  for (const r of rows) for (const p of JSON.parse(r.start_xi || "[]")) set.add(lastTok(p.name))
  return set
}

// 三档可用性 ka（首发=0 / 替补待命×0.4 / 未进名单=全惩罚；轮换×0.3；上限1.2）+ 球星逐人状态。
function coreAbsence(matchKey: string, side: "home" | "away", teamCode: string): LiveCore {
  const lu = sqliteRaw.prepare("SELECT start_xi, subs FROM lineups WHERE match_key = ? AND side = ?").get(matchKey, side) as
    | { start_xi: string; subs: string | null }
    | undefined
  if (!lu) return { hasData: false, kaEquiv: 0, absent: [], stars: [] }

  const dbCores = sqliteRaw.prepare("SELECT name, importance_norm FROM players WHERE team_code = ? AND importance_norm >= 0.80").all(teamCode) as PlayerRow[]
  const teamPlayers = sqliteRaw.prepare("SELECT name, importance_norm FROM players WHERE team_code = ?").all(teamCode) as PlayerRow[]
  const stars = teamStars(teamCode)
  type Core = { name: string; imp: number; starKey?: string; tier?: number; display?: string }
  const cores: Core[] = dbCores.map((c) => ({ name: c.name, imp: c.importance_norm }))
  for (const [key, info] of stars) {
    const dbRow = teamPlayers.find((p) => matchesStar(p.name, key))
    const name = dbRow ? dbRow.name : info.display
    const imp = Math.max(info.floor, dbRow ? dbRow.importance_norm : 0)
    const existing = cores.find((c) => matchesStar(c.name, key))
    if (existing) { existing.imp = Math.max(existing.imp, imp); existing.starKey = key; existing.tier = info.tier; existing.display = info.display }
    else cores.push({ name, imp, starKey: key, tier: info.tier, display: info.display })
  }
  if (!cores.length) return { hasData: false, kaEquiv: 0, absent: [], stars: [] }

  const xiNames: string[] = JSON.parse(lu.start_xi || "[]").map((p: { name: string }) => p.name)
  const subNames: string[] = JSON.parse(lu.subs || "[]").map((p: { name: string }) => p.name)
  const xiLastSet = new Set(xiNames.map(lastTok))
  const everStarted = tournamentStarters(teamCode)

  const starStatus: StarStatus[] = []
  let absentImp = 0
  const absent: string[] = []
  for (const c of cores) {
    const inXi = corePresent(c.name, xiNames, xiLastSet)
    const onBench = !inXi && subNames.some((s) => corePresent(c.name, [s], new Set([lastTok(s)])))
    let status: string, w: number
    if (inXi) { status = "首发"; w = 0 }
    else if (onBench) { status = "替补待命"; w = c.imp * 0.4 }
    else {
      const rotated = everStarted.has(lastTok(c.name))
      status = rotated ? "轮换未登场" : "未进名单"
      w = rotated ? c.imp * 0.3 : c.imp
    }
    absentImp += w
    if (w > 0.2) absent.push(c.starKey ? c.display! : c.name)
    if (c.starKey) starStatus.push({ display: c.display!, tier: c.tier!, status })
  }
  absentImp = Math.min(1.2, absentImp)
  return { hasData: true, kaEquiv: +absentImp.toFixed(2), absent, stars: starStatus }
}

// 请求时计算某场两队的实时画像。DB 无该场/异常时返回 null（调用方回退静态 JSON）。
export function getLiveProfile(matchKey: string): LiveProfile | null {
  try {
    const ls = sqliteRaw.prepare("SELECT home_code, away_code, kickoff_ms FROM live_scores WHERE match_key = ?").get(matchKey) as
      | { home_code: string; away_code: string; kickoff_ms: number | null }
      | undefined
    if (!ls || !ls.home_code || !ls.away_code) return null
    const beforeMs = ls.kickoff_ms ?? Date.now()
    // B1：本届真实 xG → λ。homeProfile.avgXgFor=主队场均造 xG；awayProfile.avgXgAgainst=客队场均被造 xG。
    // λ_xg(主) = (主队攻 xG + 客队被攻 xG)/2，客队对称。仅两端各自有样本时才给对应 λ/n。
    const hp = getTeamProfile(ls.home_code, matchKey)
    const ap = getTeamProfile(ls.away_code, matchKey)
    const xgLambdaHome =
      hp.avgXgFor != null && ap.avgXgAgainst != null ? +((hp.avgXgFor + ap.avgXgAgainst) / 2).toFixed(2) : undefined
    const xgLambdaAway =
      ap.avgXgFor != null && hp.avgXgAgainst != null ? +((ap.avgXgFor + hp.avgXgAgainst) / 2).toFixed(2) : undefined
    return {
      home: formBefore(ls.home_code, beforeMs),
      away: formBefore(ls.away_code, beforeMs),
      coreHome: coreAbsence(matchKey, "home", ls.home_code),
      coreAway: coreAbsence(matchKey, "away", ls.away_code),
      // 收缩样本数用「有 xG 统计的场数」(statSamples)，无统计的场不参与 B1 融合。
      xgLambdaHome,
      xgLambdaAway,
      nHome: hp.statSamples,
      nAway: ap.statSamples,
      realXgForHome: hp.avgXgFor ?? undefined,
      realXgForAway: ap.avgXgFor ?? undefined,
    }
  } catch {
    return null
  }
}
