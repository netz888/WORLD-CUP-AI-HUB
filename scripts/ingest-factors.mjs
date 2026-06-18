// 关键因素对比 + 伤停 入库脚本。
// 思路：整合每场的真实数据（API-Football 赛果统计 /fixtures/statistics + 伤停 /injuries
//       + 本地 DB 已入库的真实阵容/主帅/裁判），喂给智谱 GLM 生成「关键因素对比」对比行，入库缓存。
//       前台只读缓存，零实时 AI 调用。
// 用法：API_FOOTBALL_KEY=... GLM_API_KEY=... node scripts/ingest-factors.mjs [match_key ...]
//       不带参数 = 处理所有已入库阵容的比赛。
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { getApiKeys, requireKey } from "../config/secrets/index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const KEYS = await getApiKeys()
const API_KEY = await requireKey("API_FOOTBALL_KEY")
const GLM_KEY = await requireKey("GLM_API_KEY")
const GLM_BASE = KEYS.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4/chat/completions"
const GLM_MODEL = KEYS.GLM_MODEL || "glm-4-flash"

const API_BASE = "https://v3.football.api-sports.io"
const API_DELAY_MS = Number(KEYS.API_FOOTBALL_DELAY_MS || 1500)
let lastApiAt = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// API-Football 英文国名/队名 → 中文（仅用于喂 prompt，让 AI 输出更准）。
const TEAM_ZH = {
  Germany: "德国", "Curaçao": "库拉索", Brazil: "巴西", Morocco: "摩洛哥",
  Mexico: "墨西哥", "South Africa": "南非", "South Korea": "韩国", Czechia: "捷克",
  Canada: "加拿大", "Bosnia & Herzegovina": "波黑", USA: "美国", Paraguay: "巴拉圭",
  Qatar: "卡塔尔", Switzerland: "瑞士", Haiti: "海地", Scotland: "苏格兰",
  Australia: "澳大利亚", "Türkiye": "土耳其", Netherlands: "荷兰", Japan: "日本",
  "Ivory Coast": "科特迪瓦", Ecuador: "厄瓜多尔", Sweden: "瑞典", Tunisia: "突尼斯",
  Belgium: "比利时", Egypt: "埃及", "Saudi Arabia": "沙特", Uruguay: "乌拉圭",
  Iran: "伊朗", "New Zealand": "新西兰", Spain: "西班牙", "Cape Verde Islands": "佛得角",
}
const teamZh = (en) => TEAM_ZH[en] || en

// 主教练英文 → 中文（与 lib/db/player-names-zh.ts 保持一致）。
const COACH_ZH = {
  "Javier Aguirre": "阿吉雷", "Hugo Broos": "布鲁斯", "Myung-Bo Hong": "洪明甫",
  "Miroslav Koubek": "库贝克", "Jesse Marsch": "马尔什", "Sergej Barbarez": "巴尔巴雷兹",
  "Mauricio Pochettino": "波切蒂诺", "Gustavo Alfaro": "阿尔法罗", "Julen Lopetegui": "洛佩特吉",
  "Murat Yakin": "亚金", "Carlo Ancelotti": "安切洛蒂", "Mohamed Ouahbi": "瓦赫比",
  "Sebastien Migne": "米涅", "Steve Clarke": "克拉克", "Tony Popovic": "波波维奇",
  "Vincenzo Montella": "蒙特拉", "Julian Nagelsmann": "纳格尔斯曼", "Dick Advocaat": "阿德沃卡特",
  "Ronald Koeman": "科曼", "Hajime Moriyasu": "森保一", "Emerse Fae": "法埃",
  "Sebastian Beccacece": "贝卡塞塞", "Amir Ghalenoei": "加莱诺伊", "D. Bazeley": "巴泽利",
  "Graham Potter": "波特", "Sabri Lamouchi": "拉穆希", "Luis de la Fuente": "德拉富恩特",
  "Pedro Leitao Brito": "莱唐·布里托", "Rudi Garcia": "鲁迪·加西亚", "Hossam Hassan": "侯萨姆·哈桑",
  "Georgios Donis": "多尼斯", "Marcelo Bielsa": "比尔萨",
}
const coachZh = (en) => COACH_ZH[en] || en

