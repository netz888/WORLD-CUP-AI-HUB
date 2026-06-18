// 实时数据守护进程（自动从 API-Football 拉最新数据进库）。
// ───────────────────────────────────────────────────────────────────────────
// 这是「数据进库」的源头：常驻后台循环，按比赛状态自适应频率，把世界杯比赛的
// 状态/比分/时间(分钟+补时)/事件/赛前阵容/裁判 自动写入 data/wc.db。
// 应用侧(Next.js)只读这个库；poller 负责写。两者解耦，可各自独立部署/重启。
//
// 用法：API_FOOTBALL_KEY=xxx node scripts/poller.mjs
// 停止：Ctrl+C（或 kill）。挂后台：pm2 / systemd / nohup 均可（见 docs/数据拉取与实时机制.md）。
//
// 自适应频率（按状态机，详见文档）：
//   有 live 场             → 20 秒/轮（赛中：比分/时间/事件实时）
//   有 <3h 内将开赛的场     → 3 分钟/轮（临赛前：补阵容/首发/裁判）
//   仅有 >3h 的赛前场       → 3 分钟/轮（探状态 + 低频探首发）
//   今日无 upcoming/live   → 30 分钟/轮（无赛事：收尾/等明天）
//
// 额度（Pro 7500/天）：批量 /fixtures?date 每轮 1 次拿回当天所有场状态；事件每进行中场
//   1 次且仅在有进展时拉；首发每场仅拉 1 次。实测 4 场/天约 2000-3000 次，远低于上限。
// ───────────────────────────────────────────────────────────────────────────
import path from "node:path"
import { fileURLToPath } from "node:url"
import Database from "../lib/db/sqlite-node.mjs"
import { requireKey } from "../config/secrets/index.mjs"
import { simulate, buildFinished, resultsHash } from "./lib/champion-sim-core.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 启动开关：默认关闭，不加载 key、不发起任何 API 请求，立即退出。
// 需要恢复定时抓取时，设置环境变量 POLLER_ENABLED=1（或 true）后再启动。
if (!/^(1|true|yes|on)$/i.test(process.env.POLLER_ENABLED || "")) {
  console.log("poller 已停用（未设置 POLLER_ENABLED=1）。不发起任何 API 请求，立即退出。")
  process.exit(0)
}

const KEY = await requireKey("API_FOOTBALL_KEY")
const BASE = "https://v3.football.api-sports.io"
if (!KEY) { console.error("失败：请设置 API_FOOTBALL_KEY"); process.exit(1) }
const WC_LEAGUE_ID = 1

// —— 频率（毫秒）——
const FREQ_LIVE = Number(process.env.POLL_LIVE_MS || 20_000)     // 赛中 20s
const FREQ_PRE = Number(process.env.POLL_PRE_MS || 180_000)      // 赛前 3min
const FREQ_IDLE = Number(process.env.POLL_IDLE_MS || 1_800_000)  // 无赛事 30min
const PRE_WINDOW_MS = 3 * 3600 * 1000                            // 临赛前窗口 3h

// —— 整届赛程同步：提前解析下一阶段对阵 ——
// 每轮 tick 只看「昨天+今天」，故下一阶段对阵要到比赛当天才进窗口。
// 这里额外按 season 拉一次整届赛程（节流，默认 30min 一次 = 每 30min 仅多 1 次 API），
// 把「未开赛且双方已确定」的比赛（尤其 API 刚公布的下一阶段对阵）提前写库，
// 让淘汰赛卡片在阶段一结束、API 一公布就整批解析出真实对阵，无需等到比赛当天。
const WC_SEASON = Number(process.env.WC_SEASON || 2026)
const FULL_SYNC_MS = Number(process.env.POLL_FULL_SYNC_MS || 1_800_000) // 30min
let lastFullSyncAt = 0

