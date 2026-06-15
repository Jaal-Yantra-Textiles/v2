import { useLocation, useParams } from "react-router-dom"

import { useOrder } from "./api/orders"

/**
 * #342 — inventory work-order actions live under `/orders/:id/inventory/*`, so
 * the route param is the UNIFIED order id, while the inventory action hooks /
 * endpoints key off the LEGACY inventory_order id (`metadata.legacy_id`).
 *
 * Callers may pass the legacy id via router `state` for an instant resolve;
 * the header action menu (and direct navigation / bookmarks) fall back to
 * fetching the unified order and reading `metadata.legacy_id`.
 */
export const useInventoryActionTarget = () => {
  const { id: unifiedOrderId } = useParams()
  const location = useLocation()
  const stateId = (location.state as any)?.inventoryOrderId as string | undefined

  const { order, isLoading } = useOrder(
    unifiedOrderId || "",
    { fields: "id,metadata" },
    { enabled: !stateId && !!unifiedOrderId }
  )

  const inventoryOrderId =
    stateId || (order?.metadata?.legacy_id as string | undefined) || ""

  return {
    inventoryOrderId,
    unifiedOrderId: unifiedOrderId || "",
    isResolving: !stateId && isLoading,
  }
}
