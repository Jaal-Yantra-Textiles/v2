/**
 * #2262 S0 — THE contract: the fields of a work order that partner-ui and the
 * admin actually read, normalised so two responses can be compared.
 *
 * Measured 2026-09-24 against partner-ui (order-detail work-order branch,
 * order-list-table, use-order-kind, lib/order-kind, collated-design-runs,
 * design-order-lines) and admin (design-work-orders page, partner inspection).
 * The retail sections (payment, fulfillment, customer, edits, returns) are
 * hidden for work orders, so their fields are NOT part of the contract.
 *
 * The old response (core mirror) and the new one (`toOrderShape`) must agree
 * on every key this returns. Add a key here BEFORE a UI starts reading it.
 */

const idsOf = (rel: any): string[] =>
  (Array.isArray(rel) ? rel : rel ? [rel] : [])
    .map((r: any) => r?.id)
    .filter(Boolean)
    .sort()

const iso = (v: any): string | null =>
  v == null ? null : new Date(v).toISOString()

const n = (v: any): number | null => (v == null ? null : Number(v))

/** Mirrors partner-ui `isCollatedOrder`: sidecar first, blob as fallback. */
const isCollated = (order: any): boolean => {
  const kind = order?.unified_order_kind?.kind
  if (kind === "collated") return true
  if (kind === "per_run") return false
  return order?.metadata?.collated_design_order === true
}

/** Fields read on the orders LIST row. */
export const pickWorkOrderListContract = (order: any) => ({
  id: order?.id,
  display_id: n(order?.display_id),
  status: order?.status,
  created_at: iso(order?.created_at),
  currency_code: order?.currency_code,
  total: n(order?.total),
  partner_status: order?.unified_order_status?.partner_status ?? null,
  collated: isCollated(order),
  legacy_id: order?.metadata?.legacy_id ?? null,
})

/** Fields read on the order DETAIL page's work-order branch. */
export const pickWorkOrderContract = (order: any) => ({
  ...pickWorkOrderListContract(order),
  canceled_at: iso(order?.canceled_at),
  metadata: order?.metadata ?? {},
  production_run_ids: idsOf(order?.production_runs),
  inventory_order_ids: idsOf(order?.inventory_orders),
  items: [...(order?.items ?? [])]
    .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))
    .map((it: any) => ({
      id: it.id,
      title: it.title,
      thumbnail: it.thumbnail ?? null,
      quantity: n(it.quantity),
      unit_price: n(it.unit_price),
      design_id: it.metadata?.design_id ?? null,
      production_run_id: it.metadata?.production_run_id ?? null,
    })),
})
