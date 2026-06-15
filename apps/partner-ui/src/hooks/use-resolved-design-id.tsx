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
  const { id } = useParams()
  const location = useLocation()
  const underOrder = location.pathname.startsWith("/orders/")

  const { order } = useOrder(
    id || "",
    { fields: "id,metadata" },
    { enabled: underOrder && !!id }
  )
  const runId = (order?.metadata as any)?.legacy_id as string | undefined
  const { production_run } = usePartnerProductionRun(runId ?? "", {
    enabled: underOrder && !!runId,
  })

  return (
    (underOrder ? ((production_run as any)?.design_id as string | undefined) : id) ||
    ""
  )
}