async function apiFootball(q) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = Math.max(0, lastApiAt + API_DELAY_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastApiAt = Date.now()
    let res, j
    try {
      res = await fetch(API_BASE + q, { headers: { "x-apisports-key": API_KEY } })
      j = await res.json()
    } catch (e) {
      if (attempt < 5) { console.log(`  ⏳ 网络异常(${e.message})，3s 后重试 ${q}`); await sleep(3000); continue }
      throw new Error(`network error ${q}: ${e.message}`)
    }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
    if (!hasErr) return j
    const t = JSON.stringify(errs)
    if (t.includes("rateLimit") && attempt < 5) { console.log(`  ⏳ rate limit，65s 后重试`); await sleep(65000); continue }
    throw new Error(`API error ${q}: ${t}`)
  }
}

async function glm(messages) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(GLM_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + GLM_KEY },
        body: JSON.stringify({ model: GLM_MODEL, messages, temperature: 0.3, max_tokens: 1500 }),
      })
      const j = await res.json()
      if (j.error) throw new Error(JSON.stringify(j.error))
      const content = j.choices?.[0]?.message?.content
      if (!content) throw new Error("空响应: " + JSON.stringify(j).slice(0, 200))
      return content
    } catch (e) {
      if (attempt < 4) { console.log(`  ⏳ GLM 异常(${e.message})，4s 后重试`); await sleep(4000); continue }
      throw e
    }
  }
}

