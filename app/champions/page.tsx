import { getChampionRace } from "@/lib/db/champion-sim"
import { ChampionBoard } from "@/components/champion-board"

export const metadata = {
  title: "AI 夺冠概率榜 | World Cup AI Hub",
  description: "基于 opus4.8 Elo 多因子引擎锦标赛蒙特卡洛模拟、并随真实赛果实时更新的 2026 世界杯夺冠概率排行榜。",
}

// 实时：读 champion_sim 库（已完赛锁定后的最新模拟），DB 空时回退静态基线。
export const dynamic = "force-dynamic"

export default function ChampionsPage() {
  return <ChampionBoard race={getChampionRace()} />
}
