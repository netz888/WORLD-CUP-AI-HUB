// World Cup 2026 dataset
// 48 teams, 12 groups (A-L). AI 概率来自 prediction-core（worldcup-predictor skill）离线模拟，
// 见 .v0/wc/gen.mjs，输出 lib/wc-predictions.json。
import predictions from "./wc-predictions.json"
import { REAL_ANALYSIS, type RealLineup } from "./real-analysis"
import { VERIFIED_FORM } from "./market-data"
import { CHAMPION_SIM } from "./champion-sim-data"
import { predictV2, V2_CALIB, type V2Output, type MarginBuckets, type Markets } from "./prediction-v2"
import teamProfiles from "./team-profiles.json"

// 真实球队画像（scripts/build-profiles.mjs 由 DB 生成）。prematch[key] = 该场两队的赛前 form（无泄漏）。
type PreForm = { games: number; formGD: number; recent: string[] }
type CoreInfo = { hasData: boolean; kaEquiv: number; absent: string[]; stars?: { display: string; tier: number; status: string }[] }
const PROFILES = teamProfiles as {
  teams: Record<string, { played: number; formGD: number; avgXgFor: number | null; avgXgAgainst: number | null; avgPossession: number | null }>
  prematch: Record<string, { home: PreForm; away: PreForm; coreHome?: CoreInfo; coreAway?: CoreInfo }>
}

// Phase 3：请求时实时画像覆盖（来自 DB 的 lib/db/profile-live）。形状同 prematch[key]。
// 由页面层（服务端）算好后传入；缺省则回退静态 PROFILES.prematch（离线快照）。
export type PrematchProfile = {
  home: PreForm
  away: PreForm
  coreHome?: CoreInfo
  coreAway?: CoreInfo
  // B1：本届真实场均 xG 推得的 λ + 样本数（由服务端 getLiveProfile 用 getTeamProfile 算好传入）。
  xgLambdaHome?: number
  xgLambdaAway?: number
  nHome?: number
  nAway?: number
  // 展示用：真实场均 xG（攻/防），无样本则 undefined。
  realXgForHome?: number
  realXgForAway?: number
}
// 取某场画像：优先实时覆盖，否则静态快照。
function resolvePrematch(key: string, override?: PrematchProfile | null): PrematchProfile | undefined {
  return override ?? PROFILES.prematch?.[key]
}

type MatchPred = {
  homeWin: number; draw: number; awayWin: number
  egHome: number; egAway: number
  top: { score: string; prob: number }[]
  confidence: "high" | "medium" | "low"
  upsetRisk: "high" | "medium" | "low"
  explanation: string[]
}
const MATCH_PREDS = predictions.matches as Record<string, MatchPred>
// 夺冠/晋级阶段概率改用 v6 模拟（champion-sim-data.ts），不再读 wc-predictions.json 的 teams

export type Team = {
  code: string // ISO-ish 3-letter code
  name: string // Chinese name
  enName: string
  flag: string // emoji flag
  fifaRank: number
  fifaPoints: number
  group: string
  confederation: string
}

export type Standing = {
  teamCode: string
  played: number
  win: number
  draw: number
  loss: number
  goalsFor: number
  goalsAgainst: number
  points: number
  qualifyProb: number // AI 出线概率 %
}

export type MatchStatus = "upcoming" | "live" | "finished"

export type Player = {
  num: number
  name: string
  role: string
  x: number // 0-100 across pitch width
  y: number // 0-100 from own goal (0) to attack (100)
}

export type Lineup = {
  formation: string
  players: Player[]
}

export type LineupKind = "predicted" | "confirmed"

export type Injury = {
  name: string
  pos: string
  status: "缺阵" | "存疑" | "复出"
  note: string
}

export type Coach = {
  name: string
  nat: string
  style: string
}

export type ScoreProb = { score: string; prob: number }

export type MatchFactor = {
  label: string
  home: string
  away: string
  edge: "home" | "away" | "even"
}

// 比赛事件（来自 API-Football，仅已结束/进行中的入库场次有）
export type MatchEvent = {
  minute: number
  extra?: number
  side: "home" | "away"
  type: string // Goal | Card | subst | Var
  detail: string // Normal Goal | Yellow Card | Substitution ...
  player: string
  assist?: string
}

export type MatchDetail = {
  homeLineup: Lineup
  awayLineup: Lineup
  lineupKind?: LineupKind
  homeInjuries: Injury[]
  awayInjuries: Injury[]
  homeCoach: Coach
  awayCoach: Coach
  referee: {
    name: string
    nat: string
    avgYellow: number
    avgRed: number
    penaltyRate: number // penalties per match
    note: string
  }
  venueInfo: {
    altitude: number // meters
    capacity: number
    surface: string
    weather: { tempC: number; condition: string; humidity: number; windKmh: number }
  }
  factors: MatchFactor[]
  scoreProbs: ScoreProb[]
  over25: number // P(total goals > 2.5)
  bttRatio: number // P(both teams to score)
  // 冷门风险（A 段）：把尾部概率显性化，比分榜永远保留一个“冷门情形”槽
  upsetProb: number // 冷门发生概率（整数%）
  upsetLabel: string // 冷门情形（已含真实队名），如“佛得角逼平或爆冷”
  upsetScore: string // 最可能的冷门比分，如“0 - 0”
  calibrationNote: string
  // 数据来源标记："real" = 联网核实真实赛前数据；"model" = 离线模型生成
  dataMode?: "real" | "model"
  // 字段级真实数据标记：避免某个字段没入库时仍展示静态假数据。
  realData?: {
    lineups?: boolean
    events?: boolean
    referee?: boolean
    coaches?: boolean
    injuries?: boolean
    factors?: boolean
  }
  sources?: { label: string; url: string; date: string }[]
  // 进阶指标与历史交锋（用于雷达/对比/交锋展示）
  xgHome: number // 模型预期进球 λ（注意：非真实 xG，见 realXg*）
  xgAway: number
  possessionHome: number
  shotsHome: number
  shotsAway: number
  // WS1：盘口主导展示
  marginBuckets?: MarginBuckets // 净胜球归并桶（主赢2+/主赢1/平/客赢1/客赢2+）
  markets?: Markets // 衍生盘口（双重机会/大小球/双方进球）
  topInsight?: { label: string; prob: number } | null // 最有把握的一句话判断
  // WS1：真实场均 xG（本届，区别于上面的模型 λ）；无样本则 undefined
  realXgForHome?: number
  realXgForAway?: number
  realXgSamplesHome?: number
  realXgSamplesAway?: number
  h2h: {
    homeWins: number
    draws: number
    awayWins: number
    last: { date: string; result: string; score: string }[]
  }
  // 真实比赛事件时间轴（仅入库的已结束场次有；无则不展示该板块）
  events?: MatchEvent[]
  // 球星出场状态（来自手工球星表×真实首发/替补，区分 首发/替补待命/未进名单）。
  // 解决"热门球员没首发要不要算"的展示需求：哪怕模型权重保守，也明确告知用户。
  starAvailability?: {
    home: { display: string; tier: number; status: string }[]
    away: { display: string; tier: number; status: string }[]
  }
}

export type Match = {
  id: string
  group: string
  stage: string
  // UTC ISO time
  kickoff: string
  status: MatchStatus
  minute?: number
  homeCode: string
  awayCode: string
  homeScore?: number
  awayScore?: number
  venue: string
  city: string
  // AI prediction
  ai: {
    homeWin: number
    draw: number
    awayWin: number
    predictedScore: string
    confidence: number
    keyPoints: string[]
    summary: string
    formHome: ("W" | "D" | "L")[]
    formAway: ("W" | "D" | "L")[]
    // 近期状态是否为联网核实的真实数据；false 时前端显示“暂无核实数据”而非虚构战绩
    formVerified: boolean
    // 冷门信号（融入赛程，不单开榜单）：
    // upsetIndex = 冷门概率 × 实力悬殊度，势均力敌场次趋近 0，仅“强弱分明但弱队有翻车概率”的会冒头
    upsetProb: number // 冷门方不输（逼平或爆冷）的概率 %
    upsetIndex: number // 冷门指数 0-100，越高越值得关注
    upsetLabel: string // 冷门情形（含真实队名），如“佛得角逼平或爆冷”
    upsetScore: string // 最可能的冷门比分
  }
  detail: MatchDetail
}

export const GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]

export const TIMEZONES: { label: string; value: string; city: string }[] = [
  { label: "北京时间 (UTC+8)", value: "Asia/Shanghai", city: "北京" },
  { label: "协调世界时 (UTC)", value: "UTC", city: "UTC" },
  { label: "伦敦 (UTC+0/1)", value: "Europe/London", city: "伦敦" },
  { label: "纽约 (UTC-5/4)", value: "America/New_York", city: "纽约" },
  { label: "洛杉矶 (UTC-8/7)", value: "America/Los_Angeles", city: "洛杉矶" },
  { label: "东京 (UTC+9)", value: "Asia/Tokyo", city: "东京" },
  { label: "迪拜 (UTC+4)", value: "Asia/Dubai", city: "迪拜" },
]

