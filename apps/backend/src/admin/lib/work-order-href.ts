/**
 * #2264 — where a WORK order lives in the admin, or null for a customer sale.
 *
 * A work order (a purchase from a partner) is served through the core order
 * API so partner-ui keeps one shape, but the core order SCREEN is a sale
 * screen — payment, fulfilment, customer — and none of it applies. Each kind
 * has its own page:
 *
 *   inventory          → the inventory order it is  (/orders/inventory/:id)
 *   design, one run    → that production run        (/production-runs/:id)
 *   design, collated   → Design Work Orders, filtered to it
 *
 * Reads what BOTH sources send: the mirror's detail route attaches the links
 * (object or array) and carries `metadata.collated_design_order`;
 * `toOrderShape` sends arrays and `unified_order_kind.kind`.
 */

type Ref = { id?: string | null } | null | undefined

const asList = (rel: Ref | Ref[]): Array<{ id: string }> =>
  (Array.isArray(rel) ? rel : rel ? [rel] : []).filter(
    (r): r is { id: string } => Boolean(r?.id)
  )

const isCollated = (order: any): boolean => {
  const kind = order?.unified_order_kind?.kind
  if (kind === "collated") return true
  if (kind === "per_run") return false
  return order?.metadata?.collated_design_order === true
}

export const designWorkOrderHref = (orderId: string): string =>
  `/design-work-orders?id=${encodeURIComponent(orderId)}`

export const workOrderHref = (order: any): string | null => {
  if (!order?.id) return null
  const inventoryOrders = asList(order.inventory_orders)
  if (inventoryOrders.length) {
    return `/orders/inventory/${inventoryOrders[0].id}`
  }
  const runs = asList(order.production_runs)
  if (!runs.length) return null
  if (isCollated(order) || runs.length > 1) {
    return designWorkOrderHref(order.id)
  }
  return `/production-runs/${runs[0].id}`
}

/** Where an order row should link: its work-order page, else the order screen. */
export const orderHref = (order: any): string =>
  workOrderHref(order) ?? `/orders/${order?.id}`
