import { Navigate, useParams } from "react-router-dom"

import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import { usePartnerProductionRun } from "../../../hooks/api/partner-production-runs"

/**
 * #342 — `/production-runs/:id` is retired; design work-orders now open on the
 * unified order detail (`/orders/:id`). This resolves the legacy production run
 * to its unified order (via the order↔production_run link, surfaced as
 * `unified_order_id` on the detail response) and redirects. Bookmarks / external
 * links keep working.
 */
export const ProductionRunRedirect = () => {
  const { id } = useParams()
  const { unified_order_id, isPending, isError } = usePartnerProductionRun(
    id || ""
  )

  if (isPending) {
    return <SingleColumnPageSkeleton sections={2} showJSON={false} />
  }

  if (!isError && unified_order_id) {
    return <Navigate to={`/orders/${unified_order_id}`} replace />
  }

  // Pre-T2 legacy-only runs never projected into a unified order — fall back to
  // the unified design panel rather than a dead page.
  return <Navigate to="/orders/design" replace />
}