// 2026 世界杯真实分组与 FIFA 排名（数据截至 2026-06 官方排名，世界杯前冻结快照）
export const TEAMS: Team[] = [
  // Group A
  { code: "MEX", name: "墨西哥", enName: "Mexico", flag: "🇲🇽", fifaRank: 14, fifaPoints: 1676, group: "A", confederation: "CONCACAF" },
  { code: "CZE", name: "捷克", enName: "Czechia", flag: "🇨🇿", fifaRank: 40, fifaPoints: 1487, group: "A", confederation: "UEFA" },
  { code: "RSA", name: "南非", enName: "South Africa", flag: "🇿🇦", fifaRank: 60, fifaPoints: 1395, group: "A", confederation: "CAF" },
  { code: "KOR", name: "韩国", enName: "South Korea", flag: "🇰🇷", fifaRank: 25, fifaPoints: 1599, group: "A", confederation: "AFC" },
  // Group B
  { code: "CAN", name: "加拿大", enName: "Canada", flag: "🇨🇦", fifaRank: 30, fifaPoints: 1559, group: "B", confederation: "CONCACAF" },
  { code: "BIH", name: "波黑", enName: "Bosnia and Herzegovina", flag: "🇧🇦", fifaRank: 64, fifaPoints: 1330, group: "B", confederation: "UEFA" },
  { code: "QAT", name: "卡塔尔", enName: "Qatar", flag: "🇶🇦", fifaRank: 56, fifaPoints: 1455, group: "B", confederation: "AFC" },
  { code: "SUI", name: "瑞士", enName: "Switzerland", flag: "🇨🇭", fifaRank: 19, fifaPoints: 1655, group: "B", confederation: "UEFA" },
  // Group C
  { code: "BRA", name: "巴西", enName: "Brazil", flag: "🇧🇷", fifaRank: 6, fifaPoints: 1761, group: "C", confederation: "CONMEBOL" },
  { code: "HAI", name: "海地", enName: "Haiti", flag: "🇭🇹", fifaRank: 83, fifaPoints: 1285, group: "C", confederation: "CONCACAF" },
  { code: "MAR", name: "摩洛哥", enName: "Morocco", flag: "🇲🇦", fifaRank: 7, fifaPoints: 1713, group: "C", confederation: "CAF" },
  { code: "SCO", name: "苏格兰", enName: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", fifaRank: 42, fifaPoints: 1507, group: "C", confederation: "UEFA" },
  // Group D
  { code: "USA", name: "美国", enName: "USA", flag: "🇺🇸", fifaRank: 17, fifaPoints: 1682, group: "D", confederation: "CONCACAF" },
  { code: "AUS", name: "澳大利亚", enName: "Australia", flag: "🇦🇺", fifaRank: 27, fifaPoints: 1574, group: "D", confederation: "AFC" },
  { code: "PAR", name: "巴拉圭", enName: "Paraguay", flag: "🇵🇾", fifaRank: 41, fifaPoints: 1502, group: "D", confederation: "CONMEBOL" },
  { code: "TUR", name: "土耳其", enName: "Türkiye", flag: "🇹🇷", fifaRank: 22, fifaPoints: 1583, group: "D", confederation: "UEFA" },
  // Group E
  { code: "CUW", name: "库拉索", enName: "Curaçao", flag: "🇨🇼", fifaRank: 82, fifaPoints: 1290, group: "E", confederation: "CONCACAF" },
  { code: "ECU", name: "厄瓜多尔", enName: "Ecuador", flag: "🇪🇨", fifaRank: 23, fifaPoints: 1592, group: "E", confederation: "CONMEBOL" },
  { code: "GER", name: "德国", enName: "Germany", flag: "🇩🇪", fifaRank: 10, fifaPoints: 1724, group: "E", confederation: "UEFA" },
  { code: "CIV", name: "科特迪瓦", enName: "Ivory Coast", flag: "🇨🇮", fifaRank: 33, fifaPoints: 1490, group: "E", confederation: "CAF" },
  // Group F
  { code: "NED", name: "荷兰", enName: "Netherlands", flag: "🇳🇱", fifaRank: 8, fifaPoints: 1758, group: "F", confederation: "UEFA" },
  { code: "JPN", name: "日本", enName: "Japan", flag: "🇯🇵", fifaRank: 18, fifaPoints: 1650, group: "F", confederation: "AFC" },
  { code: "SWE", name: "瑞典", enName: "Sweden", flag: "🇸🇪", fifaRank: 38, fifaPoints: 1487, group: "F", confederation: "UEFA" },
  { code: "TUN", name: "突尼斯", enName: "Tunisia", flag: "🇹🇳", fifaRank: 45, fifaPoints: 1497, group: "F", confederation: "CAF" },
  // Group G
  { code: "BEL", name: "比利时", enName: "Belgium", flag: "🇧🇪", fifaRank: 9, fifaPoints: 1731, group: "G", confederation: "UEFA" },
  { code: "EGY", name: "埃及", enName: "Egypt", flag: "🇪🇬", fifaRank: 29, fifaPoints: 1521, group: "G", confederation: "CAF" },
  { code: "IRN", name: "伊朗", enName: "Iran", flag: "🇮🇷", fifaRank: 20, fifaPoints: 1617, group: "G", confederation: "AFC" },
  { code: "NZL", name: "新西兰", enName: "New Zealand", flag: "🇳🇿", fifaRank: 85, fifaPoints: 1270, group: "G", confederation: "OFC" },
  // Group H
  { code: "CPV", name: "佛得角", enName: "Cape Verde", flag: "🇨🇻", fifaRank: 67, fifaPoints: 1355, group: "H", confederation: "CAF" },
  { code: "KSA", name: "沙特阿拉伯", enName: "Saudi Arabia", flag: "🇸🇦", fifaRank: 61, fifaPoints: 1400, group: "H", confederation: "AFC" },
  { code: "ESP", name: "西班牙", enName: "Spain", flag: "🇪🇸", fifaRank: 2, fifaPoints: 1876, group: "H", confederation: "UEFA" },
  { code: "URU", name: "乌拉圭", enName: "Uruguay", flag: "🇺🇾", fifaRank: 16, fifaPoints: 1673, group: "H", confederation: "CONMEBOL" },
  // Group I
  { code: "FRA", name: "法国", enName: "France", flag: "🇫🇷", fifaRank: 3, fifaPoints: 1877, group: "I", confederation: "UEFA" },
  { code: "NOR", name: "挪威", enName: "Norway", flag: "🇳🇴", fifaRank: 31, fifaPoints: 1533, group: "I", confederation: "UEFA" },
  { code: "SEN", name: "塞内加尔", enName: "Senegal", flag: "🇸🇳", fifaRank: 15, fifaPoints: 1648, group: "I", confederation: "CAF" },
  { code: "IRQ", name: "伊拉克", enName: "Iraq", flag: "🇮🇶", fifaRank: 57, fifaPoints: 1410, group: "I", confederation: "AFC" },
  // Group J
  { code: "ALG", name: "阿尔及利亚", enName: "Algeria", flag: "🇩🇿", fifaRank: 28, fifaPoints: 1516, group: "J", confederation: "CAF" },
  { code: "ARG", name: "阿根廷", enName: "Argentina", flag: "🇦🇷", fifaRank: 1, fifaPoints: 1875, group: "J", confederation: "CONMEBOL" },
  { code: "AUT", name: "奥地利", enName: "Austria", flag: "🇦🇹", fifaRank: 24, fifaPoints: 1586, group: "J", confederation: "UEFA" },
  { code: "JOR", name: "约旦", enName: "Jordan", flag: "🇯🇴", fifaRank: 63, fifaPoints: 1390, group: "J", confederation: "AFC" },
  // Group K
  { code: "COL", name: "哥伦比亚", enName: "Colombia", flag: "🇨🇴", fifaRank: 13, fifaPoints: 1701, group: "K", confederation: "CONMEBOL" },
  { code: "COD", name: "刚果(金)", enName: "DR Congo", flag: "🇨🇩", fifaRank: 46, fifaPoints: 1408, group: "K", confederation: "CAF" },
  { code: "POR", name: "葡萄牙", enName: "Portugal", flag: "🇵🇹", fifaRank: 5, fifaPoints: 1764, group: "K", confederation: "UEFA" },
  { code: "UZB", name: "乌兹别克斯坦", enName: "Uzbekistan", flag: "🇺🇿", fifaRank: 50, fifaPoints: 1462, group: "K", confederation: "AFC" },
  // Group L
  { code: "CRO", name: "克罗地亚", enName: "Croatia", flag: "🇭🇷", fifaRank: 11, fifaPoints: 1717, group: "L", confederation: "UEFA" },
  { code: "ENG", name: "英格兰", enName: "England", flag: "🏴", fifaRank: 4, fifaPoints: 1826, group: "L", confederation: "UEFA" },
  { code: "GHA", name: "加纳", enName: "Ghana", flag: "🇬🇭", fifaRank: 73, fifaPoints: 1335, group: "L", confederation: "CAF" },
  { code: "PAN", name: "巴拿马", enName: "Panama", flag: "🇵🇦", fifaRank: 34, fifaPoints: 1540, group: "L", confederation: "CONCACAF" },
]

export function getTeam(code: string): Team {
  return TEAMS.find((t) => t.code === code) as Team
}

const VENUES: {
  key: string
  venue: string
  city: string
  altitude: number
  capacity: number
  surface: string
  weather: { tempC: number; condition: string; humidity: number; windKmh: number }
}[] = [
  { key: "East Rutherford", venue: "MetLife 体育场", city: "纽约/新泽西", altitude: 7, capacity: 82500, surface: "天然草", weather: { tempC: 24, condition: "多云", humidity: 62, windKmh: 14 } },
  { key: "Inglewood", venue: "SoFi 体育场", city: "洛杉矶", altitude: 30, capacity: 70240, surface: "混合草", weather: { tempC: 27, condition: "晴", humidity: 45, windKmh: 9 } },
  { key: "Arlington", venue: "AT&T 体育场", city: "达拉斯", altitude: 180, capacity: 80000, surface: "天然草(室内)", weather: { tempC: 31, condition: "闷热", humidity: 55, windKmh: 6 } },
  { key: "Mexico City", venue: "Azteca 体育场", city: "墨西哥城", altitude: 2240, capacity: 87000, surface: "天然草", weather: { tempC: 22, condition: "薄云", humidity: 48, windKmh: 11 } },
  { key: "Vancouver", venue: "BC Place", city: "温哥华", altitude: 3, capacity: 54500, surface: "混合草", weather: { tempC: 19, condition: "小雨", humidity: 74, windKmh: 16 } },
  { key: "Atlanta", venue: "Mercedes-Benz 体育场", city: "亚特兰大", altitude: 320, capacity: 71000, surface: "混合草(室内)", weather: { tempC: 28, condition: "雷阵雨", humidity: 70, windKmh: 8 } },
  { key: "Miami Gardens", venue: "Hard Rock 体育场", city: "迈阿密", altitude: 2, capacity: 65300, surface: "天然草", weather: { tempC: 32, condition: "湿热", humidity: 78, windKmh: 12 } },
  { key: "Philadelphia", venue: "Lincoln Financial Field", city: "费城", altitude: 12, capacity: 69300, surface: "天然草", weather: { tempC: 25, condition: "晴间多云", humidity: 58, windKmh: 13 } },
  { key: "Santa Clara", venue: "Levi's 体育场", city: "旧金山湾区", altitude: 4, capacity: 68500, surface: "天然草", weather: { tempC: 24, condition: "晴", humidity: 52, windKmh: 15 } },
  { key: "Houston", venue: "NRG 体育场", city: "休斯顿", altitude: 15, capacity: 72220, surface: "天然草(可开合顶)", weather: { tempC: 33, condition: "闷热", humidity: 74, windKmh: 7 } },
  { key: "Kansas City", venue: "Arrowhead 体育场", city: "堪萨斯城", altitude: 270, capacity: 76416, surface: "天然草", weather: { tempC: 32, condition: "晴热", humidity: 56, windKmh: 12 } },
  { key: "Seattle", venue: "Lumen Field", city: "西雅图", altitude: 5, capacity: 68740, surface: "混合草", weather: { tempC: 20, condition: "多云", humidity: 66, windKmh: 13 } },
  { key: "Foxborough", venue: "Gillette 体育场", city: "波士顿", altitude: 90, capacity: 65878, surface: "天然草", weather: { tempC: 23, condition: "晴间多云", humidity: 60, windKmh: 14 } },
  { key: "Toronto", venue: "BMO Field", city: "多伦多", altitude: 76, capacity: 45736, surface: "天然草", weather: { tempC: 22, condition: "多云", humidity: 64, windKmh: 12 } },
  { key: "Zapopan", venue: "Akron 体育场", city: "瓜达拉哈拉", altitude: 1566, capacity: 49850, surface: "天然草", weather: { tempC: 24, condition: "薄云", humidity: 50, windKmh: 10 } },
  { key: "Guadalupe", venue: "BBVA 体育场", city: "蒙特雷", altitude: 500, capacity: 53500, surface: "天然草", weather: { tempC: 28, condition: "晴", humidity: 46, windKmh: 9 } },
]

export const VENUE_BY_KEY: Record<string, (typeof VENUES)[number]> = Object.fromEntries(
  VENUES.map((v) => [v.key, v]),
)
// 模块级队码索引（getMatchWithLiveProfile 重算某场时用）。
const TEAMS_BY_CODE: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [t.code, t]))
const VENUE_BY_NAME: Record<string, (typeof VENUES)[number]> = Object.fromEntries(
  VENUES.map((v) => [v.venue, v]),
)

