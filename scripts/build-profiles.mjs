// 从 DB 聚合每支球队的真实赛前画像 → 写 lib/team-profiles.json。
// data.ts 在 build 时读取此 JSON，把真实近期状态(formGD)等喂进预测引擎（断点1）。
// 重跑此脚本 + 重新 build = 用最新真实数据重算预测（断点3 的离线版）。
// 用法：node scripts/build-profiles.mjs
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
const outPath = path.join(__dirname, "..", "lib", "team-profiles.json")
const db = new Database(dbPath)

// 所有出现过的球队三字码
const codes = new Set()
for (const r of db.prepare("SELECT home_code, away_code FROM live_scores").all()) {
  if (r.home_code) codes.add(r.home_code)
  if (r.away_code) codes.add(r.away_code)
}

function profile(code) {
  const rows = db.prepare(
    `SELECT match_key, home_code, away_code, home_score, away_score
     FROM live_scores WHERE status = 'finished' AND (home_code = ? OR away_code = ?)`
  ).all(code, code)
  let w = 0, d = 0, l = 0, gf = 0, ga = 0, xgFor = 0, xgAg = 0, poss = 0, shots = 0, statN = 0
  const recent = []
  for (const r of rows) {
    const side = r.home_code === code ? "home" : "away"
    const my = (side === "home" ? r.home_score : r.away_score) ?? 0
    const opp = (side === "home" ? r.away_score : r.home_score) ?? 0
    gf += my; ga += opp
    if (my > opp) { w++; recent.push("W") } else if (my === opp) { d++; recent.push("D") } else { l++; recent.push("L") }
    const ms = db.prepare("SELECT * FROM match_stats WHERE match_key = ? AND side = ?").get(r.match_key, side)
    const os = db.prepare("SELECT * FROM match_stats WHERE match_key = ? AND side = ?").get(r.match_key, side === "home" ? "away" : "home")
    if (ms) {
      statN++
      if (ms.xg != null) xgFor += ms.xg
      if (os && os.xg != null) xgAg += os.xg
      if (ms.possession != null) poss += ms.possession
      if (ms.total_shots != null) shots += ms.total_shots
    }
  }
  const played = w + d + l
  return {
    played, wins: w, draws: d, losses: l, goalsFor: gf, goalsAgainst: ga,
    formGD: played ? +((gf - ga) / played).toFixed(2) : 0,
    recent,
    avgXgFor: statN ? +(xgFor / statN).toFixed(2) : null,
    avgXgAgainst: statN ? +(xgAg / statN).toFixed(2) : null,
    avgPossession: statN ? Math.round(poss / statN) : null,
    avgShots: statN ? +(shots / statN).toFixed(1) : null,
    statSamples: statN,
  }
}

// 全局画像（用于展示/关键因素）
const teams = {}
for (const c of [...codes].sort()) teams[c] = profile(c)

// 按比赛的「赛前 form」：只统计该队在本场开球【之前】已完赛的比赛，杜绝数据泄漏。
// 喂给预测模型 formHome/formAway，是真正可用于预测的真实近期状态。
function formBefore(code, beforeMs) {
  const rows = db.prepare(
    `SELECT match_key, home_code, away_code, home_score, away_score, kickoff_ms
     FROM live_scores WHERE status = 'finished' AND (home_code = ? OR away_code = ?) AND kickoff_ms < ?`
  ).all(code, code, beforeMs)
  let gf = 0, ga = 0, n = 0
  const recent = []
  for (const r of rows) {
    const side = r.home_code === code ? "home" : "away"
    const my = (side === "home" ? r.home_score : r.away_score) ?? 0
    const opp = (side === "home" ? r.away_score : r.home_score) ?? 0
    gf += my; ga += opp; n++
    recent.push(my > opp ? "W" : my === opp ? "D" : "L")
  }
  return { games: n, formGD: n ? +((gf - ga) / n).toFixed(2) : 0, recent }
}

const prematch = {}
for (const r of db.prepare("SELECT match_key, home_code, away_code, kickoff_ms FROM live_scores").all()) {
  if (!r.home_code || !r.away_code || r.kickoff_ms == null) continue
  prematch[r.match_key] = {
    home: formBefore(r.home_code, r.kickoff_ms),
    away: formBefore(r.away_code, r.kickoff_ms),
  }
}

// 核心球员可用性：核心球员是否出现在该场首发。缺阵核心的重要度之和 → 折算成"等效核心缺阵数"喂模型 kaHome/kaAway。
// 名字归一：去重音(NFD 拆分后剔除组合标记)、小写、去标点。修复 "Vinícius" vs "Vinicius" 这类误判缺阵。
const stripAccents = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
const norm = (s) => stripAccents(s).toLowerCase().replace(/[.\-']/g, " ").replace(/\s+/g, " ").trim()
const lastTok = (n) => { const t = norm(n).split(" "); return t[t.length - 1] || "" }
// 判定核心是否在首发：用归一化的姓氏集合匹配；再用全名 token 交集兜底（防缩写名/多段姓）。
function corePresent(coreName, xiNames, xiLastSet) {
  const cl = lastTok(coreName)
  if (cl && xiLastSet.has(cl)) return true
  const coreToks = new Set(norm(coreName).split(" ").filter((t) => t.length >= 3))
  for (const xn of xiNames) {
    const xt = norm(xn).split(" ").filter((t) => t.length >= 3)
    if (xt.some((t) => coreToks.has(t))) return true // 任一长度≥3的名段重合即视为同人
  }
  return false
}
// 本届"曾首发"集合：每队所有场次首发过的球员姓氏（用于区分真缺阵 vs 轮换）。
const TOURNAMENT_STARTERS = {}
for (const r of db.prepare("SELECT team_code, start_xi FROM lineups").all()) {
  TOURNAMENT_STARTERS[r.team_code] = TOURNAMENT_STARTERS[r.team_code] || new Set()
  for (const p of JSON.parse(r.start_xi || "[]")) TOURNAMENT_STARTERS[r.team_code].add(lastTok(p.name))
}

// 手工球星表（与 lib/star-players.ts 共用 lib/star-players.json）。
const starData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "lib", "star-players.json"), "utf8"))
const TIER_FLOOR = starData.tierFloor
function teamStars(teamCode) {
  const m = new Map()
  for (const s of starData.stars) if (s.teamCode === teamCode) m.set(s.key, { tier: s.tier, floor: TIER_FLOOR[String(s.tier)], display: s.display })
  return m
}
// 判某名球员是否匹配某归一化球星 key（姓氏或任一长度≥3名段）
function matchesStar(playerName, starKey) {
  const toks = norm(playerName).split(" ").filter((t) => t.length >= 3)
  const keyToks = norm(starKey).split(" ").filter((t) => t.length >= 3)
  if (!keyToks.length) return false
  if (keyToks.length === 1) return lastTok(playerName) === keyToks[0] || toks.includes(keyToks[0])
  return keyToks.every((t) => toks.includes(t))
}