// —— API 队名 → 本站三字码（与 ingest-lineups.mjs 同源）——
const RAW = {
  Mexico: "MEX", Czechia: "CZE", "Czech Republic": "CZE", "South Africa": "RSA",
  "South Korea": "KOR", "Korea Republic": "KOR", Canada: "CAN",
  "Bosnia and Herzegovina": "BIH", "Bosnia & Herzegovina": "BIH", Qatar: "QAT", Switzerland: "SUI",
  Brazil: "BRA", Haiti: "HAI", Morocco: "MAR", Scotland: "SCO",
  USA: "USA", "United States": "USA", Australia: "AUS", Paraguay: "PAR",
  Turkiye: "TUR", Turkey: "TUR", Curacao: "CUW", Ecuador: "ECU",
  Germany: "GER", "Ivory Coast": "CIV", "Cote d'Ivoire": "CIV",
  Netherlands: "NED", Japan: "JPN", Sweden: "SWE", Tunisia: "TUN",
  Belgium: "BEL", Egypt: "EGY", Iran: "IRN", "New Zealand": "NZL",
  "Cape Verde": "CPV", "Cape Verde Islands": "CPV", "Saudi Arabia": "KSA",
  Spain: "ESP", Uruguay: "URU", France: "FRA", Norway: "NOR",
  Senegal: "SEN", Iraq: "IRQ", Algeria: "ALG", Argentina: "ARG",
  Austria: "AUT", Jordan: "JOR", Colombia: "COL", "DR Congo": "COD",
  "Congo DR": "COD", Portugal: "POR", Uzbekistan: "UZB", Croatia: "CRO",
  England: "ENG", Ghana: "GHA", Panama: "PAN",
}
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
const NAME_TO_CODE = {}
for (const [k, v] of Object.entries(RAW)) NAME_TO_CODE[norm(k)] = v
const codeOf = (name) => NAME_TO_CODE[norm(name)] ?? null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let lastApiAt = 0
const API_GAP_MS = Number(process.env.API_FOOTBALL_DELAY_MS || 1200) // poller 用短间隔（Pro 档）
async function api(q) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = Math.max(0, lastApiAt + API_GAP_MS - Date.now())
    if (wait > 0) await sleep(wait)
    lastApiAt = Date.now()
    let res, j
    try { res = await fetch(BASE + q, { headers: { "x-apisports-key": KEY } }); j = await res.json() }
    catch (e) { if (attempt < 5) { console.log(`  ⏳ 网络重试 ${q}`); await sleep(3000); continue } throw e }
    const errs = j.errors
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0
    if (!hasErr) return j
    const t = JSON.stringify(errs)
    if (t.includes("rateLimit") && attempt < 5) { console.log("  ⏳ rate limit 65s"); await sleep(65000); continue }
    throw new Error(`API error ${q}: ${t}`)
  }
}

// —— DB ——
const dbPath = process.env.WC_DB_PATH || path.join(__dirname, "..", "data", "wc.db")
const db = new Database(dbPath)
db.pragma("journal_mode = WAL")
// live_scores 增列：status_short(原始状态码)、elapsed(分钟)、extra(补时分钟)，供前端比赛钟。
db.exec(`CREATE TABLE IF NOT EXISTS live_scores (
  match_key TEXT PRIMARY KEY, fixture_id INTEGER, home_code TEXT, away_code TEXT,
  home_score INTEGER, away_score INTEGER, status TEXT NOT NULL, status_desc TEXT,
  kickoff_ms INTEGER, as_of TEXT NOT NULL )`)