// 2026 世界杯真实小组赛程：每组 6 场真实对阵
// 格式 [主队码, 客队码, UTC日期, UTC时间, 城市]，数据来源：FIFA 官方 / Wikipedia
export type Fixture = [string, string, string, string, string]
export const FIXTURES: Record<string, Fixture[]> = {
  A: [
    ["MEX", "RSA", "2026-06-11", "19:00", "Mexico City"],
    ["KOR", "CZE", "2026-06-12", "02:00", "Zapopan"],
    ["CZE", "RSA", "2026-06-18", "16:00", "Atlanta"],
    ["MEX", "KOR", "2026-06-19", "01:00", "Zapopan"],
    ["CZE", "MEX", "2026-06-25", "01:00", "Mexico City"],
    ["RSA", "KOR", "2026-06-25", "01:00", "Guadalupe"],
  ],
  B: [
    ["CAN", "BIH", "2026-06-12", "19:00", "Toronto"],
    ["QAT", "SUI", "2026-06-13", "19:00", "Santa Clara"],
    ["SUI", "BIH", "2026-06-18", "19:00", "Inglewood"],
    ["CAN", "QAT", "2026-06-18", "22:00", "Vancouver"],
    ["SUI", "CAN", "2026-06-24", "19:00", "Vancouver"],
    ["BIH", "QAT", "2026-06-24", "19:00", "Seattle"],
  ],
  C: [
    ["BRA", "MAR", "2026-06-13", "22:00", "East Rutherford"],
    ["HAI", "SCO", "2026-06-14", "01:00", "Foxborough"],
    ["SCO", "MAR", "2026-06-19", "22:00", "Foxborough"],
    ["BRA", "HAI", "2026-06-20", "00:30", "Philadelphia"],
    ["SCO", "BRA", "2026-06-24", "22:00", "Miami Gardens"],
    ["MAR", "HAI", "2026-06-24", "22:00", "Atlanta"],
  ],
  D: [
    ["USA", "PAR", "2026-06-13", "01:00", "Inglewood"],
    ["AUS", "TUR", "2026-06-14", "04:00", "Vancouver"],
    ["USA", "AUS", "2026-06-19", "19:00", "Seattle"],
    ["TUR", "PAR", "2026-06-20", "03:00", "Santa Clara"],
    ["TUR", "USA", "2026-06-26", "02:00", "Inglewood"],
    ["PAR", "AUS", "2026-06-26", "02:00", "Santa Clara"],
  ],
  E: [
    ["GER", "CUW", "2026-06-14", "17:00", "Houston"],
    ["CIV", "ECU", "2026-06-14", "23:00", "Philadelphia"],
    ["GER", "CIV", "2026-06-20", "20:00", "Toronto"],
    ["ECU", "CUW", "2026-06-21", "00:00", "Kansas City"],
    ["CUW", "CIV", "2026-06-25", "20:00", "Philadelphia"],
    ["ECU", "GER", "2026-06-25", "20:00", "East Rutherford"],
  ],
  F: [
    ["NED", "JPN", "2026-06-14", "20:00", "Arlington"],
    ["SWE", "TUN", "2026-06-15", "02:00", "Guadalupe"],
    ["NED", "SWE", "2026-06-20", "17:00", "Houston"],
    ["TUN", "JPN", "2026-06-21", "04:00", "Guadalupe"],
    ["JPN", "SWE", "2026-06-25", "23:00", "Arlington"],
    ["TUN", "NED", "2026-06-25", "23:00", "Kansas City"],
  ],
  G: [
    ["BEL", "EGY", "2026-06-15", "19:00", "Seattle"],
    ["IRN", "NZL", "2026-06-16", "01:00", "Inglewood"],
    ["BEL", "IRN", "2026-06-21", "19:00", "Inglewood"],
    ["NZL", "EGY", "2026-06-22", "01:00", "Vancouver"],
    ["EGY", "IRN", "2026-06-27", "03:00", "Seattle"],
    ["NZL", "BEL", "2026-06-27", "03:00", "Vancouver"],
  ],
  H: [
    ["ESP", "CPV", "2026-06-15", "16:00", "Atlanta"],
    ["KSA", "URU", "2026-06-15", "22:00", "Miami Gardens"],
    ["ESP", "KSA", "2026-06-21", "16:00", "Atlanta"],
    ["URU", "CPV", "2026-06-21", "22:00", "Miami Gardens"],
    ["CPV", "KSA", "2026-06-27", "00:00", "Houston"],
    ["URU", "ESP", "2026-06-27", "00:00", "Zapopan"],
  ],
  I: [
    ["FRA", "SEN", "2026-06-16", "19:00", "East Rutherford"],
    ["IRQ", "NOR", "2026-06-16", "22:00", "Foxborough"],
    ["FRA", "IRQ", "2026-06-22", "21:00", "Philadelphia"],
    ["NOR", "SEN", "2026-06-23", "00:00", "East Rutherford"],
    ["NOR", "FRA", "2026-06-26", "19:00", "Foxborough"],
    ["SEN", "IRQ", "2026-06-26", "19:00", "Toronto"],
  ],
  J: [
    ["ARG", "ALG", "2026-06-17", "01:00", "Kansas City"],
    ["AUT", "JOR", "2026-06-17", "04:00", "Santa Clara"],
    ["ARG", "AUT", "2026-06-22", "17:00", "Arlington"],
    ["JOR", "ALG", "2026-06-23", "03:00", "Santa Clara"],
    ["ALG", "AUT", "2026-06-28", "02:00", "Kansas City"],
    ["JOR", "ARG", "2026-06-28", "02:00", "Arlington"],
  ],
  K: [
    ["POR", "COD", "2026-06-17", "17:00", "Houston"],
    ["UZB", "COL", "2026-06-18", "02:00", "Mexico City"],
    ["POR", "UZB", "2026-06-23", "17:00", "Houston"],
    ["COL", "COD", "2026-06-24", "02:00", "Zapopan"],
    ["COL", "POR", "2026-06-27", "23:30", "Miami Gardens"],
    ["COD", "UZB", "2026-06-27", "23:30", "Atlanta"],
  ],
  L: [
    ["ENG", "CRO", "2026-06-17", "20:00", "Arlington"],
    ["GHA", "PAN", "2026-06-17", "23:00", "Toronto"],
    ["ENG", "GHA", "2026-06-23", "20:00", "Foxborough"],
    ["PAN", "CRO", "2026-06-23", "23:00", "Toronto"],
    ["PAN", "ENG", "2026-06-27", "21:00", "East Rutherford"],
    ["CRO", "GHA", "2026-06-27", "21:00", "Philadelphia"],
  ],
}

// player surname pool (transliterated, demo data)
const SURNAMES = [
  "席尔瓦", "桑托斯", "加西亚", "罗德里", "穆勒", "费尔南德斯", "科斯塔", "莫雷诺",
  "佩雷斯", "门多萨", "本田", "迪亚洛", "特劳雷", "范戴克", "贝克尔", "汉森",
  "诺瓦克", "佩特罗夫", "坎特", "格列兹曼", "佩德里", "略伦特", "巴埃纳", "奥亚萨瓦尔",
  "卡马文加", "维尼修斯", "罗梅罗", "麦卡利斯特", "恩昆库", "若塔", "哈兰德", "福登",
]

const COACH_NAMES = [
  "斯卡洛尼", "德尚", "德拉富恩特", "图赫尔", "纳格尔斯曼", "斯帕莱蒂", "马丁内斯",
  "克洛普", "瓜迪奥拉", "安切洛蒂", "弗里克", "西蒙尼", "波切蒂诺", "阿尔特塔",
]
const COACH_STYLES = [
  "高位逼抢 + 快速转换", "稳固防守反击", "控球渗透打法", "边路传中冲击",
  "三中卫弹性体系", "中场绞杀控节奏",
]

const REFEREES = [
  { name: "Szymon Marciniak", nat: "波兰", avgYellow: 4.1, avgRed: 0.18, penaltyRate: 0.32, note: "尺度偏严，对拉拽与战术犯规零容忍，补时充足。" },
  { name: "Daniele Orsato", nat: "意大利", avgYellow: 3.4, avgRed: 0.12, penaltyRate: 0.21, note: "让比赛流畅，倾向用语言管理而非出牌。" },
  { name: "Wilton Sampaio", nat: "巴西", avgYellow: 4.8, avgRed: 0.25, penaltyRate: 0.41, note: "判罚点球比例偏高，禁区内接触判罚果断。" },
  { name: "Clément Turpin", nat: "法国", avgYellow: 3.9, avgRed: 0.15, penaltyRate: 0.28, note: "中立稳健，VAR 介入沟通清晰。" },
  { name: "Jalal Jayed", nat: "摩洛哥", avgYellow: 4.3, avgRed: 0.2, penaltyRate: 0.3, note: "经验丰富，对身体对抗容忍度中等。" },
]

