// 这是示例配置文件，只放占位值，不要放真实 API Key。
// 真实 key 请填写到同目录的 keys.local.mjs。

export default {
  // football-data.org 的 key。
  // 用途：旧/备用比分状态链路 scripts/ingest-scores.mjs。
  // 当前主线如果只跑 API-Football poller，可以先不填。
  FOOTBALL_DATA_API_KEY: "",

  // API-Football / API-SPORTS 的 key。
  // 来源：dashboard.api-football.com。
  // 用途：当前主力数据源，负责实时比分、比赛状态、阵容、事件、裁判、统计、伤停、球员名单等。
  API_FOOTBALL_KEY: "YOUR_API_FOOTBALL_KEY",

  // API-Football 请求间隔，单位毫秒。
  // 用途：防止请求过快触发限流。一般不用填，只有限流时再调大。
  API_FOOTBALL_DELAY_MS: "",

  // API-Football 被限流后的重试等待时间，单位毫秒。
  // 用途：rate limit 后等待多久再重试。一般不用填。
  API_FOOTBALL_RETRY_WAIT_MS: "",

  // 智谱 GLM 的 key。
  // 用途：生成“关键因素对比 / AI 分析”，主要给 scripts/ingest-factors.mjs 用。
  // 如果暂时不用 GLM 分析，可以先不填。
  GLM_API_KEY: "",

  // GLM/OpenAI 兼容接口地址。
  // 用途：切换 GLM、DeepSeek 或其他兼容 provider 时修改。
  GLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4/chat/completions",

  // GLM 模型名。
  // 用途：控制关键因素分析使用哪个模型。
  GLM_MODEL: "glm-4-flash",

  // 小米 MiMo 的 key。
  // 用途：联网搜索赛前信息，例如预测阵容、伤停、停赛、发布会、天气、赔率走势。
  MIMO_API_KEY: "YOUR_MIMO_API_KEY",

  // MiMo 接口地址。
  // 用途：一般保持默认即可。
  MIMO_BASE_URL: "https://api.xiaomimimo.com/v1",

  // MiMo 模型名。
  // 用途：控制 MiMo 赛前搜索和结构化输出使用哪个模型。
  MIMO_MODEL: "mimo-v2.5-pro",

  // MiMo 是否启用联网搜索。
  // 用途：true 表示允许 MiMo 搜索网页。
  MIMO_WEB_SEARCH: "true",

  // MiMo 搜索节流配置，单位毫秒。
  // 用途：请求太频繁时调大。一般不用填。
  MIMO_SEARCH_DELAY_MS: "",
}