// 从可能含 ```json 围栏的文本里提取 JSON 数组
function parseJsonArray(text) {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf("[")
  const end = t.lastIndexOf("]")
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
db.exec(`CREATE TABLE IF NOT EXISTS match_factors (
  match_key TEXT NOT NULL, seq INTEGER NOT NULL,
  label TEXT NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL, edge TEXT NOT NULL,
  as_of TEXT NOT NULL, PRIMARY KEY (match_key, seq)
)`)
db.exec(`CREATE TABLE IF NOT EXISTS injuries (
  match_key TEXT NOT NULL, seq INTEGER NOT NULL,
  side TEXT NOT NULL, team_code TEXT NOT NULL,
  player TEXT NOT NULL, pos TEXT, status TEXT NOT NULL, note TEXT,
  as_of TEXT NOT NULL, PRIMARY KEY (match_key, seq)
)`)
// 标记某场已跑过 factors/injuries（即便 0 条伤停，也要记录"已检查"，前台才显示"齐整"）。
db.exec(`CREATE TABLE IF NOT EXISTS factors_meta (
  match_key TEXT PRIMARY KEY, injuries_checked INTEGER NOT NULL DEFAULT 0, as_of TEXT NOT NULL
)`)

const delFactors = db.prepare("DELETE FROM match_factors WHERE match_key = ?")
const insFactor = db.prepare(`INSERT INTO match_factors (match_key, seq, label, home, away, edge, as_of)
  VALUES (@match_key, @seq, @label, @home, @away, @edge, @as_of)`)
const delInj = db.prepare("DELETE FROM injuries WHERE match_key = ?")
const insInj = db.prepare(`INSERT INTO injuries (match_key, seq, side, team_code, player, pos, status, note, as_of)
  VALUES (@match_key, @seq, @side, @team_code, @player, @pos, @status, @note, @as_of)`)
const upMeta = db.prepare(`INSERT INTO factors_meta (match_key, injuries_checked, as_of)
  VALUES (@match_key, 1, @as_of) ON CONFLICT(match_key) DO UPDATE SET injuries_checked=1, as_of=excluded.as_of`)

// 伤停状态映射
function injStatus(type, reason) {
  const s = `${type || ""} ${reason || ""}`.toLowerCase()
  if (s.includes("questionable") || s.includes("doubt")) return "存疑"
  return "缺阵" // Missing Fixture / Injured / Suspended 等
}
const REASON_ZH = {
  "Knee Injury": "膝伤", "Muscle Injury": "肌肉伤", "Ankle Injury": "踝伤",
  "Thigh Injury": "大腿伤", "Hamstring": "腿筋伤", "Calf Injury": "小腿伤",
  "Knock": "碰撞伤", "Illness": "疾病", "Suspended": "停赛", "Red Card Suspension": "红牌停赛",
  "Coach's decision": "教练决定", "Broken ankle": "踝部骨折", "Groin Injury": "腹股沟伤",
  "Foot Injury": "脚伤", "Back Injury": "背伤", "Shoulder Injury": "肩伤", "Fitness": "体能",
}
const reasonZh = (r) => REASON_ZH[r] || r || "未知"

function getStat(stats, type) {
  const f = (stats || []).find((s) => s.type === type)
  return f ? f.value : null
}

async function processMatch(matchKey, now) {
  const lus = db.prepare("SELECT side, team_code, team_name, formation, coach, fixture_id, start_xi, subs FROM lineups WHERE match_key = ?").all(matchKey)
  if (lus.length < 2) { console.log(`· ${matchKey} 阵容不全，跳过`); return false }
  const home = lus.find((l) => l.side === "home")
  const away = lus.find((l) => l.side === "away")
  if (!home || !away) { console.log(`· ${matchKey} 缺主/客阵容，跳过`); return false }
  const fid = home.fixture_id || away.fixture_id
  const score = db.prepare("SELECT home_score, away_score, status FROM live_scores WHERE match_key = ?").get(matchKey)
  const ref = db.prepare("SELECT name, nat, avg_yellow, avg_red, penalty_rate FROM referees WHERE match_key = ?").get(matchKey)

  // 真实赛果统计
  let homeStats = null, awayStats = null
  try {
    const st = await apiFootball(`/fixtures/statistics?fixture=${fid}`)
    for (const t of st.response || []) {
      if (t.team?.name === home.team_name) homeStats = t.statistics
      else if (t.team?.name === away.team_name) awayStats = t.statistics
    }
  } catch (e) { console.log(`  ⚠ ${matchKey} 统计抓取失败: ${e.message}`) }

  // 真实伤停
  let injRows = []
  try {
    const inj = await apiFootball(`/injuries?fixture=${fid}`)
    let seq = 0
    const xiPos = {}
    for (const l of [home, away]) {
      for (const p of [...JSON.parse(l.start_xi || "[]"), ...JSON.parse(l.subs || "[]")]) xiPos[p.name] = p.pos
    }
    for (const it of inj.response || []) {
      const side = it.team?.name === home.team_name ? "home" : "away"
      injRows.push({
        match_key: matchKey, seq: seq++, side,
        team_code: side === "home" ? home.team_code : away.team_code,
        player: it.player?.name || "未知",
        pos: xiPos[it.player?.name] || it.player?.position || "",
        status: injStatus(it.player?.type, it.player?.reason),
        note: reasonZh(it.player?.reason || it.player?.type),
        as_of: now,
      })
    }
  } catch (e) { console.log(`  ⚠ ${matchKey} 伤停抓取失败: ${e.message}`) }

  // 事件时间线（进球时段/点球/红牌/换人），用于让 AI 看到"比赛怎么打的"。
  const evRows = db.prepare("SELECT minute, side, type, detail FROM events WHERE match_key = ? ORDER BY seq").all(matchKey)
  const goalsOf = (side) => evRows.filter((e) => e.type === "Goal" && e.side === side).map((e) => `${e.minute}'${/Penalty/i.test(e.detail || "") ? "(点)" : ""}`)
  const redsOf = (side) => evRows.filter((e) => e.type === "Card" && /Red/i.test(e.detail || "") && e.side === side).map((e) => `${e.minute}'`)

  // 整合事实喂给 GLM
  const homeInjCnt = injRows.filter((r) => r.side === "home").length
  const awayInjCnt = injRows.filter((r) => r.side === "away").length
  const num = (v) => (v == null ? null : v)
  const fact = (stats, l, injCnt, side) => ({
    队名: teamZh(l.team_name),
    阵型: l.formation || "未知",
    主帅: coachZh(l.coach) || "未知",
    进球数: side === "home" ? score?.home_score ?? null : score?.away_score ?? null,
    预期进球xG: num(getStat(stats, "expected_goals")),
    进球时段: goalsOf(side).length ? goalsOf(side).join("、") : "未进球",
    控球率: num(getStat(stats, "Ball Possession")),
    总射门: num(getStat(stats, "Total Shots")),
    射正: num(getStat(stats, "Shots on Goal")),
    禁区内射门: num(getStat(stats, "Shots insidebox")),
    被封堵: num(getStat(stats, "Blocked Shots")),
    角球: num(getStat(stats, "Corner Kicks")),
    越位: num(getStat(stats, "Offsides")),
    犯规: num(getStat(stats, "Fouls")),
    黄牌: num(getStat(stats, "Yellow Cards")),
    红牌时段: redsOf(side).length ? redsOf(side).join("、") : "无",
    门将扑救: num(getStat(stats, "Goalkeeper Saves")),
    传球数: num(getStat(stats, "Total passes")),
    传球成功率: num(getStat(stats, "Passes %")),
    伤停人数: injCnt,
  })
  const ctx = {
    比赛: `${teamZh(home.team_name)}(主) vs ${teamZh(away.team_name)}(客)`,
    最终比分: score ? `${score.home_score ?? "-"} - ${score.away_score ?? "-"}` : "未知",
    裁判: ref ? `${ref.name}（${ref.nat}）` : "未知",
    主队: fact(homeStats, home, homeInjCnt, "home"),
    客队: fact(awayStats, away, awayInjCnt, "away"),
  }

  const sys = "你是顶级足球赛事分析师，擅长赛后复盘，从真实比赛数据里提炼真正决定结果的关键因素。你只输出 JSON 数组，不输出任何解释。"
  const user = `下面是一场【已结束】比赛的真实数据：
${JSON.stringify(ctx, null, 2)}

请提炼 5~6 个**真正决定了这场比赛结果**的关键因素，做成主客对比。每行一个对象：
- "label": 因素名，≤6字（如"控球压制"、"终结效率"、"门将发挥"）
- "home": 对主队的判断，≤12字，**必须带出具体数据**
- "away": 对客队的判断，≤12字，**必须带出具体数据**
- "edge": 谁占优，仅 "home" / "away" / "even"

硬性要求（违反就是失败）：
1. 每一行都要基于上面的真实数字，并在文字里带出来。例：控球65%vs35%→"控球65%碾压"；xG4.22却进7球→"进7球远超xG"；全场2射正→"仅2次射正"。
2. **严禁空话套话**：不准出现"战术""传导稳定""无特别倾向""替补充足""稳健"这类没有信息量、放哪场都成立的词。
3. 维度要贴合**这场比赛真实发生了什么**，从下列里挑最能解释结果的：实力/比分差距、控球压制、射门量、终结效率(进球vs xG)、禁区渗透、攻防转换、定位球/角球、纪律与红黄牌、门将扑救、进球时段/节奏。**不要硬凑固定六维度**，哪个真正起作用就写哪个。
4. 不要 6 行里一半都是 even；只有两队数据确实接近才用 even。
5. 客观即可，比分悬殊就如实写碾压，被逼平就写冷平。
只输出 JSON 数组，形如：
[{"label":"控球压制","home":"控球65%主导","away":"仅35%被压制","edge":"home"}, ...]`

  let factors
  try {
    const out = await glm([{ role: "system", content: sys }, { role: "user", content: user }])
    factors = parseJsonArray(out)
  } catch (e) { console.log(`  ✗ ${matchKey} GLM 生成失败: ${e.message}`); return false }
  if (!Array.isArray(factors) || !factors.length) { console.log(`  ✗ ${matchKey} GLM 返回非数组`); return false }

  // 写库（事务）
  const tx = db.transaction(() => {
    delFactors.run(matchKey)
    factors.forEach((f, i) => {
      const edge = ["home", "away", "even"].includes(f.edge) ? f.edge : "even"
      insFactor.run({ match_key: matchKey, seq: i, label: String(f.label || "").slice(0, 20), home: String(f.home || "").slice(0, 30), away: String(f.away || "").slice(0, 30), edge, as_of: now })
    })
    delInj.run(matchKey)
    for (const r of injRows) insInj.run(r)
    upMeta.run({ match_key: matchKey, as_of: now })
  })
  tx()
  console.log(`✓ ${matchKey} factors ${factors.length} 行，伤停 ${injRows.length} 条（主${homeInjCnt}/客${awayInjCnt}）`)
  return true
}

async function run() {
  const now = new Date().toISOString()
  let keys = process.argv.slice(2)
  if (!keys.length) keys = db.prepare("SELECT DISTINCT match_key FROM lineups ORDER BY match_key").all().map((r) => r.match_key)
  console.log(`待处理 ${keys.length} 场: ${keys.join(", ")}\n`)
  let ok = 0
  for (const k of keys) { if (await processMatch(k, now)) ok++ }
  const fc = db.prepare("SELECT COUNT(DISTINCT match_key) n FROM match_factors").get().n
  const ic = db.prepare("SELECT COUNT(*) n FROM injuries").get().n
  console.log(`\n完成：成功 ${ok}/${keys.length} 场；match_factors 覆盖 ${fc} 场，injuries 共 ${ic} 条 → ${dbPath}`)
}

run().catch((e) => { console.error("失败:", e.message); process.exit(1) })
