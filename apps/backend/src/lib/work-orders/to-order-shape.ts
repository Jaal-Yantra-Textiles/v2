import { MathBN } from "@medusajs/framework/utils"

/**
 * #2262 S0 — serve a `work_order` row in the CORE ORDER response shape.
 *
 * partner-ui and the admin read work orders through the same endpoints and
 * components as retail orders (`GET /partners/orders/:id`, the orders list,
 * `useOrderKind`, `isCollatedOrder`). Emitting the same keys is what lets the
 * storage move without a UI change. The fields that matter are pinned by
 * `pickWorkOrderContract` (./work-order-contract.ts); everything else here is
 * a sale-side field a work order does not have, emitted empty so a component
 * that touches it gets the same "nothing" the mirror gave it.
 */

export type WorkOrderItemRow = {
  id: string
  title: string
  subtitle?: string | null
  thumbnail?: string | null
  quantity: unknown
  unit_price: unknown
  design_id?: string | null
  production_run_id?: string | null
  inventory_order_line_id?: string | null
  created_at?: Date | string
  updated_at?: Date | string
}

export type WorkOrderRow = {
  id: string
  display_id: number
  kind: "design" | "inventory"
  collation: "collated" | "per_run"
  status: string
  partner_status?: string | null
  partner_id?: string | null
  currency_code: string
  inventory_order_id?: string | null
  source_order_id?: string | null
  canceled_at?: Date | string | null
  superseded_by_run_ids?: string[] | null
  /** The work_order ↔ production_runs link, as query.graph returns it. */
  production_runs?: Array<{ id: string }> | null
  created_at?: Date | string
  updated_at?: Date | string
  items?: WorkOrderItemRow[]
}

const num = (v: unknown): number => MathBN.convert(v as any).toNumber()

/**
 * A work-order line has no metadata blob — every fact is a column. partner-ui
 * reads `design_id` / `production_run_id` from `items[].metadata`
 * (collated-design-runs, design-order-lines), so those two are echoed there to
 * keep the API shape. Nothing is READ back from this object.
 */
const lineMetadata = (item: WorkOrderItemRow): Record<string, unknown> => {
  const meta: Record<string, unknown> = {}
  if (item.design_id) meta.design_id = item.design_id
  if (item.production_run_id) meta.production_run_id = item.production_run_id
  return meta
}

const ms = (v: Date | string | undefined): number =>
  v == null ? 0 : new Date(v).getTime() || 0

const byCreation = (a: WorkOrderItemRow, b: WorkOrderItemRow): number =>
  ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id)

/**
 * The order-level `metadata` keys something still READS, synthesised from
 * typed columns — the row stores no blob. Measured 2026-09-24:
 *   legacy_id              partner-ui use-order-kind / use-resolved-design-id
 *   collated_design_order  partner-ui isCollatedOrder (fallback only)
 *   production_run_id(s)   list-params collation note; kept for the list row
 *   source_order_id        admin design-work-orders route
 *   superseded_by_run_ids  list-partner-orders, payment run-supersession
 * The mirror's other keys (expected_delivery_date, stock locations, …) had no
 * reader on the order; they live on the inventory order / run they came from.
 */
export const synthesizeOrderMetadata = (wo: WorkOrderRow): Record<string, unknown> => {
  const runIds = (wo.production_runs ?? []).map((r) => r.id)
  // The mirror pointed legacy_id at the FIRST run it was created with; lines
  // are created in run order, so the earliest line's run is that run.
  const firstLineRun = [...(wo.items ?? [])].sort(byCreation)[0]?.production_run_id
  const legacyId =
    wo.kind === "inventory"
      ? wo.inventory_order_id ?? null
      : firstLineRun ?? runIds[0] ?? null

  const meta: Record<string, unknown> = { legacy_id: legacyId }
  if (wo.kind === "design" && wo.collation === "per_run" && legacyId) {
    meta.production_run_id = legacyId
  }
  if (wo.kind === "design" && wo.collation === "collated") {
    meta.collated_design_order = true
    meta.production_run_ids = runIds
  }
  if (wo.source_order_id) meta.source_order_id = wo.source_order_id
  if (wo.superseded_by_run_ids?.length) {
    meta.superseded_by_run_ids = wo.superseded_by_run_ids
  }
  return meta
}

