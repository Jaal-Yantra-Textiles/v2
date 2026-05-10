import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Heading } from "@medusajs/ui"
import { sdk } from "../../../../../lib/config"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { GoalGoogleAdsMappingForm } from "../../../../../components/ad-planning/goals/goal-google-ads-mapping-form"

export default function GoalGoogleAdsMappingDrawerPage() {
  const { id } = useParams<{ id: string }>()

  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "goals", id, "google-ads-mapping"],
    queryFn: () =>
      sdk.client.fetch<{ goal: any }>(`/admin/ad-planning/goals/${id}`, {
        method: "GET",
      }),
    enabled: !!id,
  })

  if (isLoading || !data?.goal) return null

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Google Ads mapping</Heading>
      </RouteDrawer.Header>
      <GoalGoogleAdsMappingForm goal={data.goal} />
    </RouteDrawer>
  )
}