// formation templates: x 0-100 width, y 0-100 own goal->attack
const FORMATIONS: Record<string, { num: number; role: string; x: number; y: number }[]> = {
  "4-3-3": [
    { num: 1, role: "门将", x: 50, y: 7 },
    { num: 3, role: "左后卫", x: 15, y: 26 }, { num: 4, role: "中后卫", x: 38, y: 22 }, { num: 5, role: "中后卫", x: 62, y: 22 }, { num: 2, role: "右后卫", x: 85, y: 26 },
    { num: 6, role: "后腰", x: 30, y: 48 }, { num: 8, role: "中场", x: 50, y: 44 }, { num: 14, role: "中场", x: 70, y: 48 },
    { num: 11, role: "左边锋", x: 22, y: 75 }, { num: 9, role: "中锋", x: 50, y: 82 }, { num: 7, role: "右边锋", x: 78, y: 75 },
  ],
  "4-2-3-1": [
    { num: 1, role: "门将", x: 50, y: 7 },
    { num: 3, role: "左后卫", x: 15, y: 26 }, { num: 4, role: "中后卫", x: 38, y: 22 }, { num: 5, role: "中后卫", x: 62, y: 22 }, { num: 2, role: "右后卫", x: 85, y: 26 },
    { num: 6, role: "后腰", x: 38, y: 44 }, { num: 8, role: "后腰", x: 62, y: 44 },
    { num: 11, role: "左前卫", x: 20, y: 66 }, { num: 10, role: "前腰", x: 50, y: 62 }, { num: 7, role: "右前卫", x: 80, y: 66 },
    { num: 9, role: "中锋", x: 50, y: 84 },
  ],
  "3-5-2": [
    { num: 1, role: "门将", x: 50, y: 7 },
    { num: 4, role: "中后卫", x: 28, y: 24 }, { num: 5, role: "中后卫", x: 50, y: 20 }, { num: 6, role: "中后卫", x: 72, y: 24 },
    { num: 3, role: "左翼卫", x: 12, y: 50 }, { num: 8, role: "中场", x: 35, y: 46 }, { num: 10, role: "前腰", x: 50, y: 42 }, { num: 14, role: "中场", x: 65, y: 46 }, { num: 2, role: "右翼卫", x: 88, y: 50 },
    { num: 9, role: "中锋", x: 38, y: 80 }, { num: 7, role: "中锋", x: 62, y: 80 },
  ],
  "4-4-2": [
    { num: 1, role: "门将", x: 50, y: 7 },
    { num: 3, role: "左后卫", x: 15, y: 26 }, { num: 4, role: "中后卫", x: 38, y: 22 }, { num: 5, role: "中后卫", x: 62, y: 22 }, { num: 2, role: "右后卫", x: 85, y: 26 },
    { num: 11, role: "左前卫", x: 18, y: 52 }, { num: 8, role: "中场", x: 40, y: 48 }, { num: 6, role: "中场", x: 60, y: 48 }, { num: 7, role: "右前卫", x: 82, y: 52 },
    { num: 9, role: "中锋", x: 38, y: 80 }, { num: 10, role: "中锋", x: 62, y: 80 },
  ],
}
const FORMATION_KEYS = Object.keys(FORMATIONS)

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length]
}

function buildLineup(team: Team, seed: number): Lineup {
  const key = pick(FORMATION_KEYS, seed + team.fifaRank)
  const tpl = FORMATIONS[key]
  const players = tpl.map((p, i) => ({
    ...p,
    name: SURNAMES[(team.fifaRank * 3 + i * 7 + seed) % SURNAMES.length],
  }))
  return { formation: key, players }
}

// 把真实阵容（按模板槽位顺序排列的 11 个球员名）映射到该阵型的坐标/号码上。
function realLineupToLineup(rl: RealLineup): Lineup {
  const tpl = FORMATIONS[rl.formation] ?? FORMATIONS["4-3-3"]
  const players = tpl.map((p, i) => ({
    ...p,
    name: rl.players[i] ?? "待定",
  }))
  return { formation: rl.formation, players }
}

function buildInjuries(team: Team, seed: number): Injury[] {
  const statuses: Injury["status"][] = ["缺阵", "存疑", "复出"]
  const count = (team.fifaRank + seed) % 3 // 0-2
  const positions = ["中场", "后卫", "前锋", "门将"]
  return Array.from({ length: count }, (_, i) => ({
    name: SURNAMES[(team.fifaRank + i * 5 + seed * 2) % SURNAMES.length],
    pos: positions[(i + seed) % positions.length],
    status: statuses[(i + seed) % statuses.length],
    note: ["肌肉伤势恢复中", "累积黄牌停赛", "赛前合练待评估", "热身赛复出"][(i + seed) % 4],
  }))
}

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1)
}
function poisson(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k)
}

function buildScoreProbs(lambdaH: number, lambdaA: number): {
  scoreProbs: ScoreProb[]
  over25: number
  bttRatio: number
} {
  const grid: { score: string; prob: number; total: number; btts: boolean }[] = []
  for (let i = 0; i <= 5; i++) {
    for (let j = 0; j <= 5; j++) {
      grid.push({
        score: `${i} - ${j}`,
        prob: poisson(i, lambdaH) * poisson(j, lambdaA),
        total: i + j,
        btts: i > 0 && j > 0,
      })
    }
  }
  const totalP = grid.reduce((s, g) => s + g.prob, 0)
  const over25 = Math.round(
    (grid.filter((g) => g.total > 2.5).reduce((s, g) => s + g.prob, 0) / totalP) * 100,
  )
  const bttRatio = Math.round(
    (grid.filter((g) => g.btts).reduce((s, g) => s + g.prob, 0) / totalP) * 100,
  )
  const top = grid
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 6)
    .map((g) => ({ score: g.score, prob: Math.round((g.prob / totalP) * 100) }))
  return { scoreProbs: top, over25, bttRatio }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// 2026 东道主（小组赛享准主场加成）。注意只认这三家，不能按 CONCACAF 整体判定。
export const HOST_CODES = new Set(["USA", "MEX", "CAN"])

// 用 v6 Elo 多因子引擎为【任意一场】小组赛生成预测——实现“全量预测”。
// 优先用校准注册表(V2_CALIB)的特殊因子（海拔/核心缺阵/真实比分等）覆盖；
// 其余场次从两队赛前 FIFA 排名 + 场地海拔 + 东道主自动推导，保证 72 场全部走 v6。
function v2ForMatch(
  home: Team,
  away: Team,
  venue: (typeof VENUES)[number],
  override?: PrematchProfile | null,
): V2Output & {
  real?: [number, number]
  lesson?: string
  realXgForHome?: number
  realXgForAway?: number
  realXgSamplesHome?: number
  realXgSamplesAway?: number
} {
  const key = `${home.code}-${away.code}`
  const e = V2_CALIB[key]
  const host: "home" | "away" | "neutral" =
    e?.host ?? (HOST_CODES.has(home.code) ? "home" : HOST_CODES.has(away.code) ? "away" : "neutral")
  // 真实赛前近期状态：把净胜球趋势钳制到模型期望区间 [-3,3]。仅在该队赛前确有样本时生效。
  const clampForm = (v: number | undefined) =>
    v == null ? undefined : Math.max(-3, Math.min(3, v))
  const pre = resolvePrematch(key, override)
  const realFormHome = pre && pre.home.games > 0 ? clampForm(pre.home.formGD) : undefined
  const realFormAway = pre && pre.away.games > 0 ? clampForm(pre.away.formGD) : undefined
  // 真实核心球员缺阵：等效缺阵核心数（kaEquiv），钳到 [0,2] 防极端（部分缺阵实为轮换）。仅有阵容时生效。
  const clampKa = (c: CoreInfo | undefined) =>
    c && c.hasData ? Math.min(2, Math.max(0, c.kaEquiv)) : undefined
  const realKaHome = clampKa(pre?.coreHome)
  const realKaAway = clampKa(pre?.coreAway)
  const out = predictV2({
    rankHome: e?.rankHome ?? home.fifaRank,
    rankAway: e?.rankAway ?? away.fifaRank,
    host,
    alt: e?.alt ?? venue.altitude,
    // 优先级：V2_CALIB 显式标注 > 真实数据（来自 DB） > 无
    kaHome: e?.kaHome ?? realKaHome,
    kaAway: e?.kaAway ?? realKaAway,
    formHome: e?.formHome ?? realFormHome,
    formAway: e?.formAway ?? realFormAway,
    // B1：真实 xG 推得的 λ + 样本数（仅实时画像有；无样本→nHome/nAway=0→纯排名）
    xgHome: pre?.xgLambdaHome,
    xgAway: pre?.xgLambdaAway,
    nHome: pre?.nHome,
    nAway: pre?.nAway,
  })
  return {
    ...out,
    real: e?.real,
    lesson: e?.lesson,
    realXgForHome: pre?.realXgForHome,
    realXgForAway: pre?.realXgForAway,
    realXgSamplesHome: pre?.nHome,
    realXgSamplesAway: pre?.nAway,
  }
}

// 球星出场状态：从画像里取两队球星逐人状态（首发/替补待命/未进名单），供展示层。
function starAvailabilityFor(key: string, override?: PrematchProfile | null) {
  const pre = resolvePrematch(key, override)
  const home = pre?.coreHome?.stars ?? []
  const away = pre?.coreAway?.stars ?? []
  if (!home.length && !away.length) return undefined
  return { home, away }
}

// 由 starAvailability 实时派生一条"核心球员可用性"关键因素行（数据驱动、非静态写死）。
// 规则：列出未首发的球星（替补待命/未进名单）；两边都齐整则不生成此行。
// edge：哪边核心缺得多、缺得重，劣势归对方。以后任何球星没首发，只要在球星表里就自动出现。
function starFactorFor(key: string, override?: PrematchProfile | null): MatchFactor | null {
  const sa = starAvailabilityFor(key, override)
  if (!sa) return null
  const summarize = (stars: { display: string; tier: number; status: string }[]) => {
    const missing = stars.filter((s) => s.status !== "首发")
    if (!missing.length) return { text: "核心球星全部首发", weight: 0 }
    // tier1 缺阵权重更高；替补待命比未进名单影响小
    const weight = missing.reduce(
      (w, s) => w + (s.tier === 1 ? 1 : 0.6) * (s.status === "替补待命" ? 0.4 : 1),
      0,
    )
    const text = missing.map((s) => `${s.display}（${s.status}）`).join("、")
    return { text, weight }
  }
  const h = summarize(sa.home)
  const a = summarize(sa.away)
  if (h.weight === 0 && a.weight === 0) return null // 两边都齐整，无看点
  // 谁缺得重谁吃亏；差距很小算 even
  const edge: MatchFactor["edge"] =
    Math.abs(h.weight - a.weight) < 0.5 ? "even" : h.weight > a.weight ? "away" : "home"
  return { label: "核心球员可用性", home: h.text, away: a.text, edge }
}

