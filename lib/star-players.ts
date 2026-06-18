// 手工球星表读取层 —— 解决"俱乐部赛季数据严重低估国家队当红球星"的问题。
// 例：亚马尔(0.481)/姆巴佩(0.526)/萨拉赫(0.18) 在俱乐部统计里被埋没，
// 但他们是各自国家队的绝对核心，没首发=重大新闻，必须被模型与展示层识别。
//
// 数据源：lib/star-players.json（与 scripts/build-profiles.mjs 共用同一份，避免双份维护）。
// 兼容性：key 用「归一化键」(去重音/小写/去标点)，与 build-profiles 的 norm() 同规则，匹配 API 任意拼写。
import starData from "./star-players.json"

export type StarTier = 1 | 2
export type StarPlayer = { key: string; teamCode: string; tier: StarTier; display: string }

const STARS = starData.stars as StarPlayer[]
const TIER_FLOOR = starData.tierFloor as Record<string, number>

// 归一化：必须与 scripts/build-profiles.mjs 完全一致。
export function normName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// 查某队的球星表：归一化key -> {tier, floor, display}
export function teamStars(teamCode: string): Map<string, { tier: StarTier; floor: number; display: string }> {
  const m = new Map<string, { tier: StarTier; floor: number; display: string }>()
  for (const s of STARS) {
    if (s.teamCode === teamCode) m.set(s.key, { tier: s.tier, floor: TIER_FLOOR[String(s.tier)], display: s.display })
  }
  return m
}
