import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core"

// 阵容表：每场每侧一行（主键 = match_key + side）。
// 数据来源：API-Football（免费档，按日期取 fixture id → /fixtures/lineups）。
// start_xi / subs 存 JSON 字符串；前端读出后按 grid/pos 布点渲染。
export const lineups = sqliteTable(
  "lineups",
  {
    matchKey: text("match_key").notNull(), // 与 lib/data.ts FIXTURES 对齐，如 "KSA-URU"
    side: text("side").notNull(), // "home" | "away"
    teamCode: text("team_code").notNull(), // 本站三字码，如 "KSA"
    teamName: text("team_name"), // API 原始队名
    formation: text("formation"), // 如 "3-1-4-2"，可能为 null
    coach: text("coach"), // 主帅姓名
    kind: text("kind").notNull().default("confirmed"), // predicted | confirmed
    source: text("source").notNull().default("api-football"),
    fixtureId: integer("fixture_id"),
    startXi: text("start_xi").notNull(), // JSON: [{number,name,pos,grid}]
    subs: text("subs"), // JSON: [{number,name,pos}]
    asOf: text("as_of").notNull(), // 抓取时间 ISO
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchKey, t.side] }),
  }),
)

export type LineupRow = typeof lineups.$inferSelect

// 比赛事件（进球/红黄牌/换人/VAR），来源 API-Football /fixtures/events。
// 每场多行，seq 保留 API 返回顺序；主键 = fixture_id + seq。
export const events = sqliteTable(
  "events",
  {
    fixtureId: integer("fixture_id").notNull(),
    matchKey: text("match_key").notNull(),
    seq: integer("seq").notNull(),
    minute: integer("minute"),
    extra: integer("extra"),
    side: text("side").notNull(), // "home" | "away"
    teamCode: text("team_code").notNull(),
    teamName: text("team_name"),
    type: text("type").notNull(), // Goal | Card | subst | Var
    detail: text("detail"),
    player: text("player"),
    assist: text("assist"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fixtureId, t.seq] }),
  }),
)

export type EventRow = typeof events.$inferSelect

// 裁判表：每场一行（主键 = match_key）。来源：API-Football fixtures.fixture.referee。
export const referees = sqliteTable("referees", {
  matchKey: text("match_key").primaryKey(),
  fixtureId: integer("fixture_id"),
  name: text("name").notNull(),        // 裁判姓名（英文）
  nat: text("nat").notNull().default(""), // 国籍（英文）
  avgYellow: real("avg_yellow").notNull().default(4.2),
  avgRed: real("avg_red").notNull().default(0.2),
  penaltyRate: real("penalty_rate").notNull().default(0.27),
  note: text("note"),
  asOf: text("as_of").notNull(),
})

export type RefereeRow = typeof referees.$inferSelect

// 实时比分表：每场一行（主键 = match_key）。
// 由本地实时数据进程写入（不在公开仓库内）；应用侧只读，合并进 live overlay。
// 进程缺席时此表为空，前端自动回退到官方 API（football-data.org）或静态快照。
export const liveScores = sqliteTable("live_scores", {
  matchKey: text("match_key").primaryKey(),
  fixtureId: integer("fixture_id"),
  homeCode: text("home_code"),
  awayCode: text("away_code"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  status: text("status").notNull(), // live | finished | upcoming
  statusDesc: text("status_desc"),  // 原始状态描述（如 "1st half"）
  statusShort: text("status_short"), // API 原始状态码（1H/HT/2H/ET/FT/AET/PEN…），前端比赛钟用
  elapsed: integer("elapsed"),       // 比赛进行分钟（API 只到分钟，秒由前端本地推算）
  extra: integer("extra"),           // 补时分钟（如上半场 45+3 的 3）
  kickoffMs: integer("kickoff_ms"), // 真实开球 UTC 毫秒
  round: text("round"), // API 原始轮次名（"Round of 16"…），淘汰赛席位解析锚点
  asOf: text("as_of").notNull(),
})

export type LiveScoreRow = typeof liveScores.$inferSelect

// 关键因素对比：每场多行。来源：scripts/ingest-factors.mjs 整合真实数据后由智谱 GLM 生成、入库缓存。
export const matchFactors = sqliteTable(
  "match_factors",
  {
    matchKey: text("match_key").notNull(),
    seq: integer("seq").notNull(),
    label: text("label").notNull(),
    home: text("home").notNull(),
    away: text("away").notNull(),
    edge: text("edge").notNull(), // home | away | even
    asOf: text("as_of").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchKey, t.seq] }),
  }),
)

export type MatchFactorRow = typeof matchFactors.$inferSelect