function buildDetail(
  home: Team,
  away: Team,
  idx: number,
  venue: (typeof VENUES)[number],
  override?: PrematchProfile | null,
  lineupKind?: LineupKind,
): MatchDetail {
  const key = `${home.code}-${away.code}`
  const real = REAL_ANALYSIS[key]
  const v2 = v2ForMatch(home, away, venue, override)
  // 进球期望 λ 与比分分布优先级：v6 Elo多因子引擎 > 真实分析 λ > v1 模型
  const mp = MATCH_PREDS[key]
  const lambdaH = v2?.egHome ?? real?.egHome ?? mp.egHome
  const lambdaA = v2?.egAway ?? real?.egAway ?? mp.egAway
  // 比分分布：v6 直接给出 scoreProbs/over25/btts（均为 0-100 整数），保证与胜平负条同源
  const fallback = buildScoreProbs(lambdaH, lambdaA)
  const scoreProbs = v2?.scoreProbs ?? fallback.scoreProbs
  const over25 = v2 ? v2.over25 : fallback.over25
  const bttRatio = v2 ? v2.bttRatio : fallback.bttRatio
  // 冷门风险（A 段）：把尾部概率显性化，比分榜永远保留一个“冷门情形”槽
  const upsetProb = v2?.upsetProb ?? 0
  const upsetScore = v2?.upsetScore ?? "0 - 0"
  const underdogName =
    v2?.upsetLabel?.startsWith("客队") ? away.name : v2?.upsetLabel?.startsWith("主队") ? home.name : ""
  const upsetLabel = underdogName ? `${underdogName}逼平或爆冷` : "势均力敌，任一方均可能打破均势"
  const ref = pick(REFEREES, idx)
  const altEdge: MatchFactor["edge"] =
    venue.altitude > 1500 ? (home.confederation === "CONCACAF" ? "home" : "away") : "even"

  // expected goals = 模型 λ
  const xgHome = lambdaH
  const xgAway = lambdaA

  // possession / shots projection from rank gap
  const possessionHome = clamp(50 + (away.fifaRank - home.fifaRank) * 0.4, 32, 68)
  const shotsHome = Math.round(8 + lambdaH * 3 + (idx % 4))
  const shotsAway = Math.round(8 + lambdaA * 3 + ((idx + 2) % 4))

  // head-to-head history (deterministic pseudo data)
  const totalH2H = 5
  const homeWins = clamp(Math.round(2 + (away.fifaRank - home.fifaRank) * 0.03), 0, 5)
  const awayWins = clamp(Math.round((totalH2H - homeWins) * 0.5), 0, totalH2H - homeWins)
  const draws = totalH2H - homeWins - awayWins
  const h2hResults = ["主胜", "平局", "客胜"]
  const h2hYears = [2024, 2022, 2021, 2018, 2014]
  const last = h2hYears.map((y, i) => {
    const r = i < homeWins ? 0 : i < homeWins + draws ? 1 : 2
    const sH = r === 0 ? 2 : r === 1 ? 1 : 0
    const sA = r === 2 ? 2 : r === 1 ? 1 : 0
    return { date: `${y}`, result: h2hResults[r], score: `${sH} - ${sA}` }
  })

  // 核心球员可用性因素行（数据驱动；两边球星都首发时为 null，不展示）。
  const starFactor = starFactorFor(key, override)

  if (real) {
    // 真实联网数据优先：用核实后的阵容/伤停/教练/裁判/交锋/概率覆盖伪随机生成值
    // 比分分布统一采用顶部已算好的 v6 值（scoreProbs/over25/bttRatio），与胜平负条同源
    return {
      lineupKind: lineupKind ?? "confirmed",
      homeLineup: realLineupToLineup(real.homeLineup),
      awayLineup: realLineupToLineup(real.awayLineup),
      homeInjuries: real.homeInjuries,
      awayInjuries: real.awayInjuries,
      homeCoach: real.homeCoach,
      awayCoach: real.awayCoach,
      referee: real.referee,
      venueInfo: {
        altitude: venue.altitude,
        capacity: venue.capacity,
        surface: venue.surface,
        weather: venue.weather,
      },
      factors: starFactor ? [starFactor, ...real.factors] : real.factors,
      scoreProbs,
      over25,
      bttRatio,
      upsetProb,
      upsetLabel,
      upsetScore,
      calibrationNote: real.calibrationNote,
      dataMode: "real",
      realData: { lineups: true, events: true, referee: true, coaches: true, injuries: true, factors: true },
      sources: real.sources,
      xgHome: lambdaH,
      xgAway: lambdaA,
      h2h: real.h2h,
      possessionHome: real.possessionHome,
      shotsHome: real.shotsHome,
      shotsAway: real.shotsAway,
      starAvailability: starAvailabilityFor(key, override),
    }
  }

  return {
    lineupKind: lineupKind ?? "predicted",
    homeLineup: buildLineup(home, idx + 1),
    awayLineup: buildLineup(away, idx + 5),
    homeInjuries: buildInjuries(home, idx + 1),
    awayInjuries: buildInjuries(away, idx + 4),
    homeCoach: {
      name: pick(COACH_NAMES, home.fifaRank + idx),
      nat: home.enName,
      style: pick(COACH_STYLES, home.fifaRank + idx),
    },
    awayCoach: {
      name: pick(COACH_NAMES, away.fifaRank + idx + 3),
      nat: away.enName,
      style: pick(COACH_STYLES, away.fifaRank + idx + 2),
    },
    referee: ref,
    venueInfo: {
      altitude: venue.altitude,
      capacity: venue.capacity,
      surface: venue.surface,
      weather: venue.weather,
    },
    dataMode: "model",
    factors: [
      ...(starFactor ? [starFactor] : []),
      {
        label: "阵容深度",
        home: home.fifaRank < away.fifaRank ? "板凳厚度占优" : "主力依赖度高",
        away: away.fifaRank < home.fifaRank ? "板凳厚度占优" : "轮换空间有限",
        edge: home.fifaRank < away.fifaRank ? "home" : "away",
      },
      {
        label: "伤病情况",
        home: `${buildInjuries(home, idx + 1).length} 人受影响`,
        away: `${buildInjuries(away, idx + 4).length} 人受影响`,
        edge:
          buildInjuries(home, idx + 1).length < buildInjuries(away, idx + 4).length
            ? "home"
            : buildInjuries(home, idx + 1).length > buildInjuries(away, idx + 4).length
              ? "away"
              : "even",
      },
      {
        label: "主教练博弈",
        home: pick(COACH_STYLES, home.fifaRank + idx),
        away: pick(COACH_STYLES, away.fifaRank + idx + 2),
        edge: home.fifaRank < away.fifaRank ? "home" : "away",
      },
      {
        label: "裁判倾向",
        home: ref.penaltyRate > 0.3 ? "受益于造点能力" : "对抗判罚中性",
        away: ref.avgYellow > 4 ? "需控制犯规累积" : "纪律风险可控",
        edge: "even",
      },
      {
        label: "场地适应",
        home: `${venue.surface} · 主场氛围`,
        away: "客场作战需适应",
        edge: "home",
      },
      {
        label: "海拔与天气",
        home: venue.altitude > 1500 ? `${venue.altitude}m 高原` : `${venue.weather.condition} ${venue.weather.tempC}°C`,
        away: venue.altitude > 1500 ? "高原体能消耗大" : `湿度 ${venue.weather.humidity}%`,
        edge: altEdge,
      },
    ],
    scoreProbs,
    over25,
    bttRatio,
    upsetProb,
    upsetLabel,
    upsetScore,
    calibrationNote: `胜平负概率经 Platt 校准与历史赛果回测对齐，预期进球 λ(主)=${lambdaH.toFixed(
      2,
    )}、λ(客)=${lambdaA.toFixed(2)}，比分分布由双泊松模型推导。`,
    xgHome,
    xgAway,
    // WS1：盘口主导展示 + 真实场均 xG
    marginBuckets: v2?.marginBuckets,
    markets: v2?.markets,
    topInsight: v2?.topInsight,
    realXgForHome: v2?.realXgForHome,
    realXgForAway: v2?.realXgForAway,
    realXgSamplesHome: v2?.realXgSamplesHome,
    realXgSamplesAway: v2?.realXgSamplesAway,
    h2h: { homeWins, draws, awayWins, last },
    possessionHome,
    shotsHome,
    shotsAway,
    starAvailability: starAvailabilityFor(key, override),
  }
}

// 已开赛场次的真实比分（键为 "主队码-客队码"），数据来源：FIFA 官方 / Wikipedia
export const RESULTS: Record<string, [number, number]> = {
  "MEX-RSA": [2, 0],
  "KOR-CZE": [2, 1],
  "USA-PAR": [4, 1],
  "CAN-BIH": [1, 1],
  "QAT-SUI": [1, 1],
  "BRA-MAR": [1, 1],
  "HAI-SCO": [0, 1],
  "AUS-TUR": [2, 0],
  "GER-CUW": [7, 1],
  "CIV-ECU": [1, 0],
  "NED-JPN": [2, 2],
}

// Build matches per group using the REAL 2026 World Cup schedule + REAL results.
// "Now" reference 对齐真实进度：A–E 组首轮及荷兰vs日本已赛完，瑞典vs突尼斯(6/15)起尚未开赛。
// 导出为应用统一的"当前时刻"基准，用于赛事状态判定与"今日赛程"定位（按所选时区换算）。
export const NOW_ISO = "2026-06-15T01:30:00Z"
const NOW_REF = new Date(NOW_ISO)

