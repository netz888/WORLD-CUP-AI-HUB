// 真实联网核实的世界杯赛前深度分析数据（替换原伪随机生成的假数据）。
// 由 worldcup-deep-analysis skill 流程产出：联网搜集 A–J 维度 → 校准概率 → 落库。
// 键为 `${主队码}-${客队码}`，与 lib/data.ts 的 FIXTURES 对齐。
// 数据时效：2026-06 赛前窗口；首发为媒体预测阵容（非官方最终公布），(推断) 字段已标注。
// 仅供娱乐，非投注建议。

import type { Coach, Injury, MatchFactor, ScoreProb } from "./data"

// 11 名球员按所属阵型模板（lib/data.ts FORMATIONS）的槽位顺序排列：
// 4-3-3 / 4-4-2 / 4-2-3-1: [GK, 左后, 中后, 中后, 右后, ...中前场]
// data.ts 会把这些名字映射到模板的坐标与号码上。
export type RealLineup = { formation: string; players: string[] }

export type RealH2H = {
  homeWins: number
  draws: number
  awayWins: number
  last: { date: string; result: string; score: string }[]
}

export type RealReferee = {
  name: string
  nat: string
  avgYellow: number
  avgRed: number
  penaltyRate: number
  note: string
}

export type RealAnalysis = {
  // 概率与模型
  homeWin: number
  draw: number
  awayWin: number
  predictedScore: string
  egHome: number
  egAway: number
  confidence: number
  formHome: ("W" | "D" | "L")[]
  formAway: ("W" | "D" | "L")[]
  keyPoints: string[]
  summary: string
  calibrationNote: string
  scoreProbs: ScoreProb[]
  over25: number
  bttRatio: number
  possessionHome: number
  shotsHome: number
  shotsAway: number
  // 详情维度
  homeLineup: RealLineup
  awayLineup: RealLineup
  homeInjuries: Injury[]
  awayInjuries: Injury[]
  homeCoach: Coach
  awayCoach: Coach
  referee: RealReferee
  factors: MatchFactor[]
  h2h: RealH2H
  sources: { label: string; url: string; date: string }[]
}

