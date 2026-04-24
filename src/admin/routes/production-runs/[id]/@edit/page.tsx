import { Heading, Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { EditProductionRunForm } from "../../../../components/production-runs/production-run-edit-form"
import { useProductionRun } from "../../../../hooks/api/production-runs"

export default function EditProductionRunPage() {
  const { id } = useParams()
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
          <Heading>Edit production run</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Adjust quantity, role, and type
          </Text>
        </div>
      </RouteDrawer.Header>
      <EditProductionRunForm run={production_run} />
    </RouteDrawer>
  )
}