// 三档可用性 ka（首发=0 / 替补席=轻惩罚×0.4 / 完全不在名单=全惩罚）。
// 同时输出每名球星/核心的明确状态供展示层（"亚马尔替补待命"）。
function coreAbsence(matchKey, side, teamCode) {
  const lu = db.prepare("SELECT start_xi, subs FROM lineups WHERE match_key = ? AND side = ?").get(matchKey, side)
  if (!lu) return { hasData: false, absentImp: 0, kaEquiv: 0, absent: [], stars: [] } // 未开赛/无阵容

  // 队内核心来源 = 俱乐部数据核心(≥0.80) ∪ 手工球星表(地板覆盖被埋没的国家队核心)
  const dbCores = db.prepare("SELECT name, importance_norm FROM players WHERE team_code = ? AND importance_norm >= 0.80").all(teamCode)
  const stars = teamStars(teamCode)
  const cores = dbCores.map((c) => ({ name: c.name, imp: c.importance_norm }))
  // 把球星表里的球员并入核心（取地板与俱乐部值的较大者，并标记 starKey/display）
  for (const [key, info] of stars) {
    const dbRow = db.prepare("SELECT name, importance_norm FROM players WHERE team_code = ? COLLATE NOCASE").all(teamCode)
      .find((p) => matchesStar(p.name, key))
    const name = dbRow ? dbRow.name : info.display
    const imp = Math.max(info.floor, dbRow ? dbRow.importance_norm : 0)
    const existing = cores.find((c) => matchesStar(c.name, key))
    if (existing) { existing.imp = Math.max(existing.imp, imp); existing.starKey = key; existing.tier = info.tier; existing.display = info.display }
    else cores.push({ name, imp, starKey: key, tier: info.tier, display: info.display })
  }
  if (!cores.length) return { hasData: false, absentImp: 0, kaEquiv: 0, absent: [], stars: [] }

  const xiNames = JSON.parse(lu.start_xi || "[]").map((p) => p.name)
  const subNames = JSON.parse(lu.subs || "[]").map((p) => p.name)
  const xiLastSet = new Set(xiNames.map(lastTok))
  const everStarted = TOURNAMENT_STARTERS[teamCode] || new Set()

  const starStatus = [] // 供展示：球星表里这队球员的逐人状态
  let absentImp = 0
  const absent = []
  for (const c of cores) {
    const inXi = corePresent(c.name, xiNames, xiLastSet)
    const onBench = !inXi && subNames.some((s) => corePresent(c.name, [s], new Set([lastTok(s)])))
    let status, w
    if (inXi) { status = "首发"; w = 0 }
    else if (onBench) { status = "替补待命"; w = c.imp * 0.4 } // 能下半场登场，轻惩罚
    else {
      // 不在首发也不在替补：可能真缺阵，或本届首发过的轮换(打3折)
      const rotated = everStarted.has(lastTok(c.name))
      status = rotated ? "轮换未登场" : "未进名单"
      w = rotated ? c.imp * 0.3 : c.imp
    }
    absentImp += w
    if (w > 0.2) absent.push(c.starKey ? c.display : c.name)
    if (c.starKey) starStatus.push({ display: c.display, tier: c.tier, status })
  }
  absentImp = Math.min(1.2, absentImp) // 收紧上限，削满权噪声尾巴
  return { hasData: true, absentImp: +absentImp.toFixed(2), kaEquiv: +absentImp.toFixed(2), absent, stars: starStatus }
}
for (const key of Object.keys(prematch)) {
  const r = db.prepare("SELECT home_code, away_code FROM live_scores WHERE match_key = ?").get(key)
  prematch[key].coreHome = coreAbsence(key, "home", r.home_code)
  prematch[key].coreAway = coreAbsence(key, "away", r.away_code)
}

fs.writeFileSync(outPath, JSON.stringify({ teams, prematch }, null, 2))
const withGames = Object.values(teams).filter((p) => p.played > 0).length
const withForm = Object.values(prematch).filter((m) => m.home.games > 0 || m.away.games > 0).length
const withCore = Object.values(prematch).filter((m) => m.coreHome?.hasData || m.coreAway?.hasData).length
console.log(`已写 ${outPath}：${Object.keys(teams).length} 队（${withGames} 队有数据），${Object.keys(prematch).length} 场赛前 form（${withForm} 场有样本），${withCore} 场有核心可用性数据`)
