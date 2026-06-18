import { NextResponse } from "next/server"
import { getMatchStats } from "@/lib/db/match-stats"

export const dynamic = "force-dynamic"
export const revalidate = 0

// 单场实时技术统计端点。前端 useLiveStats 在比赛进行中轮询。
// GET /api/match-stats?key=GHA-PAN
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get("key")
  if (!key) {
    return NextResponse.json({ error: "missing key" }, { status: 400 })
  }
  try {
    const stats = getMatchStats(key)
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json({ home: null, away: null, hasData: false })
  }
}