function buildMatches(): Match[] {
  const matches: Match[] = []

  const teamByCode: Record<string, Team> = Object.fromEntries(TEAMS.map((t) => [t.code, t]))

  GROUPS.forEach((g, gi) => {
    const fixtures = FIXTURES[g]
    fixtures.forEach((fx, pi) => {
      const [homeCode, awayCode, date, time, cityKey] = fx
      const home = teamByCode[homeCode]
      const away = teamByCode[awayCode]
      const kickoff = new Date(`${date}T${time}:00Z`)
      const venue = VENUE_BY_KEY[cityKey] ?? VENUES[0]
      const idx = gi * 6 + pi
      const result = RESULTS[`${homeCode}-${awayCode}`]

      // 有真实比分 → 已结束；否则按开球时间相对当前时间推导
      const endTime = kickoff.getTime() + 110 * 60 * 1000
      let status: MatchStatus = "upcoming"
      let homeScore: number | undefined
      let awayScore: number | undefined
      let minute: number | undefined
      if (result) {
        status = "finished"
        homeScore = result[0]
        awayScore = result[1]
      } else if (NOW_REF.getTime() >= endTime) {
        // 已过开球结束时间但暂无真实比分：标记为已结束，比分留空待补
        status = "finished"
      } else if (NOW_REF.getTime() >= kickoff.getTime()) {
        status = "live"
        minute = Math.min(90, Math.max(1, Math.round((NOW_REF.getTime() - kickoff.getTime()) / 60000)))
        homeScore = 0
        awayScore = 0
      }

      // 全量预测：每一场都用 v6 Elo多因子引擎（v2ForMatch 内部按需叠加真实分析的特殊因子）
      const key = `${home.code}-${away.code}`
      const v2 = v2ForMatch(home, away, venue)
      const real = REAL_ANALYSIS[key]
      const pred = MATCH_PREDS[key]
      // 近期状态：优先用深度分析(real)的真实战绩，其次用联网核实的 VERIFIED_FORM；都没有则“暂无”
      const vForm = VERIFIED_FORM[key]
      const formHomeReal = real?.formHome ?? vForm?.home ?? []
      const formAwayReal = real?.formAway ?? vForm?.away ?? []
      const formIsVerified = formHomeReal.length > 0 && formAwayReal.length > 0
      const confLabel = pred.confidence === "high" ? "较高" : pred.confidence === "medium" ? "中等" : "偏低"
      const upsetLabel = pred.upsetRisk === "high" ? "较高" : pred.upsetRisk === "medium" ? "中等" : "较低"

      let aiBlock: Match["ai"]
      if (v2) {
        // —— v6 Elo多因子引擎（已完赛 11 场 + 已分析未开赛 4 场）——
        const favored2 = v2.homeWin > v2.awayWin ? home.name : v2.awayWin > v2.homeWin ? away.name : "双方"
        const confTxt = v2.confidence >= 65 ? "较高" : v2.confidence >= 45 ? "中等" : "偏低"
        const blowTxt = v2.blowoutProb >= 35 ? `，大胜风险偏高（P(净胜≥3)≈${v2.blowoutProb}%）` : ""
        // 冷门信号：冷门指数 = 冷门概率 × 实力悬殊度，势均力敌(favProb≈50%)趋近 0，仅“强弱分明但弱队有翻车概率”冒头
        const favProb2 = Math.max(v2.homeWin, v2.awayWin) / 100
        const upIndex2 = Math.round(v2.upsetProb * Math.max(0, (favProb2 - 0.5) / 0.5))
        const underdogName2 = v2.upsetLabel.startsWith("客队") ? away.name : v2.upsetLabel.startsWith("主队") ? home.name : ""
        const upLabel2 = underdogName2 ? `${underdogName2}逼平或爆冷` : "势均力敌，难分胜负"
        // 全部场次统一用「赛前预测」口径（含已完赛）：只呈现赛前研判，不写赛后复盘/真实比分对照。
        aiBlock = {
          homeWin: v2.homeWin,
          draw: v2.draw,
          awayWin: v2.awayWin,
          predictedScore: v2.predictedScore,
          confidence: v2.confidence,
          formHome: formHomeReal,
          formAway: formAwayReal,
          formVerified: formIsVerified,
          upsetProb: v2.upsetProb,
          upsetIndex: upIndex2,
          upsetLabel: upLabel2,
          upsetScore: v2.upsetScore,
          keyPoints: [
            `opus4.8 预期进球：${home.name} ${v2.egHome} - ${v2.egAway} ${away.name}，最可能比分 ${v2.predictedScore}。`,
            `90 分钟胜平负 ${v2.homeWin}% / ${v2.draw}% / ${v2.awayWin}%${blowTxt}。`,
            `大于 2.5 球概率约 ${v2.over25}%，双方均进球约 ${v2.bttRatio}%。`,
            ...(real?.keyPoints?.slice(0, 1) ?? []),
          ],
          summary: `opus4.8 Elo模型研判 90 分钟胜平负为 ${v2.homeWin}% / ${v2.draw}% / ${v2.awayWin}%，${favored2}占优（置信度${confTxt}）。预期进球约 ${v2.egHome}-${v2.egAway}，最可能比分 ${v2.predictedScore}${blowTxt}。`,
        }
      } else {
        // —— v1 离线模型回退（尚未做深度分析的场次）——
        const homeWin = Math.round(pred.homeWin)
        const draw = Math.round(pred.draw)
        const awayWin = Math.round(pred.awayWin)
        const favored = homeWin > awayWin ? home.name : awayWin > homeWin ? away.name : "双方"
        aiBlock = {
          homeWin,
          draw,
          awayWin,
          predictedScore: pred.top[0]?.score ?? "1 - 1",
          confidence: Math.round(Math.max(pred.homeWin, pred.draw, pred.awayWin)),
          formHome: [],
          formAway: [],
          formVerified: false,
          upsetProb: 100 - Math.max(homeWin, awayWin),
          upsetIndex: Math.round((100 - Math.max(homeWin, awayWin)) * Math.max(0, (Math.max(homeWin, awayWin) / 100 - 0.5) / 0.5)),
          upsetLabel: `${homeWin > awayWin ? away.name : home.name}逼平或爆冷`,
          upsetScore: pred.top.find((t) => t.score !== (pred.top[0]?.score ?? ""))?.score ?? "1 - 1",
          keyPoints: [
            `opus4.8 预期进球：${home.name} ${pred.egHome.toFixed(2)} - ${pred.egAway.toFixed(2)} ${away.name}。`,
            `最可能比分 ${pred.top[0]?.score ?? "1 - 1"}（约 ${pred.top[0]?.prob ?? 0}%），其次 ${pred.top[1]?.score ?? "-"}、${pred.top[2]?.score ?? "-"}。`,
            `opus4.8 置信度${confLabel}，爆冷风险${upsetLabel}。`,
            ...pred.explanation.slice(1, 3),
          ],
          summary: `opus4.8 Elo模型基于评分差与 Dixon-Coles 进球分布，估算 90 分钟胜平负为 ${homeWin}% / ${draw}% / ${awayWin}%，${favored}略占上风（置信度${confLabel}、爆冷风险${upsetLabel}）。预期进球约 ${pred.egHome.toFixed(2)}-${pred.egAway.toFixed(2)}，最可能比分 ${pred.top[0]?.score ?? "1 - 1"}。`,
        }
      }

      matches.push({
        id: `m${idx + 1}`,
        group: g,
        stage: "小组赛",
        kickoff: kickoff.toISOString(),
        status,
        minute,
        homeCode: home.code,
        awayCode: away.code,
        homeScore,
        awayScore,
        venue: venue.venue,
        city: venue.city,
        ai: aiBlock,
        detail: buildDetail(home, away, idx, venue),
      })
    })
  })
  return matches
}

export const MATCHES: Match[] = buildMatches()

export function getMatch(id: string): Match | undefined {
  return MATCHES.find((m) => m.id === id)
}

// 按 id 取淘汰赛静态槽位（m73…m104）。详情页用它 + 已解析对阵构建完整 Match。
export function getKnockoutSlot(id: string): KnockoutMatch | undefined {
  return KNOCKOUT.find((k) => k.id === id)
}

// Phase 3：用请求时实时画像（来自 DB）重算某场的 detail（预测/球星状态/核心因素）。
// override=null 时等价于 getMatch（用静态快照）。页面层在服务端取 getLiveProfile 后调用此函数，
// 即可做到"官方阵容一入库 → 下次访问预测自动重算"，无需重跑脚本或重新 build。
export function getMatchWithLiveProfile(
  id: string,
  override: PrematchProfile | null,
  lineupKind?: LineupKind,
): Match | undefined {
  const base = MATCHES.find((m) => m.id === id)
  if (!base || !override) return base
  const home = TEAMS_BY_CODE[base.homeCode]
  const away = TEAMS_BY_CODE[base.awayCode]
  if (!home || !away) return base
  const idx = Math.max(0, parseInt(base.id.replace(/\D/g, ""), 10) - 1)
  const venue = VENUE_BY_NAME[base.venue] ?? VENUES[0]
  return { ...base, detail: buildDetail(home, away, idx, venue, override, lineupKind ?? base.detail.lineupKind) }
}

// Compute standings from finished matches.
// 可传入合并了实时数据的 matches；不传则用静态 MATCHES。
export function computeStandings(
  group: string,
  matches: Match[] = MATCHES,
): (Standing & { team: Team })[] {
  const teams = TEAMS.filter((t) => t.group === group)
  const table: Record<string, Standing> = {}
  teams.forEach((t) => {
    table[t.code] = {
      teamCode: t.code,
      played: 0,
      win: 0,
      draw: 0,
      loss: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      qualifyProb: 0,
    }
  })

  matches.filter((m) => m.group === group && m.status !== "upcoming").forEach((m) => {
    if (m.homeScore == null || m.awayScore == null) return
    const h = table[m.homeCode]
    const a = table[m.awayCode]
    h.played++
    a.played++
    h.goalsFor += m.homeScore
    h.goalsAgainst += m.awayScore
    a.goalsFor += m.awayScore
    a.goalsAgainst += m.homeScore
    if (m.homeScore > m.awayScore) {
      h.win++
      h.points += 3
      a.loss++
    } else if (m.homeScore < m.awayScore) {
      a.win++
      a.points += 3
      h.loss++
    } else {
      h.draw++
      a.draw++
      h.points++
      a.points++
    }
  })

  const sorted = teams
    .map((t) => ({ ...table[t.code], team: t }))
    .sort((x, y) => {
      if (y.points !== x.points) return y.points - x.points
      const xgd = x.goalsFor - x.goalsAgainst
      const ygd = y.goalsFor - y.goalsAgainst
      if (ygd !== xgd) return ygd - xgd
      return y.goalsFor - x.goalsFor
    })

  // AI 出线概率：来自 v6 锦标赛蒙特卡洛模拟（晋级 32 强概率，已计入真实战果）
  return sorted.map((s) => {
    const advance = CHAMPION_SIM[s.team.code]?.qualify ?? 0
    return { ...s, qualifyProb: Math.max(1, Math.min(99, Math.round(advance))) }
  })
}

export const FIFA_RANKING = [...TEAMS].sort((a, b) => a.fifaRank - b.fifaRank)

// ---- 淘汰赛（席位占位）----
// 2026 世界杯淘汰赛共 32 场（第 73–104 场），参赛队取决于小组赛结果，因此这里只列
// FIFA 官方公布的「席位编排 + 真实日期 / 球场 / 开球时间」，绝不臆造参赛队伍。
// 数据来源：FIFA 官方赛程 / Wikipedia「2026 FIFA World Cup knockout stage」。
  // 开球时间统一以 UTC 记录（与小组赛一致，由前端按用户时区换算）。
export type KnockoutStage = "R32" | "R16" | "QF" | "SF" | "3RD" | "FINAL"

export const KNOCKOUT_STAGE_LABEL: Record<KnockoutStage, string> = {
  R32: "32 强",
  R16: "16 强",
  QF: "8 强",
  SF: "半决赛",
  "3RD": "三四名决赛",
  FINAL: "决赛",
}

