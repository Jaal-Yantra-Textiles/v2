import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Heading } from "@medusajs/ui"
import { sdk } from "../../../../../lib/config"
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer"
import { useRouteModal } from "../../../../../components/modal/use-route-modal"
import {
  GoalForm,
  type GoalFormValues,
} from "../../../../../components/ad-planning/goals/goal-form"

export default function GoalEditDrawerPage() {
  const { id } = useParams<{ id: string }>()
  const { handleSuccess } = useRouteModal()

  const { data, isLoading } = useQuery({
    queryKey: ["ad-planning", "goals", id, "edit"],
    queryFn: () =>
      sdk.client.fetch<{ goal: any }>(`/admin/ad-planning/goals/${id}`, {
        method: "GET",
      }),
    enabled: !!id,
  })

  if (isLoading || !data?.goal) return null

  const initial: Partial<GoalFormValues> = {
    name: data.goal.name,
    description: data.goal.description ?? "",
    goal_type: data.goal.goal_type,
    is_active: !!data.goal.is_active,
    priority: data.goal.priority ?? 0,
    default_value: data.goal.default_value ?? null,
    value_from_event: !!data.goal.value_from_event,
    website_id: data.goal.website_id ?? "",
    conditions: data.goal.conditions ?? {},
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Edit goal</Heading>
      </RouteDrawer.Header>
      <GoalForm
        initial={initial}
        goalId={id}
        mode="edit"
        onCancel={() => handleSuccess()}
        onSuccess={() => handleSuccess()}
      />
    </RouteDrawer>
  )
}