export const toOrderShape = (wo: WorkOrderRow) => {
  const items = (wo.items ?? []).map((item) => {
    const quantity = num(item.quantity)
    const unitPrice = num(item.unit_price)
    const lineTotal = MathBN.mult(item.quantity as any, item.unit_price as any).toNumber()
    return {
      id: item.id,
      title: item.title,
      subtitle: item.subtitle ?? null,
      thumbnail: item.thumbnail ?? null,
      quantity,
      unit_price: unitPrice,
      metadata: lineMetadata(item),
      // The typed line facts, served as themselves.
      design_id: item.design_id ?? null,
      production_run_id: item.production_run_id ?? null,
      inventory_order_line_id: item.inventory_order_line_id ?? null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      // A work-order line is never a product sale: no variant, no tax, no discount.
      variant_id: null,
      product_id: null,
      requires_shipping: false,
      is_custom_price: true,
      tax_lines: [],
      adjustments: [],
      subtotal: lineTotal,
      total: lineTotal,
      original_subtotal: lineTotal,
      original_total: lineTotal,
      tax_total: 0,
      discount_total: 0,
    }
  })

  // Summed in BigNumber: 70.6 m × ₹690 lines must not drift to 48713.99999.
  const total = (wo.items ?? [])
    .reduce(
      (sum, item) => MathBN.add(sum, MathBN.mult(item.quantity as any, item.unit_price as any)),
      MathBN.convert(0)
    )
    .toNumber()

  const productionRuns =
    wo.kind === "design" ? (wo.production_runs ?? []).map((r) => ({ id: r.id })) : []
  const inventoryOrders =
    wo.kind === "inventory" && wo.inventory_order_id
      ? [{ id: wo.inventory_order_id }]
      : []

  return {
    id: wo.id,
    display_id: wo.display_id,
    custom_display_id: null,
    status: wo.status,
    created_at: wo.created_at,
    updated_at: wo.updated_at,
    canceled_at: wo.canceled_at ?? null,
    currency_code: wo.currency_code,
    metadata: synthesizeOrderMetadata(wo),
    // A work order has no buyer, no region and no sales channel. The mirror
    // faked the last two; they are simply absent now.
    email: null,
    customer_id: null,
    customer: null,
    region_id: null,
    sales_channel_id: null,
    sales_channel: null,
    shipping_address: null,
    billing_address: null,
    items,
    // Totals: sum of lines; a work order carries no tax, shipping or discount.
    total,
    subtotal: total,
    item_total: total,
    item_subtotal: total,
    original_total: total,
    original_subtotal: total,
    original_item_total: total,
    tax_total: 0,
    item_tax_total: 0,
    original_tax_total: 0,
    original_item_tax_total: 0,
    discount_total: 0,
    discount_subtotal: 0,
    item_discount_total: 0,
    shipping_total: 0,
    shipping_subtotal: 0,
    shipping_tax_total: 0,
    original_shipping_tax_total: 0,
    shipping_discount_total: 0,
    credit_line_total: 0,
    // Money in/out and goods movement are S4 (#2266). Until then these are
    // exactly what the mirror carried: nothing paid, nothing fulfilled.
    payment_status: "not_paid",
    fulfillment_status: "not_fulfilled",
    payment_collections: [],
    fulfillments: [],
    shipping_methods: [],
    credit_lines: [],
    // The discriminators the UI keys on (useOrderKind / isCollatedOrder).
    production_runs: productionRuns,
    inventory_orders: inventoryOrders,
    unified_order_status: wo.partner_status
      ? { partner_status: wo.partner_status }
      : null,
    unified_order_kind: { kind: wo.collation },
  }
}