// 伤停：每场多行。来源：API-Football /injuries?fixture=（真实数据，世界杯赛事较稀疏）。
export const injuries = sqliteTable(
  "injuries",
  {
    matchKey: text("match_key").notNull(),
    seq: integer("seq").notNull(),
    side: text("side").notNull(), // home | away
    teamCode: text("team_code").notNull(),
    player: text("player").notNull(),
    pos: text("pos"),
    status: text("status").notNull(), // 缺阵 | 存疑 | 复出
    note: text("note"),
    asOf: text("as_of").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchKey, t.seq] }),
  }),
)

export type InjuryRow = typeof injuries.$inferSelect

// factors/injuries 处理标记：记录某场已跑过 ingest-factors（即便 0 伤停也算"已检查"）。
export const factorsMeta = sqliteTable("factors_meta", {
  matchKey: text("match_key").primaryKey(),
  injuriesChecked: integer("injuries_checked").notNull().default(0),
  asOf: text("as_of").notNull(),
})

export type FactorsMetaRow = typeof factorsMeta.$inferSelect

// 每场每队的真实赛果统计（来源 API-Football /fixtures/statistics）。
// 用于聚合球队赛前画像（攻防强度），是重训模型的真实特征来源。
export const matchStats = sqliteTable(
  "match_stats",
  {
    matchKey: text("match_key").notNull(),
    side: text("side").notNull(), // home | away
    teamCode: text("team_code").notNull(),
    fixtureId: integer("fixture_id"),
    possession: integer("possession"), // 控球率 %
    totalShots: integer("total_shots"),
    shotsOn: integer("shots_on"), // 射正
    shotsOff: integer("shots_off"),
    blocked: integer("blocked"),
    insideBox: integer("inside_box"), // 禁区内射门
    fouls: integer("fouls"),
    corners: integer("corners"),
    offsides: integer("offsides"),
    yellow: integer("yellow"),
    red: integer("red"),
    gkSaves: integer("gk_saves"),
    passes: integer("passes"),
    passesPct: integer("passes_pct"), // 传球成功率 %
    xg: real("xg"), // expected_goals
    goalsPrevented: real("goals_prevented"),
    asOf: text("as_of").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchKey, t.side] }),
  }),
)

export type MatchStatsRow = typeof matchStats.$inferSelect

// 历史交锋（来源 API-Football /fixtures/headtohead，真实历史比赛）。
// matchKey = 本站待预测比赛键；每条 = 两队过去一场真实交锋。
export const h2h = sqliteTable(
  "h2h",
  {
    matchKey: text("match_key").notNull(),
    histFixtureId: integer("hist_fixture_id").notNull(),
    date: text("date").notNull(),
    homeName: text("home_name").notNull(),
    awayName: text("away_name").notNull(),
    homeGoals: integer("home_goals"),
    awayGoals: integer("away_goals"),
    league: text("league"),
    asOf: text("as_of").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchKey, t.histFixtureId] }),
  }),
)

export type H2hRow = typeof h2h.$inferSelect

// 夺冠榜实时模拟快照：每队一行（主键 = team_code）。
// 由 scripts/run-champion-sim.mjs（或 poller 触发）跑 2 万次锦标赛蒙特卡洛生成：
// 已完赛用真实比分锁死、其余用 v6 Elo λ 泊松抽样。仅当「已完赛结果集合」变化时重算（见 meta.results_hash）。
// 应用侧只读，DB 空时回退到 lib/champion-sim-data.ts 的静态兜底基线。数值单位均为百分比。
export const championSim = sqliteTable("champion_sim", {
  teamCode: text("team_code").primaryKey(), // 本站三字码，如 "ARG"
  champ: real("champ").notNull().default(0), // 夺冠 %
  final: real("final").notNull().default(0), // 进决赛 %
  sf: real("sf").notNull().default(0), // 进 4 强 %
  qf: real("qf").notNull().default(0), // 进 8 强 %
  r16: real("r16").notNull().default(0), // 进 16 强 %
  qualify: real("qualify").notNull().default(0), // 小组出线 %
  asOf: text("as_of").notNull(), // 重算时间 ISO
})

export type ChampionSimRow = typeof championSim.$inferSelect

// 夺冠模拟元信息：单行（id 固定 'singleton'）。
// results_hash 记录上次重算所基于的「已完赛结果集合」哈希，用于「仅赛果变化时重算」的去重判断。
export const championSimMeta = sqliteTable("champion_sim_meta", {
  id: text("id").primaryKey().default("singleton"),
  resultsHash: text("results_hash").notNull().default(""),
  nSims: integer("n_sims").notNull().default(0),
  asOf: text("as_of").notNull(),
})

export type ChampionSimMetaRow = typeof championSimMeta.$inferSelect

