import { GROUPS, computeStandings } from "@/lib/data"
import { GroupsView } from "@/components/groups-view"

export default function GroupsPage() {
  const data = GROUPS.map((g) => ({ group: g, standings: computeStandings(g) }))
  return <GroupsView data={data} />
}