// round：API 原始轮次名（"Round of 16"/"Quarter-finals"/…）。淘汰赛席位解析的可靠锚点
// （仅靠 kickoff 时间无法区分同时段的多场淘汰赛，故按 round 分组定位槽位）。
for (const col of ["status_short TEXT", "elapsed INTEGER", "extra INTEGER", "round TEXT"]) {
  try { db.exec(`ALTER TABLE live_scores ADD COLUMN ${col}`) } catch { /* 已存在 */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS events (
  fixture_id INTEGER NOT NULL, match_key TEXT NOT NULL, seq INTEGER NOT NULL,
  minute INTEGER, extra INTEGER, side TEXT NOT NULL, team_code TEXT NOT NULL, team_name TEXT,
  type TEXT NOT NULL, detail TEXT, player TEXT, assist TEXT, PRIMARY KEY (fixture_id, seq) )`)
// source: 'api'（API 拉取，可被覆盖重写）/ 'manual'（手动录入，poller 不会删，重写时保留）
try { db.exec("ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'api'") } catch { /* 已存在 */ }
db.exec(`CREATE TABLE IF NOT EXISTS lineups (
  match_key TEXT NOT NULL, side TEXT NOT NULL, team_code TEXT NOT NULL, team_name TEXT,
  formation TEXT, coach TEXT, kind TEXT NOT NULL DEFAULT 'confirmed', source TEXT NOT NULL DEFAULT 'api-football',
  fixture_id INTEGER, start_xi TEXT NOT NULL, subs TEXT, as_of TEXT NOT NULL, PRIMARY KEY (match_key, side) )`)
db.exec(`CREATE TABLE IF NOT EXISTS referees (
  match_key TEXT PRIMARY KEY, fixture_id INTEGER, name TEXT NOT NULL, nat TEXT NOT NULL DEFAULT '',
  avg_yellow REAL NOT NULL DEFAULT 4.2, avg_red REAL NOT NULL DEFAULT 0.2, penalty_rate REAL NOT NULL DEFAULT 0.27,
  note TEXT, as_of TEXT NOT NULL )`)
// WS1：真实赛后统计（含 xG），完赛时自动入库，喂 B1（真实 xG 收缩融合进 λ）。结构同 ingest-stats.mjs。
db.exec(`CREATE TABLE IF NOT EXISTS match_stats (
  match_key TEXT NOT NULL, side TEXT NOT NULL, team_code TEXT NOT NULL, fixture_id INTEGER,
  possession INTEGER, total_shots INTEGER, shots_on INTEGER, shots_off INTEGER, blocked INTEGER,
  inside_box INTEGER, fouls INTEGER, corners INTEGER, offsides INTEGER, yellow INTEGER, red INTEGER,
  gk_saves INTEGER, passes INTEGER, passes_pct INTEGER, xg REAL, goals_prevented REAL,
  as_of TEXT NOT NULL, PRIMARY KEY (match_key, side) )`)
// 夺冠榜实时模拟快照（结构与 lib/db/client.ts、run-champion-sim.mjs 一致）。
// poller 在「已完赛集合变化」时触发重算写入；应用侧只读。
db.exec(`CREATE TABLE IF NOT EXISTS champion_sim (
  team_code TEXT PRIMARY KEY, champ REAL NOT NULL DEFAULT 0, final REAL NOT NULL DEFAULT 0,
  sf REAL NOT NULL DEFAULT 0, qf REAL NOT NULL DEFAULT 0, r16 REAL NOT NULL DEFAULT 0,
  qualify REAL NOT NULL DEFAULT 0, as_of TEXT NOT NULL )`)
db.exec(`CREATE TABLE IF NOT EXISTS champion_sim_meta (
  id TEXT PRIMARY KEY DEFAULT 'singleton', results_hash TEXT NOT NULL DEFAULT '',
  n_sims INTEGER NOT NULL DEFAULT 0, as_of TEXT NOT NULL )`)

const upScore = db.prepare(`INSERT INTO live_scores
  (match_key,fixture_id,home_code,away_code,home_score,away_score,status,status_desc,status_short,elapsed,extra,kickoff_ms,round,as_of)
  VALUES (@match_key,@fixture_id,@home_code,@away_code,@home_score,@away_score,@status,@status_desc,@status_short,@elapsed,@extra,@kickoff_ms,@round,@as_of)
  ON CONFLICT(match_key) DO UPDATE SET fixture_id=excluded.fixture_id,home_code=excluded.home_code,away_code=excluded.away_code,
   home_score=excluded.home_score,away_score=excluded.away_score,status=excluded.status,status_desc=excluded.status_desc,
   status_short=excluded.status_short,elapsed=excluded.elapsed,extra=excluded.extra,kickoff_ms=excluded.kickoff_ms,round=excluded.round,as_of=excluded.as_of`)
const upRef = db.prepare(`INSERT INTO referees (match_key,fixture_id,name,nat,as_of)
  VALUES (@match_key,@fixture_id,@name,@nat,@as_of)
  ON CONFLICT(match_key) DO UPDATE SET fixture_id=excluded.fixture_id,name=excluded.name,nat=excluded.nat,as_of=excluded.as_of`)
const upLineup = db.prepare(`INSERT INTO lineups
  (match_key,side,team_code,team_name,formation,coach,kind,source,fixture_id,start_xi,subs,as_of)
  VALUES (@match_key,@side,@team_code,@team_name,@formation,@coach,@kind,'api-football',@fixture_id,@start_xi,@subs,@as_of)
  ON CONFLICT(match_key,side) DO UPDATE SET team_name=excluded.team_name,formation=excluded.formation,coach=excluded.coach,
   kind=excluded.kind,fixture_id=excluded.fixture_id,start_xi=excluded.start_xi,subs=excluded.subs,as_of=excluded.as_of`)
// 只删 API 来源的事件，手动录入(source='manual')的保留
const delEvents = db.prepare("DELETE FROM events WHERE match_key = ? AND source = 'api'")
const getManualEvents = db.prepare("SELECT * FROM events WHERE match_key = ? AND source = 'manual'")
const insEvent = db.prepare(`INSERT OR REPLACE INTO events
  (fixture_id,match_key,seq,minute,extra,side,team_code,team_name,type,detail,player,assist,source)
  VALUES (@fixture_id,@match_key,@seq,@minute,@extra,@side,@team_code,@team_name,@type,@detail,@player,@assist,@source)`)
const getLineupState = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN kind = 'confirmed' THEN 1 ELSE 0 END), 0) confirmed FROM lineups WHERE match_key = ?")
const getLastLive = db.prepare("SELECT status_short, extra FROM live_scores WHERE match_key = ?")
// WS1：match_stats upsert + 是否已入库统计（每场只拉一次）
const upStat = db.prepare(`INSERT INTO match_stats
  (match_key, side, team_code, fixture_id, possession, total_shots, shots_on, shots_off, blocked,
   inside_box, fouls, corners, offsides, yellow, red, gk_saves, passes, passes_pct, xg, goals_prevented, as_of)
  VALUES (@match_key,@side,@team_code,@fixture_id,@possession,@total_shots,@shots_on,@shots_off,@blocked,
   @inside_box,@fouls,@corners,@offsides,@yellow,@red,@gk_saves,@passes,@passes_pct,@xg,@goals_prevented,@as_of)
  ON CONFLICT(match_key, side) DO UPDATE SET
   team_code=excluded.team_code, fixture_id=excluded.fixture_id, possession=excluded.possession,
   total_shots=excluded.total_shots, shots_on=excluded.shots_on, shots_off=excluded.shots_off,
   blocked=excluded.blocked, inside_box=excluded.inside_box, fouls=excluded.fouls, corners=excluded.corners,
   offsides=excluded.offsides, yellow=excluded.yellow, red=excluded.red, gk_saves=excluded.gk_saves,
   passes=excluded.passes, passes_pct=excluded.passes_pct, xg=excluded.xg,
   goals_prevented=excluded.goals_prevented, as_of=excluded.as_of`)
const hasStats = db.prepare("SELECT COUNT(*) n FROM match_stats WHERE match_key = ?")
const pInt = (v) => (v == null ? null : parseInt(String(v).replace("%", ""), 10))
const pReal = (v) => (v == null ? null : parseFloat(String(v)))
const statMap = (stats) => { const m = {}; for (const s of stats || []) m[s.type] = s.value; return m }

// API status.short → 本站 status（粗分类）。原始 short 单独存 status_short。
function statusToLive(short) {
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "INT", "SUSP"].includes(short)) return "live"
  if (["FT", "AET", "PEN"].includes(short)) return "finished"
  return "upcoming"
}
const isLiveShort = (s) => ["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(s)
const isFinishedShort = (s) => ["FT", "AET", "PEN"].includes(s)

// 进展指纹：比分+分钟+补时+状态。变了才重拉事件，避免空转烧额度。
const lastProgress = new Map()

// 赛中统计节流：每场每隔 STATS_LIVE_MS(默认 20s) 才重拉一次 /fixtures/statistics。
// 与比分同频实时刷新；可用 POLL_STATS_MS 环境变量调整。matchKey → 上次拉取时间戳。
const STATS_LIVE_MS = Number(process.env.POLL_STATS_MS || 20_000)
const lastStatsAt = new Map()

// 补时冻结：用户要的是第四官员「举牌公布」的补时（如 +6），不是实际踢了多久。
// API 的 status.extra 是动态值——刚进补时时≈举牌值，之后裁判追加会上调（如 6→7）。
// 策略：记住每场每个补时段「首次看到的 extra」，之后只保留首值、绝不上调（也不下调）。
// 段标识 half：上半场补时=1H、下半场补时=2H、加时上=ET1、加时下=ET2，按 short+elapsed 区分。
//   key = `${matchKey}|${half}` → 首次公布的 extra。
const frozenExtra = new Map()
function stoppageHalf(short, elapsed) {
  if (short === "1H") return "1H"
  if (short === "2H") return "2H"
  if (short === "ET") return (elapsed ?? 0) <= 105 ? "ET1" : "ET2"
  if (short === "HT") return "1H" // 中场时定格的是上半场补时
  if (short === "BT") return "ET1"
  return null
}
// 返回该场该段应写库的 extra（冻结首值）。raw 为 API 当前返回的 status.extra。
function freezeExtra(matchKey, short, elapsed, raw) {
  const half = stoppageHalf(short, elapsed)
  if (half === null) return raw ?? null
  const key = `${matchKey}|${half}`
  if (frozenExtra.has(key)) return frozenExtra.get(key) // 内存已记首值，保持不变
  // poller 重启后内存丢失：若库里同一半场已有冻结的 extra，先回填内存（避免重启后重新锁到更大值）
  const last = getLastLive.get(matchKey)
  if (last && stoppageHalf(last.status_short, elapsed) === half && typeof last.extra === "number" && last.extra > 0) {
    frozenExtra.set(key, last.extra)
    return last.extra
  }
  if (typeof raw === "number" && raw > 0) {
    frozenExtra.set(key, raw) // 首次看到举牌值，锁定
    return raw
  }
  return raw ?? null // 还没公布，原样（null）
}

async function pullLineup(matchKey, fid, hc, ac, statusShort, nowIso) {
  // API-Football 的 /fixtures/lineups 返回的是官方阵容；预测阵容只由 MiMo 脚本写入。
  const lineupState = getLineupState.get(matchKey) || { n: 0, confirmed: 0 }
  const confirmedLineups = Number(lineupState.confirmed || 0)
  if (confirmedLineups >= 2) return
  const lj = await api(`/fixtures/lineups?fixture=${fid}`)
  const resp = lj.response || []
  if (resp.length < 2) return // 首发还没出
  const kind = "confirmed"
  for (const t of resp) {
    const isHome = codeOf(t.team.name) === hc
    const side = isHome ? "home" : "away"
    const startXi = (t.startXI || []).map((p) => ({ number: p.player.number, name: p.player.name, pos: p.player.pos, grid: p.player.grid }))
    const subs = (t.substitutes || []).map((p) => ({ number: p.player.number, name: p.player.name, pos: p.player.pos }))
    upLineup.run({
      match_key: matchKey, side, team_code: isHome ? hc : ac, team_name: t.team.name,
      formation: t.formation || null, coach: (t.coach && t.coach.name) || null, kind,
      fixture_id: fid, start_xi: JSON.stringify(startXi), subs: JSON.stringify(subs), as_of: nowIso,
    })
  }
  console.log(`  ✓ ${matchKey} 首发入库(${kind})`)
}

async function pullEvents(matchKey, fid, hc, nowIso) {
  const ej = await api(`/fixtures/events?fixture=${fid}`)
  const evs = ej.response || []
  // API 事件统一成内部行结构，手动事件从库里取出保留
  const apiRows = evs.map((e) => {
    const isHome = codeOf(e.team?.name) === hc
    return {
      fixture_id: fid, match_key: matchKey,
      minute: e.time?.elapsed ?? null, extra: e.time?.extra ?? null,
      side: isHome ? "home" : "away", team_code: codeOf(e.team?.name) || "",
      team_name: e.team?.name || null, type: e.type || "", detail: e.detail || null,
      player: e.player?.name || null, assist: e.assist?.name || null, source: "api",
    }
  })
  const manualRows = getManualEvents.all(matchKey)
  // 合并后按 (minute, extra) 时间顺序排，手动条目穿插到正确分钟，再统一重排 seq
  const merged = [...apiRows, ...manualRows].sort((a, b) => {
    const am = (a.minute ?? 0) * 100 + (a.extra ?? 0)
    const bm = (b.minute ?? 0) * 100 + (b.extra ?? 0)
    return am - bm
  })
  const tx = db.transaction(() => {
    delEvents.run(matchKey)
    merged.forEach((r, i) => insEvent.run({ ...r, seq: i }))
  })
  tx()
  return evs.length
}

// 拉真实统计（含 xG）写 match_stats。
//   完赛：每场只拉一次（hasStats>=2 即跳过）。喂 B1 真实 xG 收缩。
//   赛中：force=true 强制重拉，让控球率/射门等随比赛实时刷新（由外层 90s 节流控制频率）。
async function pullStats(matchKey, fid, hc, ac, nowIso, force = false) {
  if (!force && hasStats.get(matchKey).n >= 2) return // 完赛已入库（两队）则跳过
  const st = await api(`/fixtures/statistics?fixture=${fid}`)
  const resp = st.response || []
  if (resp.length < 2) return // 统计还没出（FT 后通常稍滞后，下一轮再补）
  for (const t of resp) {
    const isHome = codeOf(t.team?.name) === hc
    const side = isHome ? "home" : "away"
    const m = statMap(t.statistics)
    upStat.run({
      match_key: matchKey, side, team_code: isHome ? hc : ac, fixture_id: fid,
      possession: pInt(m["Ball Possession"]), total_shots: pInt(m["Total Shots"]),
      shots_on: pInt(m["Shots on Goal"]), shots_off: pInt(m["Shots off Goal"]),
      blocked: pInt(m["Blocked Shots"]), inside_box: pInt(m["Shots insidebox"]),
      fouls: pInt(m["Fouls"]), corners: pInt(m["Corner Kicks"]), offsides: pInt(m["Offsides"]),
      yellow: pInt(m["Yellow Cards"]), red: pInt(m["Red Cards"]), gk_saves: pInt(m["Goalkeeper Saves"]),
      passes: pInt(m["Total passes"]), passes_pct: pInt(m["Passes %"]),
      xg: pReal(m["expected_goals"]), goals_prevented: pReal(m["goals_prevented"]), as_of: nowIso,
    })
  }
  console.log(`  📊 ${matchKey} 统计入库（${resp.length} 队，xG 已落库 → 喂 B1）`)
}

// —— 夺冠榜实时模拟触发 ——
// 「仅赛果变化时重算」：每轮 tick 末尾调用，读已完赛集合算 hash，与库里 meta 比对，
// 变了才跑 2 万次蒙特卡洛写 champion_sim（约 2 秒，进程内同步，不烧 API 额度）。
const CHAMP_SIMS = Number(process.env.CHAMP_N_SIMS || 20_000)
const upChamp = db.prepare(`INSERT INTO champion_sim
  (team_code, champ, final, sf, qf, r16, qualify, as_of)
  VALUES (@team_code,@champ,@final,@sf,@qf,@r16,@qualify,@as_of)
  ON CONFLICT(team_code) DO UPDATE SET champ=excluded.champ, final=excluded.final, sf=excluded.sf,
   qf=excluded.qf, r16=excluded.r16, qualify=excluded.qualify, as_of=excluded.as_of`)
const upChampMeta = db.prepare(`INSERT INTO champion_sim_meta (id, results_hash, n_sims, as_of)
  VALUES ('singleton', @results_hash, @n_sims, @as_of)
  ON CONFLICT(id) DO UPDATE SET results_hash=excluded.results_hash, n_sims=excluded.n_sims, as_of=excluded.as_of`)
const getChampMeta = db.prepare("SELECT results_hash FROM champion_sim_meta WHERE id = 'singleton'")
const getFinishedScores = db.prepare(
  `SELECT home_code, away_code, home_score, away_score FROM live_scores
   WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
)
function maybeRunChampionSim() {
  // 朝向校正 + 仅纳入小组赛场次（与 run-champion-sim.mjs 同口径）。
  const finished = buildFinished(getFinishedScores.all())
  const hash = resultsHash(finished)
  const prev = getChampMeta.get()
  if (prev && prev.results_hash === hash) return // 赛果未变，跳过
  const t0 = Date.now()
  const table = simulate(finished, CHAMP_SIMS)
  const asOf = new Date().toISOString()
  const tx = db.transaction(() => {
    for (const code in table) upChamp.run({ team_code: code, ...table[code], as_of: asOf })
    upChampMeta.run({ results_hash: hash, n_sims: CHAMP_SIMS, as_of: asOf })
  })
  tx()
  const top = Object.entries(table).sort((a, b) => b[1].champ - a[1].champ).slice(0, 3)
    .map(([c, v]) => `${c} ${v.champ}%`).join(" / ")
  console.log(`  🏆 夺冠榜重算：${finished.size} 场已完赛 × ${CHAMP_SIMS} 次，${Date.now() - t0}ms。Top3: ${top}`)
}

// 整届赛程同步（节流）：拉一次 season 全量赛程，把「未开赛且双方已确定」的比赛
// 提前写入 live_scores（只写 NS 未来场，绝不触碰 live/完赛行，避免覆盖更鲜的比分）。
// 目的：阶段一结束、API 一公布下一阶段对阵，下一次同步即整批解析出真实对阵，
// 不必等到各场比赛当天才进入「昨天+今天」窗口。
async function syncFullSchedule(nowIso) {
  if (Date.now() - lastFullSyncAt < FULL_SYNC_MS) return
  lastFullSyncAt = Date.now()
  let fx
  try { fx = await api(`/fixtures?league=${WC_LEAGUE_ID}&season=${WC_SEASON}`) }
  catch (e) { console.log("  ⚠ 整届赛程同步失败:", e.message); return }
  let filled = 0
  for (const f of (fx.response || []).filter((x) => x.league.id === WC_LEAGUE_ID)) {
    const short = f.fixture.status?.short || "NS"
    // 只处理「未开赛」场次：live/完赛由「昨天+今天」窗口的 tick 权威写入，这里不碰。
    if (isLiveShort(short) || isFinishedShort(short)) continue
    const hc = codeOf(f.teams.home.name)
    const ac = codeOf(f.teams.away.name)
    if (!hc || !ac) continue // 对阵未确定（占位/null）→ 跳过，保持「待定」
    const kickoffMs = f.fixture.timestamp ? f.fixture.timestamp * 1000 : Date.parse(f.fixture.date)
    upScore.run({
      match_key: `${hc}-${ac}`, fixture_id: f.fixture.id, home_code: hc, away_code: ac,
      home_score: null, away_score: null,
      status: "upcoming", status_desc: f.fixture.status?.long || short, status_short: short,
      elapsed: null, extra: null, kickoff_ms: kickoffMs,
      round: f.league?.round ?? null, as_of: nowIso,
    })
    filled++
  }
  if (filled) console.log(`  📅 整届赛程同步：写入 ${filled} 场未开赛对阵（提前解析下一阶段）`)
}

// 一轮：批量探状态 → 据状态分流。返回下一轮间隔（ms）。
async function tick() {
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)
  // 同时查今天和昨天（跨 UTC 日界的比赛，如 FRA-SEN 实际挂昨天）
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const seen = new Map()
  for (const d of [yest, today]) {
    const fx = await api(`/fixtures?date=${d}`)
    for (const f of (fx.response || []).filter((x) => x.league.id === WC_LEAGUE_ID)) seen.set(f.fixture.id, f)
  }
  const fixtures = [...seen.values()]

  // 提前同步整届赛程（节流，内部自判 30min 间隔），把下一阶段已公布对阵提前写库。
  try { await syncFullSchedule(nowIso) } catch (e) { console.log("  ⚠ 整届赛程同步异常:", e.message) }

  let anyLive = false
  let anyPreSoon = false
  let anyUpcoming = false

  for (const f of fixtures) {
    const fid = f.fixture.id
    const hc = codeOf(f.teams.home.name)
    const ac = codeOf(f.teams.away.name)
    if (!hc || !ac) continue
    const matchKey = `${hc}-${ac}`
    const s = f.fixture.status || {}
    const short = s.short || "NS"
    const kickoffMs = f.fixture.timestamp ? f.fixture.timestamp * 1000 : Date.parse(f.fixture.date)

    // 1) 状态/比分/时间(分钟+补时)：每轮写（kickoff_ms 用 API 真实 timestamp，修历史 8h 错位）
    // extra 走冻结：保留每半场首次公布（举牌）值，不随裁判追加而上调。
    const extraToWrite = freezeExtra(matchKey, short, s.elapsed, s.extra)
    upScore.run({
      match_key: matchKey, fixture_id: fid, home_code: hc, away_code: ac,
      home_score: f.goals?.home ?? null, away_score: f.goals?.away ?? null,
      status: statusToLive(short), status_desc: s.long || short, status_short: short,
      elapsed: s.elapsed ?? null, extra: extraToWrite, kickoff_ms: kickoffMs,
      round: f.league?.round ?? null, as_of: nowIso,
    })
    // 裁判（赛前就会公布；含在 fixture 里，0 额外调用）
    if (f.fixture.referee) {
      const [rn, rnat] = f.fixture.referee.split(",").map((x) => x.trim())
      upRef.run({ match_key: matchKey, fixture_id: fid, name: rn || f.fixture.referee, nat: rnat || "", as_of: nowIso })
    }

    const live = isLiveShort(short)
    const finished = isFinishedShort(short)
    const msToKick = kickoffMs - Date.now()

    if (live) {
      anyLive = true
      // 首发（若还没入库）
      await pullLineup(matchKey, fid, hc, ac, short, nowIso)
      // 事件：仅在有进展时拉（比分/分钟/补时/状态变化）
      const fp = `${f.goals?.home}-${f.goals?.away}|${s.elapsed}|${s.extra}|${short}`
      if (lastProgress.get(matchKey) !== fp) {
        const n = await pullEvents(matchKey, fid, hc, nowIso)
        lastProgress.set(matchKey, fp)
        console.log(`  🔴 ${matchKey} ${short} ${s.elapsed ?? ""}'${s.extra ? "+" + s.extra : ""} ${f.goals?.home}-${f.goals?.away} 事件${n}`)
      }
      // 赛中技术统计：每场按 STATS_LIVE_MS(默认 20s) 节流强制重拉（控球率/射门/xG 实时刷新，喂场面权重引擎）
      if (Date.now() - (lastStatsAt.get(matchKey) || 0) >= STATS_LIVE_MS) {
        try { await pullStats(matchKey, fid, hc, ac, nowIso, true); lastStatsAt.set(matchKey, Date.now()) }
        catch (e) { console.log(`  ⚠ ${matchKey} 赛中统计拉取失败: ${e.message}`) }
      }
    } else if (finished) {
      // 完赛：补拉一次最终事件（确保补时进球等齐全），首发若缺也补
      await pullLineup(matchKey, fid, hc, ac, short, nowIso)
      const fp = `FIN|${f.goals?.home}-${f.goals?.away}`
      if (lastProgress.get(matchKey) !== fp) {
        const n = await pullEvents(matchKey, fid, hc, nowIso)
        lastProgress.set(matchKey, fp)
        console.log(`  🏁 ${matchKey} ${short} 终场 ${f.goals?.home}-${f.goals?.away} 事件${n}`)
      }
      // WS1：完赛后拉真实统计(xG)写 match_stats（每场只一次，内部已去重）。喂 B1。
      try { await pullStats(matchKey, fid, hc, ac, nowIso) } catch (e) { console.log(`  ⚠ ${matchKey} 统计拉取失败: ${e.message}`) }
    } else {
      // 未开赛
      anyUpcoming = true
      if (msToKick > 0 && msToKick < PRE_WINDOW_MS) {
        anyPreSoon = true
        await pullLineup(matchKey, fid, hc, ac, short, nowIso) // 临赛前探首发（出了即入库）
      }
    }
  }

  // 夺冠榜：有比赛打完（已完赛集合变化）时重算快照；hash 未变则零成本跳过。
  try { maybeRunChampionSim() } catch (e) { console.log("  ⚠ 夺冠榜重算异常:", e.message) }

  // 决定下一轮频率
  let next, label
  if (anyLive) { next = FREQ_LIVE; label = "赛中" }
  else if (anyPreSoon) { next = FREQ_PRE; label = "临赛前" }
  else if (anyUpcoming) { next = FREQ_PRE; label = "赛前" }
  else { next = FREQ_IDLE; label = "无赛事" }
  console.log(`[${nowIso}] ${fixtures.length}场 · ${label} · 下轮 ${Math.round(next / 1000)}s`)
  return next
}

let stopped = false
process.on("SIGINT", () => { console.log("\n收到停止信号，退出。"); stopped = true; setTimeout(() => process.exit(0), 200) })
process.on("SIGTERM", () => { stopped = true; process.exit(0) })

async function loop() {
  console.log(`poller 启动 → ${dbPath}\n频率：赛中 ${FREQ_LIVE / 1000}s / 赛前 ${FREQ_PRE / 1000}s / 无赛事 ${FREQ_IDLE / 1000}s`)
  while (!stopped) {
    let wait = FREQ_PRE
    try { wait = await tick() } catch (e) { console.log("  ⚠ 轮次异常:", e.message) }
    if (stopped) break
    await sleep(wait)
  }
}

loop()