// 阶段筛选顺序（含小组赛），供赛程页的阶段 Chip 使用
export const STAGE_FILTERS: { key: string; label: string }[] = [
  { key: "ALL", label: "全部" },
  { key: "GROUP", label: "小组赛" },
  { key: "R32", label: "32 强" },
  { key: "R16", label: "16 强" },
  { key: "QF", label: "8 强" },
  { key: "SF", label: "半决赛" },
  { key: "FINAL", label: "决赛" },
]

export type KnockoutMatch = {
  id: string
  matchNo: number
  stage: KnockoutStage
  kickoff: string // UTC ISO
  venue: string
  city: string
  // 席位标签（中文）：如「A 组第 1」「C/E/F/H/I 组最佳第三」「第 73 场胜者」「第 101 场负者」
  homeSeat: string
  awaySeat: string
}

// [matchNo, stage, kickoffUTC, 城市Key(对应 VENUE_BY_KEY), homeSeat, awaySeat]
export const KNOCKOUT_RAW: [number, KnockoutStage, string, string, string, string][] = [
  // 32 强（第 73–88 场）
  [73, "R32", "2026-06-28T19:00:00Z", "Inglewood", "A 组第 2", "B 组第 2"],
  [76, "R32", "2026-06-29T17:00:00Z", "Houston", "C 组第 1", "F 组第 2"],
  [74, "R32", "2026-06-29T20:30:00Z", "Foxborough", "E 组第 1", "A/B/C/D/F 组最佳第三"],
  [75, "R32", "2026-06-30T01:00:00Z", "Guadalupe", "F 组第 1", "C 组第 2"],
  [78, "R32", "2026-06-30T17:00:00Z", "Arlington", "E 组第 2", "I 组第 2"],
  [77, "R32", "2026-06-30T21:00:00Z", "East Rutherford", "I 组第 1", "C/D/F/G/H 组最佳第三"],
  [79, "R32", "2026-07-01T01:00:00Z", "Mexico City", "A 组第 1", "C/E/F/H/I 组最佳第三"],
  [80, "R32", "2026-07-01T16:00:00Z", "Atlanta", "L 组第 1", "E/H/I/J/K 组最佳第三"],
  [82, "R32", "2026-07-01T20:00:00Z", "Seattle", "G 组第 1", "A/E/H/I/J 组最佳第三"],
  [81, "R32", "2026-07-02T00:00:00Z", "Santa Clara", "D 组第 1", "B/E/F/I/J 组最佳第三"],
  [84, "R32", "2026-07-02T19:00:00Z", "Inglewood", "H 组第 1", "J 组第 2"],
  [83, "R32", "2026-07-02T23:00:00Z", "Toronto", "K 组第 2", "L 组第 2"],
  [85, "R32", "2026-07-03T03:00:00Z", "Vancouver", "B 组第 1", "E/F/G/I/J 组最佳第三"],
  [88, "R32", "2026-07-03T18:00:00Z", "Arlington", "D 组第 2", "G 组第 2"],
  [86, "R32", "2026-07-03T22:00:00Z", "Miami Gardens", "J 组第 1", "H 组第 2"],
  [87, "R32", "2026-07-04T01:30:00Z", "Kansas City", "K 组第 1", "D/E/I/J/L 组最佳第三"],
  // 16 强（第 89–96 场）
  [90, "R16", "2026-07-04T17:00:00Z", "Houston", "第 73 场胜者", "第 75 场胜者"],
  [89, "R16", "2026-07-04T21:00:00Z", "Philadelphia", "第 74 场胜者", "第 77 场胜者"],
  [91, "R16", "2026-07-05T20:00:00Z", "East Rutherford", "第 76 场胜者", "第 78 场胜者"],
  [92, "R16", "2026-07-06T00:00:00Z", "Mexico City", "第 79 场胜者", "第 80 场胜者"],
  [93, "R16", "2026-07-06T19:00:00Z", "Arlington", "第 83 场胜者", "第 84 场胜者"],
  [94, "R16", "2026-07-07T00:00:00Z", "Seattle", "第 81 场胜者", "第 82 场胜者"],
  [95, "R16", "2026-07-07T16:00:00Z", "Atlanta", "第 86 场胜者", "第 88 场胜者"],
  [96, "R16", "2026-07-07T20:00:00Z", "Vancouver", "第 85 场胜者", "第 87 场胜者"],
  // 8 强（第 97–100 场）
  [97, "QF", "2026-07-09T20:00:00Z", "Foxborough", "第 89 场胜者", "第 90 场胜者"],
  [98, "QF", "2026-07-10T19:00:00Z", "Inglewood", "第 93 场胜者", "第 94 场胜者"],
  [99, "QF", "2026-07-11T21:00:00Z", "Miami Gardens", "第 91 场胜者", "第 92 场胜者"],
  [100, "QF", "2026-07-12T01:00:00Z", "Kansas City", "第 95 场胜者", "第 96 场胜者"],
  // 半决赛（第 101–102 场）
  [101, "SF", "2026-07-14T19:00:00Z", "Arlington", "第 97 场胜者", "第 98 场胜者"],
  [102, "SF", "2026-07-15T19:00:00Z", "Atlanta", "第 99 场胜者", "第 100 场胜者"],
  // 三四名决赛（第 103 场）
  [103, "3RD", "2026-07-18T19:00:00Z", "Miami Gardens", "第 101 场负者", "第 102 场负者"],
  // 决赛（第 104 场）
  [104, "FINAL", "2026-07-19T19:00:00Z", "East Rutherford", "第 101 场胜者", "第 102 场胜者"],
]

export const KNOCKOUT: KnockoutMatch[] = KNOCKOUT_RAW.map(
  ([matchNo, stage, kickoff, cityKey, homeSeat, awaySeat]) => {
    const v = VENUE_BY_KEY[cityKey]
    return {
      id: `m${matchNo}`,
      matchNo,
      stage,
      kickoff,
      venue: v?.venue ?? cityKey,
      city: v?.city ?? cityKey,
      homeSeat,
      awaySeat,
    }
  },
)

// 用「已解析的真实对阵」为某个淘汰赛槽位构建完整 Match（含 AI 预测 + 详情）。
// 对阵由 knockout-resolver 从实时 overlay 解析得到后调用；AI 预测与小组赛同源——
// 同一套 v6 Elo 多因子引擎（v2ForMatch）+ buildDetail，不引入任何新模型。
// 注意：这里只走 v6 引擎路径（对任意两队均可计算），不依赖 wc-predictions.json
//（其只含 72 场小组赛对阵；淘汰赛对阵不在其中，故不读 MATCH_PREDS，避免越界）。
// 返回的 Match 为「未开赛」基线；实时比分/状态由调用方再经 mergeLiveOverlay 叠加。
export function buildKnockoutMatch(
  slot: KnockoutMatch,
  homeCode: string,
  awayCode: string,
): Match | null {
  const home = TEAMS_BY_CODE[homeCode]
  const away = TEAMS_BY_CODE[awayCode]
  if (!home || !away) return null
  const venue = VENUE_BY_NAME[slot.venue] ?? VENUES[0]
  const idx = slot.matchNo - 1
  const v2 = v2ForMatch(home, away, venue)
  const favored = v2.homeWin > v2.awayWin ? home.name : v2.awayWin > v2.homeWin ? away.name : "双方"
  const confTxt = v2.confidence >= 65 ? "较高" : v2.confidence >= 45 ? "中等" : "偏低"
        const blowTxt = v2.blowoutProb >= 35 ? `，大胜风险偏高（P(净胜≥3)≈${v2.blowoutProb}%）` : ""
  const favProb = Math.max(v2.homeWin, v2.awayWin) / 100
  const upIndex = Math.round(v2.upsetProb * Math.max(0, (favProb - 0.5) / 0.5))
  const underdog = v2.upsetLabel.startsWith("客队") ? away.name : v2.upsetLabel.startsWith("主队") ? home.name : ""
  const upLabel = underdog ? `${underdog}逼平或爆冷` : "势均力敌，难分胜负"
  const ai: Match["ai"] = {
    homeWin: v2.homeWin,
    draw: v2.draw,
    awayWin: v2.awayWin,
    predictedScore: v2.predictedScore,
    confidence: v2.confidence,
    formHome: [],
    formAway: [],
    formVerified: false,
    upsetProb: v2.upsetProb,
    upsetIndex: upIndex,
    upsetLabel: upLabel,
    upsetScore: v2.upsetScore,
    keyPoints: [
      `opus4.8 预期进球：${home.name} ${v2.egHome} - ${v2.egAway} ${away.name}，最可能比分 ${v2.predictedScore}。`,
      `90 分钟胜平负 ${v2.homeWin}% / ${v2.draw}% / ${v2.awayWin}%${blowTxt}。`,
      `大于 2.5 球概率约 ${v2.over25}%，双方均进球约 ${v2.bttRatio}%。`,
    ],
    summary: `opus4.8 Elo模型研判 90 分钟胜平负为 ${v2.homeWin}% / ${v2.draw}% / ${v2.awayWin}%，${favored}占优（置信度${confTxt}）。预期进球约 ${v2.egHome}-${v2.egAway}，最可能比分 ${v2.predictedScore}${blowTxt}。`,
  }
  return {
    id: slot.id,
    group: "",
    stage: KNOCKOUT_STAGE_LABEL[slot.stage],
    kickoff: slot.kickoff,
    status: "upcoming",
    minute: undefined,
    homeCode,
    awayCode,
    homeScore: undefined,
    awayScore: undefined,
    venue: slot.venue,
    city: slot.city,
    ai,
    detail: buildDetail(home, away, idx, venue),
  }
}

// ---- 实时数据合并（来自本地 live_scores，经 LiveProvider 注入到客户端）----

// 客户端安全的 overlay 类型（与 lib/live-overlay.ts 的 LiveInfo 字段一致，但不引入 server-only 模块）
export type LiveOverlayInfo = {
  status: MatchStatus
  homeScore: number | null
  awayScore: number | null
  kickoffISO: string
  kickoffMs: number
  // poller 写入 live_scores.as_of 的抓取时间。客户端用它锚定秒针，避免刷新后从 00 秒重算。
  asOf?: string | null
  asOfMs?: number | null
  // API 状态短码（NS/1H/HT/2H/ET/BT/P/FT/AET/PEN/SUSP/INT…），前端据此映射中文 + 是否走秒
  statusShort?: string | null
  // API 返回的比赛进行分钟（仅分钟，不含秒）
  elapsed?: number | null
  // 伤停补时分钟（如上半场 45+2 时 extra=2）
  extra?: number | null
  // API 原始轮次名（"Round of 16"…）。淘汰赛席位解析锚点；小组赛为空
  round?: string | null
}
export type LiveOverlay = Record<string, LiveOverlayInfo>

