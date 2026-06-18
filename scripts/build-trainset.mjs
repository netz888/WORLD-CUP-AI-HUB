// Phase 1 历史训练集采集（真·全量重训的数据底座）。
// 拉 league=1（FIFA 世界杯）2010/2014/2018/2022 全部真实赛果，
// 用「真实比赛结果」自洽地滚动计算 Elo（不依赖任何外部排名快照），
// 并算每队赛前近期状态 form（本届此前场均净胜球），输出训练集 JSON。
//
// 诚实边界：
//  - 历史无球员重要度 → 无法重建 ka（核心缺阵），ka 权重只能在 2026 已完赛集上调；
//  - 历史无 xG → 攻防强度历史用进球派生；
//  - Elo 为「仅用真实赛果」的滚动评分，2010/2014 作热身、2018/2022 作训练+交叉验证。
//
// 用法：API_FOOTBALL_KEY=... node scripts/build-trainset.mjs
// 产出：scripts/_trainset.json （供 train-model.mjs 读取）
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeFileSync } from "node:fs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEYS = await getApiKeys()
const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"
const DELAY = Number(KEYS.API_FOOTBALL_DELAY_MS || 1500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastAt = 0

async function api(q) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = Math.max(0, lastAt + DELAY - Date.now())
    if (wait > 0) await sleep(wait)
    lastAt = Date.now()
    let res, j
    try { res = await fetch(BASE + q, { headers: { "x-apisports-key": KEY } }); j = await res.json() }
    catch (e) { if (attempt < 5) { console.log(`  ⏳ 网络异常(${e.message})重试`); await sleep(3000); continue } throw e }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
    if (!hasErr) return j
    const t = JSON.stringify(errs)
    if (t.includes("rateLimit") && attempt < 5) { console.log("  ⏳ rate limit 65s"); await sleep(65000); continue }
    throw new Error(`API error ${q}: ${t}`)
  }
}

// 东道主（用于 host 加成的真实标注）
const HOST_NATION = { 2010: "South Africa", 2014: "Brazil", 2018: "Russia", 2022: "Qatar" }
const SEASONS = [2010, 2014, 2018, 2022]

async function main() {
  // 1) 拉四届全部 fixtures（每届 1 次调用）
  const all = []
  for (const season of SEASONS) {
    const j = await api(`/fixtures?league=1&season=${season}`)
    const fs = (j.response || []).filter((f) => f.goals.home != null && f.goals.away != null)
    for (const f of fs) {
      all.push({
        season,
        ts: f.fixture.timestamp,
        date: f.fixture.date,
        round: f.league.round,
        home: f.teams.home.name,
        away: f.teams.away.name,
        gh: f.goals.home,
        ga: f.goals.away,
        venueCity: f.fixture.venue?.city || "",
      })
    }
    console.log(`WC${season}: ${fs.length} 场真实赛果`)
  }
  // 2) 按真实时间排序，全局滚动 Elo（仅用真实赛果）
  all.sort((a, b) => a.ts - b.ts)
  const elo = new Map()
  const get = (t) => (elo.has(t) ? elo.get(t) : 1500)
  // 每届赛前各队的近期状态（本届此前场均净胜球）
  const formAcc = new Map() // key season|team -> {gd, n}
  const fkey = (s, t) => `${s}|${t}`
  // 赛前 h2h：两队在本数据集内此前真实交锋的净胜球均值（时间有序，绝不含本场，防泄漏）。
  const h2hAcc = new Map() // key sorted "A|B" -> [{gdForA, ...}]，存以字典序首队视角的净胜
  const pkey = (a, b) => [a, b].sort().join("|")

  const rows = []
  for (const m of all) {
    const Rh = get(m.home)
    const Ra = get(m.away)
    // 赛前 form（本届此前）
    const fh = formAcc.get(fkey(m.season, m.home)) || { gd: 0, n: 0 }
    const fa = formAcc.get(fkey(m.season, m.away)) || { gd: 0, n: 0 }
    const formH = fh.n ? fh.gd / fh.n : 0
    const formA = fa.n ? fa.gd / fa.n : 0
    // host 标注
    const hn = HOST_NATION[m.season]
    const host = m.home === hn ? "home" : m.away === hn ? "away" : "neutral"

    // 赛前 h2h：本场主队视角的历史净胜球均值（>0 = 主队历史压制；无交锋=0）
    const pk = pkey(m.home, m.away)
    const hist = h2hAcc.get(pk) || []
    const firstTeam = pk.split("|")[0] // 字典序首队
    let h2hHome = 0
    if (hist.length) {
      const sum = hist.reduce((s, g) => s + g, 0) / hist.length // 首队视角净胜均值
      h2hHome = m.home === firstTeam ? sum : -sum // 转到本场主队视角
    }

    rows.push({
      season: m.season,
      date: m.date,
      round: m.round,
      home: m.home,
      away: m.away,
      eloHome: Math.round(Rh),
      eloAway: Math.round(Ra),
      host,
      formHome: +formH.toFixed(3),
      formAway: +formA.toFixed(3),
      h2hHome: +h2hHome.toFixed(3),
      h2hN: hist.length,
      realHome: m.gh,
      realAway: m.ga,
    })

    // —— 赛后更新 Elo（标准 Elo + 净胜球放大 + 东道主主场修正）——
    const K = 40
    const hAdj = host === "home" ? 65 : host === "away" ? -65 : 0
    const exp = 1 / (1 + Math.pow(10, -((Rh + hAdj) - Ra) / 400))
    const res = m.gh > m.ga ? 1 : m.gh === m.ga ? 0.5 : 0
    const gd = Math.abs(m.gh - m.ga)
    const mult = Math.log(Math.max(gd, 1) + 1) // 净胜球越大，更新幅度越大
    const delta = K * mult * (res - exp)
    elo.set(m.home, Rh + delta)
    elo.set(m.away, Ra - delta)
    // 更新 form 累计
    formAcc.set(fkey(m.season, m.home), { gd: fh.gd + (m.gh - m.ga), n: fh.n + 1 })
    formAcc.set(fkey(m.season, m.away), { gd: fa.gd + (m.ga - m.gh), n: fa.n + 1 })
    // 更新 h2h 累计（首队视角净胜球）
    const ft = pk.split("|")[0]
    const gdFirst = m.home === ft ? m.gh - m.ga : m.ga - m.gh
    h2hAcc.set(pk, [...(h2hAcc.get(pk) || []), gdFirst])
  }

  const out = path.join(__dirname, "_trainset.json")
  writeFileSync(out, JSON.stringify(rows, null, 0))
  console.log(`\n训练集写入 ${out}：${rows.length} 场`)
  // 抽样校验
  const s22 = rows.filter((r) => r.season === 2022)
  console.log(`WC2022 ${s22.length} 场；Elo 区间 [${Math.min(...s22.map((r) => Math.min(r.eloHome, r.eloAway)))}, ${Math.max(...s22.map((r) => Math.max(r.eloHome, r.eloAway)))}]`)
  const fin = s22.find((r) => /Final$/.test(r.round) || r.round.includes("Final"))
  if (fin) console.log("样例(决赛?):", fin.home, fin.eloHome, "vs", fin.away, fin.eloAway, "→", fin.realHome, "-", fin.realAway, "host", fin.host)
}
main()
