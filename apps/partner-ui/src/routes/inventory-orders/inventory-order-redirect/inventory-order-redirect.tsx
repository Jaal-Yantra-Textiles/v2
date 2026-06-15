import { Navigate, useParams } from "react-router-dom"

import { SingleColumnPageSkeleton } from "../../../components/common/skeleton"
import { usePartnerInventoryOrder } from "../../../hooks/api/partner-inventory-orders"

/**
 * #342 — `/inventory-orders/:id` is retired; inventory work-orders now open on
 * the unified order detail (`/orders/:id`). This resolves the legacy inventory
 * order to its unified order (via the order↔inventory_order link, surfaced as
 * `unified_order_id`) and redirects. Bookmarks / external links keep working.
 */
export const InventoryOrderRedirect = () => {
  const { id } = useParams()
  const { inventoryOrder, isPending, isError } = usePartnerInventoryOrder(
    id || ""
  )

  if (isPending) {
    return <SingleColumnPageSkeleton sections={2} showJSON={false} />
  }

  const unifiedId = (inventoryOrder as any)?.unified_order_id as
    | string
    | undefined

  if (!isError && unifiedId) {
    return <Navigate to={`/orders/${unifiedId}`} replace />
  }

  // Pre-T2 legacy-only orders never projected into a unified order — fall back
  // to the unified inventory panel rather than a dead page.
  return <Navigate to="/orders/inventory" replace />
}
