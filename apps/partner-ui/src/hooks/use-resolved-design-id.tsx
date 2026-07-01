import { useLocation, useParams } from "react-router-dom"

import { useOrder } from "./api/orders"
import { usePartnerProductionRun } from "./api/partner-production-runs"

/**
 * #342 — resolve the design id for the design media/moodboard surfaces, which
 * are mounted at BOTH `/designs/:id/*` (param IS the design id) and
 * `/orders/:id/design-details/*` (param is the UNIFIED order id → resolve the
 * production run, then its design). Lets one set of components serve the
 * standalone design manager and the in-order design-details sub-route.
 */
export const useResolvedDesignId = (): string => {
  const { id, designId: designIdParam } = useParams()
  const location = useLocation()
  const underOrder = location.pathname.startsWith("/orders/")

  // #826 — a collated order's per-design route (`/design-details/:designId`)
  // names the design directly; use it and skip the legacy_id run resolution.
  const { order } = useOrder(
    id || "",
    { fields: "id,metadata" },
    { enabled: underOrder && !designIdParam && !!id }
  )
  const runId = (order?.metadata as any)?.legacy_id as string | undefined
  const { production_run } = usePartnerProductionRun(runId ?? "", {
    enabled: underOrder && !designIdParam && !!runId,
  })

  if (designIdParam) {
    return designIdParam
  }

  return (
    (underOrder ? ((production_run as any)?.design_id as string | undefined) : id) ||
    ""
  )
}
