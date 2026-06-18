import { FIFA_RANKING } from "@/lib/data"
import { RankingsView } from "@/components/rankings-view"

export default function RankingsPage() {
  return <RankingsView teams={FIFA_RANKING} />
}
