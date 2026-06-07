import { useParams } from "react-router-dom"

import { useDesign } from "../../../../hooks/api/designs"
import { DesignPartnerSection } from "../../../../components/designs/design-partner-section"
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"

/**
 * Dedicated partners sub-page for a design (roadmap #8). The detail page
 * shows a compact summary card; "View all" links here for the full list +
 * management. Reuses the existing DesignPartnerSection. Breadcrumb via the
 * route handle.
 */
export default function DesignPartnersPage() {
  const { id } = useParams()
  const { design, isLoading } = useDesign(id!, {
    fields: ["partners.*"],
  })

  if (isLoading || !design) {
    return <SingleColumnPageSkeleton sections={1} />
  }

  return (
    <div className="flex w-full flex-col gap-y-3">
      <DesignPartnerSection design={design} />
    </div>
  )
}

export const handle = {
  breadcrumb: () => "Partners",
}
