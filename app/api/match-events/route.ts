import { NextResponse } from "next/server"
import { getDbEvents } from "@/lib/db/events"

// 单场实时事件端点：?key=GER-CUW → 返回该场最新事件时间线（已译中文）。
// 详情页在该场进行中时轮询本接口叠加时间线；静态页本身不变。
// 数据来自 wc.db（events 表），与首页比分 overlay 解耦。
export const dynamic = "force-dynamic"

export function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const key = searchParams.get("key") || ""
  const events = key ? getDbEvents(key) : []
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } })
}
