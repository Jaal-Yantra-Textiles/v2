import { Heading, Skeleton, Text } from "@medusajs/ui"
import { useParams, useSearchParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { EditCostForm } from "../../../../components/production-runs/production-run-cost-form"
import { useProductionRun } from "../../../../hooks/api/production-runs"

export default function EditCostPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const typeParam = searchParams.get("type") as "total" | "per_unit" | null

  const { production_run, isLoading, error } = useProductionRun(id || "", undefined, {
    enabled: !!id,
  })

  if (isLoading || !production_run) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Skeleton className="h-6 w-40" />
        </RouteDrawer.Header>
        <div className="flex flex-1 flex-col gap-y-6 overflow-y-auto px-6 py-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </RouteDrawer>
    )
  }

  if (error) {
    return (
      <RouteDrawer>
        <RouteDrawer.Header>
          <Heading>Error</Heading>
        </RouteDrawer.Header>
        <div className="px-6 py-6">
          <Text className="text-ui-fg-subtle">{error.message}</Text>
        </div>
      </RouteDrawer>
    )
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <div className="flex flex-col gap-y-0.5">
          <Heading>Set partner cost</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Record estimated cost and how it should be interpreted
          </Text>
        </div>
      </RouteDrawer.Header>
      <EditCostForm run={production_run} initialType={typeParam || undefined} />
    </RouteDrawer>
  )
}
