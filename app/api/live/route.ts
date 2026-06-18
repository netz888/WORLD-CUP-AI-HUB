import { NextResponse } from "next/server"
import { getLiveOverlay } from "@/lib/live-overlay"
import { getChampionRace } from "@/lib/db/champion-sim"

// 轻量轮询端点：返回实时 overlay + 夺冠榜快照（均读本地库，由 poller 写入）。
// 纯读库、无外部调用，高频轮询无额度压力。
// championRace 让客户端组件（首页榜单等）无需直连 DB 也能拿到「随真实赛果更新」的夺冠概率。
export const dynamic = "force-dynamic"

export async function GET() {
  const overlay = await getLiveOverlay()
  const championRace = getChampionRace()
  return NextResponse.json(
    { overlay, championRace },
    { headers: { "Cache-Control": "no-store" } },
  )
}
