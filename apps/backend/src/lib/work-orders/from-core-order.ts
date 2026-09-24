import type { WorkOrderRow } from "./to-order-shape"

/**
 * #2262 S0 — convert a #342 core-order MIRROR into a `work_order` row.
 *
 * This is the one place that knows how the mirror encoded a work order, so the
 * S1 backfill and the S0 parity test share it. Input is a `query.graph` read of
 * `order` with WORK_ORDER_MIRROR_FIELDS plus the partner from the D3
 * partner↔order link.
 *
 * Returns `null` for a RETAIL order (neither execution link) — never guess a
 * kind for an order that is not a work order.
 */

export const WORK_ORDER_MIRROR_FIELDS = [
  "id",
  "display_id",
  "status",
  "currency_code",
  "created_at",
  "updated_at",
  "canceled_at",
  "metadata",
  // Not converted — read so the parity job can compare the mirror's total.
  "total",
  // `items.*`, NOT `items.quantity`: a core line's quantity lives on its
  // order_item detail row, and only the wildcard resolves it — a named
  // `items.quantity` comes back undefined (caught by the S0 parity spec; same
  // finding as reproject-inventory-mirror-items.ts).
  "items.*",
  "production_runs.id",
  "inventory_orders.id",
  "unified_order_status.partner_status",
  "unified_order_kind.kind",
]

const asList = (rel: any): Array<{ id: string }> =>
  (Array.isArray(rel) ? rel : rel ? [rel] : []).filter((r: any) => r?.id)

export const fromCoreOrder = (
  order: any,
  partnerId: string | null
): WorkOrderRow | null => {
  const runs = asList(order?.production_runs)
  const invs = asList(order?.inventory_orders)
  const kind = runs.length ? "design" : invs.length ? "inventory" : null
  if (!kind) {
    return null
  }

  const metadata = (order.metadata ?? {}) as Record<string, any>

  // Same precedence as partner-ui `isCollatedOrder`: the typed sidecar wins,
  // and only an explicit value means anything; the blob is the fallback for
  // orders written before the sidecar existed.
  const sidecarKind = order?.unified_order_kind?.kind
  const collation: "collated" | "per_run" =
    sidecarKind === "collated" || sidecarKind === "per_run"
      ? sidecarKind
      : metadata.collated_design_order === true
      ? "collated"
      : "per_run"

  return {
    id: order.id,
    display_id: order.display_id,
    kind,
    collation: kind === "inventory" ? "per_run" : collation,
    status: order.status,
    partner_status: order?.unified_order_status?.partner_status ?? null,
    partner_id: partnerId,
    currency_code: order.currency_code,
    inventory_order_id: kind === "inventory" ? invs[0].id : null,
    source_order_id: metadata.source_order_id ?? null,
    canceled_at: order.canceled_at ?? null,
    superseded_by_run_ids: Array.isArray(metadata.superseded_by_run_ids)
      ? metadata.superseded_by_run_ids.map(String)
      : null,
    // The mirror's order↔production_run link, carried as-is: the backfill
    // re-creates it as work_order ↔ production_runs. Not derived from lines.
    production_runs: kind === "design" ? runs.map((r) => ({ id: r.id })) : [],
    // No metadata is carried. The keys a reader still uses are synthesised by
    // toOrderShape() from the typed columns; the rest had no reader on the order.
    created_at: order.created_at,
    updated_at: order.updated_at,
    items: (order.items ?? []).map((it: any) => ({
      id: it.id,
      title: it.title,
      subtitle: it.subtitle ?? null,
      thumbnail: it.thumbnail ?? null,
      quantity: it.quantity,
      unit_price: it.unit_price,
      // Of the mirror's line metadata only these survive as columns:
      // design_id + production_run_id (the UI reads them) and the inventory
      // line key (the S3 line sync matches on it). cost_type /
      // legacy_cost_estimate belong to the run, inventory_item_id to the
      // inventory order line, legacy_unit_price always equalled unit_price.
      design_id: it.metadata?.design_id ?? null,
      production_run_id: it.metadata?.production_run_id ?? null,
      inventory_order_line_id: it.metadata?.legacy_orderline_id ?? null,
      created_at: it.created_at,
      updated_at: it.updated_at,
    })),
  }
}