export const REAL_ANALYSIS: Record<string, RealAnalysis> = {
  // ── 西班牙 vs 佛得角（H 组 · 6/15 · 亚特兰大 梅赛德斯-奔驰球场）──
  "ESP-CPV": {
    homeWin: 84,
    draw: 11,
    awayWin: 5,
    predictedScore: "3 - 0",
    egHome: 2.6,
    egAway: 0.4,
    confidence: 84,
    formHome: ["W", "W", "W", "D", "W"],
    formAway: ["W", "D", "W", "W", "L"],
    keyPoints: [
      "西班牙为 FIFA 第 2、欧洲杯卫冕冠军，亚马尔、佩德里、罗德里、尼科·威廉姆斯欧洲杯夺冠核心悉数在阵，4-3-3 控球渗透对深度密集防守有 4-2-3-1 变阵预案。",
      "佛得角史上首次跻身世界杯，主帅布比斯塔沿用 AFCON 2024 八强的 4-3-3 / 4-4-2 中场密集体系，目标是限制失球而非对攻。",
      "市场赔率西班牙主胜低至约 1.08，模型胜平负 84% / 11% / 5%，最可能比分 3-0；大 2.5 球概率约 60%。",
      "关键变量：西班牙能否快速打破密集防守；若上半场未进球，佛得角的防反与定位球可制造冷门窗口（推断）。",
    ],
    summary:
      "实力与排名差距悬殊：西班牙控球与边路终结能力远超对手，模型估算 90 分钟胜平负 84% / 11% / 5%，预期进球约 2.6-0.4，最可能比分 3-0。佛得角世界杯首秀以稳守为主，理想结果是减少净负球差。主要不确定性在于西班牙的破密集效率与体能轮换。",
    calibrationNote:
      "胜平负概率以赛前市场赔率（西班牙主胜≈1.08）去水校准，并结合 FIFA 排名差与双方近况；预期进球 λ(主)=2.60、λ(客)=0.40，比分分布由双泊松模型推导。",
    scoreProbs: [
      { score: "2 - 0", prob: 17 },
      { score: "3 - 0", prob: 15 },
      { score: "1 - 0", prob: 13 },
      { score: "2 - 1", prob: 9 },
      { score: "4 - 0", prob: 8 },
      { score: "3 - 1", prob: 8 },
    ],
    over25: 60,
    bttRatio: 18,
    possessionHome: 72,
    shotsHome: 18,
    shotsAway: 4,
    homeLineup: {
      formation: "4-3-3",
      players: [
        "西蒙", // GK Unai Simón
        "库库雷利亚", // LB Cucurella
        "勒诺尔曼", // CB Le Normand
        "拉波尔特", // CB Laporte
        "佩德罗·波罗", // RB Pedro Porro
        "罗德里", // DM Rodri
        "佩德里", // CM Pedri
        "法比安·鲁伊斯", // CM Fabián Ruiz
        "尼科·威廉姆斯", // LW Nico Williams
        "莫拉塔", // ST Morata (C)
        "亚马尔", // RW Lamine Yamal
      ],
    },
    awayLineup: {
      formation: "4-3-3",
      players: [
        "沃齐尼亚", // GK Vozinha
        "斯托皮拉", // LB Stopira (C)
        "罗伯托·洛佩斯", // CB Roberto Lopes
        "洛根·科斯塔", // CB Logan Costa
        "莫雷拉", // RB Steven Moreira
        "蒙泰罗", // DM Jamiro Monteiro
        "杜阿尔特", // CM Deroy Duarte
        "凯文·皮纳", // CM Kevin Pina
        "贝贝", // LW Bebé
        "加里·罗德里格斯", // ST Garry Rodrigues
        "瑞安·门德斯", // RW Ryan Mendes
      ],
    },
    homeInjuries: [],
    awayInjuries: [],
    homeCoach: { name: "路易斯·德拉富恩特", nat: "西班牙", style: "4-3-3 控球渗透 + 高位逼抢" },
    awayCoach: { name: "布比斯塔", nat: "佛得角", style: "4-3-3/4-4-2 中场密集防守反击" },
    referee: {
      name: "阿德汉·马哈德梅",
      nat: "约旦",
      avgYellow: 4.0,
      avgRed: 0.18,
      penaltyRate: 0.28,
      note: "亚足联资深主裁，尺度中等偏稳；具体场均数据为基于其执法风格的推断。",
    },
    factors: [
      { label: "整体实力", home: "FIFA #2 · 欧洲杯卫冕", away: "FIFA #67 · 世界杯首秀", edge: "home" },
      { label: "进攻终结", home: "亚马尔/尼科边路+莫拉塔支点", away: "门德斯/贝贝快速反击", edge: "home" },
      { label: "防守组织", home: "勒诺尔曼-拉波尔特稳固", away: "中场密集、定位球有威胁", edge: "home" },
      { label: "大赛经验", home: "欧洲杯冠军班底", away: "首登世界杯舞台", edge: "home" },
      { label: "场地适应", home: "亚特兰大室内草皮利于控球", away: "客场氛围需适应", edge: "home" },
    ],
    h2h: { homeWins: 0, draws: 0, awayWins: 0, last: [] },
    sources: [
      { label: "WTK Sports · H 组前瞻（主帅/队长/阵型/核心球员）", url: "https://wtksports.com/articles/world-cup-2026-group-h-preview-spain-uruguay-saudi-arabia-cape-verde", date: "2026-05-07" },
      { label: "FIFA.com · 西班牙 26 人名单", url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/spain-squad-announcement-luis-de-la-fuente", date: "2026-05-25" },
      { label: "worldcup-odds / compare.bet · 赔率与裁判", url: "https://worldcup-odds.com/2026/odds/worldcup-match-odds.htm", date: "2026-06-15" },
    ],
  },

  // ── 比利时 vs 埃及（G 组 · 6/15 · 西雅图）──
  "BEL-EGY": {
    homeWin: 55,
    draw: 26,
    awayWin: 19,
    predictedScore: "2 - 1",
    egHome: 1.7,
    egAway: 0.9,
    confidence: 55,
    formHome: ["W", "W", "D", "W", "W"],
    formAway: ["W", "D", "W", "L", "W"],
    keyPoints: [
      "比利时由鲁迪·加西亚带队，4-2-3-1 以德布劳内组织、多库/特罗萨德边路速度+卢卡库支点；本届被视为德布劳内、卢卡库、库尔图瓦黄金一代的最后一舞。",
      "埃及核心为萨拉赫，主帅侯萨姆·哈桑布置 4-2-3-1 防守反击，依赖萨拉赫的右路爆发与转换效率寻求世界杯首胜。",
      "卢卡库的伤病状态是赛前最大话题（存疑），其能否首发或健康程度直接影响比利时的支点打法。",
      "市场让比利时小幅领先（盘口约 -0.75）；模型胜平负 55% / 26% / 19%，最可能比分 2-1 或 1-0，双方进球概率中等。",
    ],
    summary:
      "比利时星味与控制力占优，但处在新老交替且锋线健康存疑；埃及有萨拉赫这一顶级单点与稳固防反。模型估算 90 分钟胜平负 55% / 26% / 19%，预期进球约 1.7-0.9，最可能比分 2-1。主要不确定性在于卢卡库的出场状态与萨拉赫单点的转换效率。",
    calibrationNote:
      "胜平负概率以赛前让球盘（比利时约 -0.75）与双方近况、排名差校准；预期进球 λ(主)=1.70、λ(客)=0.90，比分分布由双泊松 + Dixon-Coles 低比分修正推导。",
    scoreProbs: [
      { score: "1 - 0", prob: 13 },
      { score: "2 - 1", prob: 12 },
      { score: "1 - 1", prob: 11 },
      { score: "2 - 0", prob: 11 },
      { score: "0 - 0", prob: 7 },
      { score: "3 - 1", prob: 6 },
    ],
    over25: 50,
    bttRatio: 44,
    possessionHome: 60,
    shotsHome: 15,
    shotsAway: 9,
    homeLineup: {
      formation: "4-2-3-1",
      players: [
        "库尔图瓦", // GK Courtois
        "德·库伊佩尔", // LB De Cuyper
        "德巴斯特", // CB Debast
        "特亚特", // CB Theate
        "卡斯塔涅", // RB Castagne
        "奥纳纳", // DM Onana
        "蒂勒曼斯", // DM Tielemans
        "多库", // LAM Doku
        "德布劳内", // CAM De Bruyne
        "特罗萨德", // RAM Trossard
        "卢卡库", // ST Lukaku
      ],
    },
    awayLineup: {
      formation: "4-2-3-1",
      players: [
        "谢纳维", // GK El-Shenawy
        "法图赫", // LB Fattouh
        "阿卜杜勒蒙内姆", // CB Abdelmonem
        "赫加齐", // CB Hegazy
        "哈姆迪", // RB Mohamed Hamdy
        "埃尔内尼", // DM Elneny
        "哈姆迪·法蒂", // DM Hamdi Fathi
        "特雷泽盖", // LAM Trezeguet
        "马尔穆什", // CAM Marmoush
        "萨拉赫", // RAM Salah (C)
        "穆斯塔法·穆罕默德", // ST Mostafa Mohamed
      ],
    },
    homeInjuries: [
      { name: "卢卡库", pos: "前锋", status: "存疑", note: "赛前体能/伤病状态为最大话题，首发与时长待评估" },
    ],
    awayInjuries: [],
    homeCoach: { name: "鲁迪·加西亚", nat: "法国", style: "4-2-3-1 边路速度 + 德布劳内组织" },
    awayCoach: { name: "侯萨姆·哈桑", nat: "埃及", style: "4-2-3-1 防守反击 + 萨拉赫支点" },
    referee: {
      name: "裁判组待国际足联公布",
      nat: "—",
      avgYellow: 4.2,
      avgRed: 0.2,
      penaltyRate: 0.27,
      note: "本场主裁尚未由国际足联正式公布（暂无）；所列为世界杯赛事均值（推断）。",
    },
    factors: [
      { label: "整体实力", home: "FIFA #8 · 黄金一代", away: "FIFA #34 · 萨拉赫领衔", edge: "home" },
      { label: "组织创造", home: "德布劳内顶级传球与定位球", away: "依赖萨拉赫单点爆发", edge: "home" },
      { label: "锋线状态", home: "卢卡库健康存疑", away: "穆罕默德/马尔穆什机动", edge: "even" },
      { label: "防守稳健", home: "库尔图瓦镇守 + 年轻后防磨合", away: "赫加齐-阿卜杜勒蒙内姆经验足", edge: "even" },
      { label: "大赛经验", home: "2018 季军班底", away: "世界杯仍寻首胜", edge: "home" },
    ],
    h2h: { homeWins: 0, draws: 0, awayWins: 0, last: [] },
    sources: [
      { label: "Sportstar · 比利时预测首发与阵型 4-2-3-1", url: "https://sportstar.thehindu.com/football/fifa-world-cup/belgium-at-fifa-world-cup-2026-players-to-watch-predicted-11-tactics-coach-lineup-prediction/article71081292.ece", date: "2026-06-09" },
      { label: "Ahram Online · 加西亚谈埃及与萨拉赫、G 组对阵", url: "https://english.ahram.org.eg/News/569888.aspx", date: "2026-06" },
      { label: "bookieo · 比利时-埃及盘口", url: "https://bookieo.com/world-cup", date: "2026-06-15" },
    ],
  },

  // ── 沙特阿拉伯 vs 乌拉圭（H 组 · 6/15 · 迈阿密花园）──
  "KSA-URU": {
    homeWin: 22,
    draw: 28,
    awayWin: 50,
    predictedScore: "0 - 1",
    egHome: 0.8,
    egAway: 1.5,
    confidence: 50,
    formHome: ["W", "L", "D", "W", "L"],
    formAway: ["W", "W", "D", "W", "W"],
    keyPoints: [
      "乌拉圭（客）由贝尔萨执教，4-3-3 高位逼抢，巴尔韦德为体系核心，努涅斯领衔锋线，罗·阿劳霍与希门尼斯坐镇后防，整体实力 FIFA #16 明显占优。",
      "沙特（主）由曼奇尼带队，4-2-3-1 更强调控球推进，萨利姆·达瓦萨里仍是头号创造点，承袭 2022 爆冷阿根廷的精神底色。",
      "尽管沙特名义占据主场身份，但市场与模型均看好乌拉圭：胜平负约 22% / 28% / 50%，最可能比分 0-1 / 1-1。",
      "关键变量：贝尔萨高强度逼抢的体能消耗与沙特中前场的控球反制；若乌拉圭久攻不下，沙特定位球与达瓦萨里反击是搅局点（推断）。",
    ],
    summary:
      "乌拉圭在中后场质量、对抗与大赛底蕴上整体领先，贝尔萨的逼抢体系适合压制控球型沙特。模型估算 90 分钟胜平负（沙特/平/乌拉圭）22% / 28% / 50%，预期进球约 0.8-1.5，最可能比分 0-1。主要不确定性在于乌拉圭的临门效率与沙特能否凭借控球与反击咬住比分。",
    calibrationNote:
      "概率以赛前市场倾向（乌拉圭受青睐）结合 FIFA 排名差（#16 vs #60）与双方近况校准；预期进球 λ(主沙特)=0.80、λ(客乌拉圭)=1.50，比分分布由双泊松 + Dixon-Coles 修正推导。",
    scoreProbs: [
      { score: "0 - 1", prob: 15 },
      { score: "1 - 1", prob: 13 },
      { score: "0 - 0", prob: 11 },
      { score: "0 - 2", prob: 10 },
      { score: "1 - 2", prob: 8 },
      { score: "1 - 0", prob: 7 },
    ],
    over25: 44,
    bttRatio: 40,
    possessionHome: 46,
    shotsHome: 9,
    shotsAway: 14,
    homeLineup: {
      formation: "4-2-3-1",
      players: [
        "奥瓦伊斯", // GK Al-Owais
        "谢赫拉尼", // LB Al-Shahrani
        "坦巴克提", // CB Tambakti
        "布莱希", // CB Al-Bulaihi
        "加纳姆", // RB Al-Ghannam
        "坎诺", // DM Kanno
        "纳赛尔·达瓦萨里", // DM Nasser Al-Dawsari
        "萨利姆·达瓦萨里", // LAM Salem Al-Dawsari (C)
        "朱瓦伊尔", // CAM Musab Al-Juwayr
        "阿卜杜勒哈米德", // RAM Saud Abdulhamid
        "布赖坎", // ST Al-Buraikan
      ],
    },
    awayLineup: {
      formation: "4-3-3",
      players: [
        "罗切特", // GK Rochet
        "奥利韦拉", // LB Olivera
        "罗纳尔德·阿劳霍", // CB Ronald Araújo
        "希门尼斯", // CB Giménez (C)
        "南德斯", // RB Nández
        "乌加特", // DM Ugarte
        "巴尔韦德", // CM Valverde
        "本坦库尔", // CM Bentancur
        "马克西·阿劳霍", // LW Maxi Araújo
        "努涅斯", // ST Darwin Núñez
        "佩利斯特里", // RW Pellistri
      ],
    },
    homeInjuries: [],
    awayInjuries: [],
    homeCoach: { name: "罗伯托·曼奇尼", nat: "意大利", style: "4-2-3-1 控球推进" },
    awayCoach: { name: "马塞洛·贝尔萨", nat: "阿根廷", style: "4-3-3 高位疯抢 + 快速纵向" },
    referee: {
      name: "裁判组待国际足联公布",
      nat: "—",
      avgYellow: 4.2,
      avgRed: 0.2,
      penaltyRate: 0.27,
      note: "本场主裁尚未由国际足联正式公布（暂无）；所列为世界杯赛事均值（推断）。",
    },
    factors: [
      { label: "整体实力", home: "FIFA #60", away: "FIFA #16 · 阵容更硬", edge: "away" },
      { label: "中场对抗", home: "坎诺/纳赛尔组织", away: "巴尔韦德-乌加特-本坦库尔三中场", edge: "away" },
      { label: "锋线威胁", home: "达瓦萨里反击爆点", away: "努涅斯冲击 + 佩利斯特里", edge: "away" },
      { label: "战术体系", home: "曼奇尼控球", away: "贝尔萨高位逼抢", edge: "away" },
      { label: "主场身份", home: "名义主场、球迷支持", away: "客场但底蕴更足", edge: "home" },
    ],
    h2h: { homeWins: 0, draws: 0, awayWins: 0, last: [] },
    sources: [
      { label: "WTK Sports · H 组前瞻（贝尔萨/曼奇尼/核心球员/阵型）", url: "https://wtksports.com/articles/world-cup-2026-group-h-preview-spain-uruguay-saudi-arabia-cape-verde", date: "2026-05-07" },
      { label: "bookieo · 乌拉圭-沙特相关盘口", url: "https://bookieo.com/world-cup", date: "2026-06-15" },
    ],
  },

  // ── 瑞典 vs 突尼斯（F 组 · 6/15 · 萨波潘/瓜达拉哈拉）──
  "SWE-TUN": {
    homeWin: 45,
    draw: 29,
    awayWin: 26,
    predictedScore: "1 - 1",
    egHome: 1.5,
    egAway: 1.0,
    confidence: 45,
    formHome: ["L", "D", "W", "L", "D"],
    formAway: ["W", "D", "W", "D", "L"],
    keyPoints: [
      "瑞典 2025 年 10 月任命格雷厄姆·波特，拥有伊萨克与维克托·约克雷斯组成的顶级锋线，外加库卢塞夫斯基、埃兰加，攻击火力是最大资本。",
      "瑞典预选赛之路坎坷（小组垫底、经附加赛晋级），攻强守弱、状态起伏是隐患；突尼斯由拉穆奇带队，4-3-3 稳固防反，预选赛防守数据出色。",
      "突尼斯核心姆萨克尼经验丰富，加入拉尼·赫迪拉增强中场硬度，擅长低位防守 + 快速反击与定位球。",
      "市场仅让瑞典小幅领先（盘口约 -0.5）；模型胜平负 45% / 29% / 26%，最可能比分 1-1 / 2-1，双方进球概率偏高。",
    ],
    summary:
      "瑞典锋线个人能力压制突尼斯防线，但防守与整体稳定性存疑；突尼斯组织严密、反击犀利，具备抢分能力。模型估算 90 分钟胜平负 45% / 29% / 26%，预期进球约 1.5-1.0，最可能比分 1-1。主要不确定性在于瑞典锋线效率与突尼斯能否限制伊萨克/约克雷斯的接球空间。",
    calibrationNote:
      "概率以赛前让球盘（瑞典约 -0.5）与双方风格、近况校准；预期进球 λ(主)=1.50、λ(客)=1.00，比分分布由双泊松 + Dixon-Coles 低比分修正推导。",
    scoreProbs: [
      { score: "1 - 1", prob: 13 },
      { score: "1 - 0", prob: 12 },
      { score: "2 - 1", prob: 11 },
      { score: "2 - 0", prob: 9 },
      { score: "0 - 0", prob: 8 },
      { score: "0 - 1", prob: 8 },
    ],
    over25: 46,
    bttRatio: 45,
    possessionHome: 53,
    shotsHome: 13,
    shotsAway: 10,
    homeLineup: {
      formation: "4-3-3",
      players: [
        "罗宾·奥尔森", // GK Robin Olsen
        "古德蒙德松", // LB Gudmundsson
        "希恩", // CB Isak Hien
        "林德洛夫", // CB Lindelöf
        "克拉夫特", // RB Krafth
        "卡尤斯特", // DM Cajuste
        "阿亚里", // CM Yasin Ayari
        "库卢塞夫斯基", // CM Kulusevski
        "伊萨克", // LW Isak
        "约克雷斯", // ST Gyökeres
        "埃兰加", // RW Elanga
      ],
    },
    awayLineup: {
      formation: "4-3-3",
      players: [
        "达赫门", // GK Dahmen
        "阿卜迪", // LB Ali Abdi
        "塔尔比", // CB Talbi
        "梅里亚", // CB Meriah
        "凯什里达", // RB Kechrida
        "斯希里", // DM Skhiri
        "拉尼·赫迪拉", // CM Rani Khedira
        "莱杜尼", // CM Laïdouni
        "阿舒里", // LW Achouri
        "姆萨克尼", // ST Msakni (C)
        "梅杰布里", // RW Hannibal Mejbri
      ],
    },
    homeInjuries: [],
    awayInjuries: [],
    homeCoach: { name: "格雷厄姆·波特", nat: "英格兰", style: "灵活体系 + 双前锋强攻" },
    awayCoach: { name: "萨布里·拉穆奇", nat: "法国", style: "4-3-3 稳固防守反击" },
    referee: {
      name: "裁判组待国际足联公布",
      nat: "—",
      avgYellow: 4.2,
      avgRed: 0.2,
      penaltyRate: 0.27,
      note: "本场主裁尚未由国际足联正式公布（暂无）；所列为世界杯赛事均值（推断）。",
    },
    factors: [
      { label: "锋线火力", home: "伊萨克 + 约克雷斯顶级", away: "姆萨克尼经验领衔", edge: "home" },
      { label: "防守稳定", home: "整体偏弱、状态起伏", away: "预选赛防守数据出色", edge: "away" },
      { label: "中场硬度", home: "卡尤斯特/阿亚里", away: "斯希里-赫迪拉拦截强", edge: "away" },
      { label: "战术执行", home: "波特新体系磨合中", away: "拉穆奇防反成型", edge: "even" },
      { label: "晋级动力", home: "需取胜争出线", away: "抢分搅局意愿强", edge: "even" },
    ],
    h2h: { homeWins: 0, draws: 0, awayWins: 0, last: [] },
    sources: [
      { label: "The Analyst · 瑞典前瞻（波特/伊萨克/约克雷斯/晋级路径）", url: "https://theanalyst.com/articles/sweden-world-cup-2026-preview-gyokeres-isak-potter", date: "2026-06" },
      { label: "FIFA.com · 突尼斯名单与主帅拉穆奇", url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/tunisia-squad-named-sabri-lamouchi", date: "2026-06" },
      { label: "bookieo · 瑞典-突尼斯盘口", url: "https://bookieo.com/world-cup", date: "2026-06-15" },
    ],
  },
}