// 根据开球时间「估算」已开赛分钟。
// 注意：football-data.org 免费档不返回真实比赛分钟，这里只能用墙上时钟推算，
// 因此是近似值（前端显示加「约」）。真实分钟还受以下因素影响，无法精确：
//   1) 用的是计划开球时间 utcDate，真实开球常晚 1–2 分钟；
//   2) 本届上半场伤停补时偏长（约 5–6 分钟），会在中场休息前踢完，墙上时钟已走但比赛分钟未到 46；
//   3) 中场休息固定 15 分钟（IFAB 规则第 7 条，本届已完赛场次均按此执行）。
// 综合 (2)+(3)，下半场墙上时钟比真实分钟系统性偏快约 20 分钟，这里据此扣除以贴近实况。
const HALFTIME_OFFSET = 20
export function computeMatchMinute(kickoffMs: number, nowMs: number): number {
  const elapsed = Math.floor((nowMs - kickoffMs) / 60000)
  if (elapsed <= 0) return 1
  if (elapsed <= 45) return elapsed
  // 上半场补时 + 中场休息窗口（约 45'→63'），统一按 45' 显示
  if (elapsed <= 45 + HALFTIME_OFFSET) return 45
  // 下半场：扣除上半场补时 + 中场休息的合计偏移
  return Math.min(90, elapsed - HALFTIME_OFFSET)
}

// ---- 实时状态机（基于 API-Football 真实状态短码）----
// 当 overlay 带有真实 statusShort/elapsed 时，前端按此精确显示；
// 缺失时回退到 computeMatchMinute 的墙上时钟估算。
//
// 状态短码含义（league=1 世界杯实测覆盖）：
//   NS   未开赛            HT   中场休息
//   1H   上半场进行中      2H   下半场进行中
//   ET   加时赛进行中      BT   加时赛中场休息（两节之间）
//   P    点球大战进行中    SUSP 比赛中断   INT 比赛临时暂停
//   FT   常规时间完场      AET  加时后完场  PEN  点球后完场
//   PST  延期             CANC 取消        ABD 腰斩  AWD/WO 判罚
export type LiveClockKind = "pre" | "running" | "paused" | "finished"
export type LiveClock = {
  kind: LiveClockKind
  label: string // 中文状态，"上半场" / "中场休息" / "完场" …
  running: boolean // 是否需要客户端逐秒走表
  baseMinute: number | null // 走表基准分钟（API elapsed），null 表示不显示分钟
  stoppage: number | null // 伤停补时分钟（用于显示 45+x），null 表示无
}

// 半场常规结束分钟，用于判断是否进入补时区
const REG_END: Record<string, number> = { "1H": 45, "2H": 90, ET1: 105, ET2: 120 }

export function liveClockFromStatus(
  short: string | null | undefined,
  elapsed: number | null | undefined,
  extra: number | null | undefined,
): LiveClock {
  const s = (short || "").toUpperCase()
  const min = typeof elapsed === "number" ? elapsed : null
  // extra 保留在 DB/overlay 中给未来赛中分析使用；前端比赛钟不显示补时，45/90 后直接定格。
  const ex = null
  switch (s) {
    case "1H":
      return { kind: "running", label: "上半场", running: true, baseMinute: min ?? 1, stoppage: ex }
    case "2H":
      return { kind: "running", label: "下半场", running: true, baseMinute: min ?? 46, stoppage: ex }
    case "ET":
      return { kind: "running", label: "加时赛", running: true, baseMinute: min ?? 91, stoppage: ex }
    case "P":
      return { kind: "paused", label: "点球大战", running: false, baseMinute: min, stoppage: null }
    case "HT":
      return { kind: "paused", label: "中场休息", running: false, baseMinute: 45, stoppage: null }
    case "BT":
      return { kind: "paused", label: "加时中场", running: false, baseMinute: min ?? 105, stoppage: null }
    case "SUSP":
      return { kind: "paused", label: "比赛中断", running: false, baseMinute: min, stoppage: null }
    case "INT":
      return { kind: "paused", label: "暂停中", running: false, baseMinute: min, stoppage: null }
    case "FT":
      return { kind: "finished", label: "完场", running: false, baseMinute: null, stoppage: null }
    case "AET":
      return { kind: "finished", label: "加时完场", running: false, baseMinute: null, stoppage: null }
    case "PEN":
      return { kind: "finished", label: "点球完场", running: false, baseMinute: null, stoppage: null }
    case "PST":
      return { kind: "pre", label: "延期", running: false, baseMinute: null, stoppage: null }
    case "CANC":
      return { kind: "pre", label: "取消", running: false, baseMinute: null, stoppage: null }
    case "ABD":
      return { kind: "finished", label: "腰斩", running: false, baseMinute: null, stoppage: null }
    case "NS":
    case "":
      return { kind: "pre", label: "未开赛", running: false, baseMinute: null, stoppage: null }
    default:
      // 未知短码：若有分钟当作进行中，否则未开赛
      return min !== null
        ? { kind: "running", label: "进行中", running: true, baseMinute: min, stoppage: ex }
        : { kind: "pre", label: "未开赛", running: false, baseMinute: null, stoppage: null }
  }
}

// 把"基准分钟 + 锚点 + 现在"换算成显示用的 {分, 秒}。
//
// 计时设计（确定性、跨刷新/跨设备一致，且分钟与秒针严格同步进位）：
//   关键：分钟与秒针**锚定到同一个固定 kickoffMs 的整秒计数 K(t)=floor((t−kickoff)/1000)**：
//     · second = K(now) % 60               → 0~59 循环，确定性、刷新/重抓都不归零。
//     · 分钟进位 = K 跨过的整分钟数         → 与秒针 59→00 翻转**严格同一刻**发生，不会再出现
//       “秒针走完一圈、分钟却不进位”的循环 bug（旧版分钟用 asOf、秒针用 kickoff，两套时钟脱节）。
//   分钟基准仍以 API 的 baseMinute 为权威（足球有中场/伤停，墙上时钟≠比赛分钟）：
//     minute = baseMinute + (floor(K(now)/60) − floor(K(asOf)/60))
//   中场休息的时长在“差值”里自然抵消，故 2 上半场切换、补时都能连续上升。
//   本地相对 asOf 多走的分钟封顶 MAX_LOCAL_DRIFT_MIN，防 poller 停摆时凭空跑飞。
//
// 注：到 45/90 不再硬钉死——比赛进入补时会自然继续上升（90→90:59→91…），
// 直到 API 返回 HT/FT 等状态（!running）时由状态定格为“中场休息/完场”。
const MAX_LOCAL_DRIFT_MIN = 2
export function tickClock(
  clock: LiveClock,
  kickoffMs: number,
  asOfMs: number,
  nowMs: number,
): { minute: number; second: number; stoppage: number | null } | null {
  if (clock.baseMinute === null) return null
  // 暂停态（HT/BT/SUSP/P）：定格，不走秒
  if (!clock.running) {
    return { minute: clock.baseMinute, second: 0, stoppage: clock.stoppage }
  }

  const validK = kickoffMs > 0 && nowMs > kickoffMs
  if (!validK) {
    // 无开球时间戳兜底：秒针不可用，仅按 API 分钟显示，秒固定 0。
    return { minute: clock.baseMinute, second: 0, stoppage: clock.stoppage }
  }

  // 同源 kickoff 整秒计数：分钟与秒针由此唯一推导，保证进位同步。
  const kNow = Math.floor((nowMs - kickoffMs) / 1000)
  const kAsOf = Math.max(0, Math.floor((asOfMs - kickoffMs) / 1000))

  const second = kNow % 60
  // 自 asOf 起跨过的整分钟数（与秒针翻转同刻），封顶防 poller 停摆跑飞。
  const driftMin = Math.min(MAX_LOCAL_DRIFT_MIN, Math.max(0, Math.floor(kNow / 60) - Math.floor(kAsOf / 60)))
  const minute = clock.baseMinute + driftMin

  return { minute, second, stoppage: clock.stoppage }
}

// 把实时 overlay 合并进比赛列表：覆盖状态、比分、开球时间，并为进行中比赛计算分钟。
// overlay 为空（无 Key / 拉取失败）时原样返回静态数据，保证降级。
export function mergeLiveOverlay(
  matches: Match[],
  overlay: LiveOverlay | null | undefined,
): Match[] {
  if (!overlay || Object.keys(overlay).length === 0) return matches
  return matches.map((m) => {
    const info = overlay[`${m.homeCode}-${m.awayCode}`]
    if (!info) return m
    const next: Match = {
      ...m,
      status: info.status,
      kickoff: info.kickoffISO || m.kickoff,
      homeScore: info.homeScore ?? undefined,
      awayScore: info.awayScore ?? undefined,
    }
    if (info.status === "live") {
      // 分钟数交给 <LiveMinute> 组件单独跳动，不放进数组，避免整页每 30 秒重渲染
      // 进行中若比分仍为空，按 0-0 显示
      next.homeScore = info.homeScore ?? 0
      next.awayScore = info.awayScore ?? 0
    } else {
      next.minute = undefined
    }
    return next
  })
}

  // AI 夺冠概率榜：来自 v6 Elo 多因子引擎的锦标赛蒙特卡洛模拟（scripts/lib/champion-sim-core.mjs）。
  // 此处为静态兜底基线；实时值由 poller 在赛果变化时重算写入 champion_sim 表，
  // 经 getChampionRace（服务端）/ useChampionRace（客户端）注入，见 lib/db/champion-sim.ts。
// 小组赛已结束场次用真实比分，未赛场次用 v6 λ 抽样；含夺冠/决赛/4强/8强/16强/出线各阶段概率。
export type ChampionOdds = {
  team: Team
  champion: number
  final: number
  semi: number
  quarter: number
  r16: number
  qualify: number
}
// 由一份夺冠模拟表（静态 CHAMPION_SIM 或 DB 实时快照，同结构）组装排序好的榜单。
// 纯函数：服务端可传入 DB 快照重算，客户端可用 /api/live 带来的快照重算（见 getChampionRace / useChampionRace）。
export function buildChampionRace(sim: Record<string, { champ: number; final: number; sf: number; qf: number; r16: number; qualify: number }> = CHAMPION_SIM): ChampionOdds[] {
  return TEAMS.map((t) => {
    const p = sim[t.code]
    return {
      team: t,
      champion: p?.champ ?? 0,
      final: p?.final ?? 0,
      semi: p?.sf ?? 0,
      quarter: p?.qf ?? 0,
      r16: p?.r16 ?? 0,
      qualify: p?.qualify ?? 0,
    }
  }).sort((a, b) => b.champion - a.champion || b.final - a.final)
}

// 静态基线榜单（无 DB / 客户端首屏兜底）。实时数据走 getChampionRace（服务端）/ useChampionRace（客户端）。
export const CHAMPION_RACE: ChampionOdds[] = buildChampionRace()

