import { Heading, Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer"
import { ShortCloseRunForm } from "../../../../components/production-runs/production-run-short-close-form"
import { useProductionRun } from "../../../../hooks/api/production-runs"

/**
 * #1596 — short-close a run, or reverse one. One drawer for both directions:
 * the decision and its reversal are the same conversation, and splitting them
 * across two screens is how the reversal ends up harder to find than the thing
 * it reverses.
 */
export default function ShortCloseRunPage() {
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
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
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

  const isClosed = !!production_run.short_closed_at

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <div className="flex flex-col gap-y-0.5">
          <Heading>{isClosed ? "Reopen run" : "Short-close run"}</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {isClosed
              ? "Make the ordered quantity billable again"
              : "Declare that no more will be made on this run"}
          </Text>
        </div>
      </RouteDrawer.Header>
      <ShortCloseRunForm run={production_run} />
    </RouteDrawer>
  )
}
