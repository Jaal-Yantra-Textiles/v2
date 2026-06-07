import { useParams } from "react-router-dom"

import { useDesign } from "../../../../hooks/api/designs"
import { DesignProductionRunsSection } from "../../../../components/designs/design-production-runs-section"
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"

/**
 * Dedicated production-runs sub-page for a design (roadmap #8). The design
 * detail page shows a compact summary card; "View all" links here for the
 * full runs list. Reuses the existing DesignProductionRunsSection. The
 * breadcrumb comes from the route `handle` below (the admin shell renders
 * the trail), so no hand-rolled back link is needed.
 */
export default function DesignProductionRunsPage() {
  const { id } = useParams()
  const { design, isLoading } = useDesign(id!, {
    fields: ["partners.*"],
  })

  if (isLoading || !design) {
    return <SingleColumnPageSkeleton sections={1} />
  }

  return (
    <div className="flex w-full flex-col gap-y-3">
      <DesignProductionRunsSection design={design} />
    </div>
  )
}

export const handle = {
  breadcrumb: () => "Production Runs",
}
