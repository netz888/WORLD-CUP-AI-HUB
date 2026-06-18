// Timezone-aware formatting helpers built on Intl.

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(new Date(iso))
}

export function dateKey(iso: string, tz: string): string {
  // returns YYYY-MM-DD in target tz
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).format(new Date(iso))
  return parts
}

// "今日" 的日期键（YYYY-MM-DD），按所选时区换算给定的基准时刻。
// 注意：同一时刻在不同时区可能落在不同日期，因此必须传入 tz。
export function todayKey(nowIso: string, tz: string): string {
  return dateKey(nowIso, tz)
}

export function formatDateLabel(iso: string, tz: string): string {
  const d = new Date(iso)
  const md = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(d)
  const wk = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
    timeZone: tz,
  }).format(d)
  return `${md} ${wk}`
}
