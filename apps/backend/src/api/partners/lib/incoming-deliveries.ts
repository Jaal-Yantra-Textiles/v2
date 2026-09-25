/**
 * #2286 — the receiving partner's view of inventory orders delivered to their
 * warehouse. Shared by the partner route and its admin inspection mirror.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { RECEIVABLE_STATUSES } from "../../../workflows/inventory_orders/lib/plan-inventory-order-receipt"
import {
  listInventoryOrderIdsDeliveredTo,
  pickInventoryOrderDestinations,
} from "../../../workflows/inventory_orders/lib/order-destination"
import InventoryOrdersStockLocationsLink from "../../../links/inventory-orders-stock-locations"

const round = (n: number) => Math.round(n * 1000) / 1000

export async function readIncomingDeliveries(container: any, locationId: string, includeAll: boolean) {
  const ids = await listInventoryOrderIdsDeliveredTo(container, locationId)
  if (!ids.length) return []

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "inventory_orders",
    fields: [
      "id",
      "status",
      "order_date",
      "expected_delivery_date",
      "is_sample",
      "created_at",
      "metadata",
      "orderlines.id",
      "orderlines.quantity",
      "orderlines.material_name",
      "orderlines.inventory_items.id",
      "orderlines.inventory_items.title",
      "orderlines.inventory_items.unit_of_measure",
      "orderlines.line_fulfillments.quantity_delta",
    ],
    filters: { id: ids },
  })

  // The source end of each route — the supplier's warehouse name is the only
  // "who is sending this" a receiving partner needs.
  const { data: linkRows } = await query.graph({
    entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
    fields: ["inventory_orders_id", "stock_location_id", "from_location", "to_location", "stock_location.name"],
    filters: { inventory_orders_id: ids },
  })
  const sourceName = new Map<string, string | null>()
  for (const r of linkRows ?? []) {
    if (r?.from_location) sourceName.set(r.inventory_orders_id, r?.stock_location?.name ?? null)
  }
  // Belt and braces: only orders whose destination is still this location.
  const dest = pickInventoryOrderDestinations(linkRows ?? [])

  const out = (orders ?? [])
    .filter((o: any) => dest.get(o.id) === locationId && o.status !== "Cancelled")
    .map((o: any) => {
      const lines = (o.orderlines ?? []).filter(Boolean).map((l: any) => {
        const ordered = Number(l.quantity) || 0
        const received = round(
          ((l.line_fulfillments ?? []) as any[]).reduce((s, f) => s + (Number(f?.quantity_delta) || 0), 0)
        )
        const item = (l.inventory_items ?? [])[0]
        return {
          id: l.id,
          name: l.material_name || item?.title || null,
          unit: item?.unit_of_measure ?? null,
          ordered,
          received,
          outstanding: round(Math.max(0, ordered - received)),
        }
      })
      const outstanding = round(lines.reduce((s: number, l: any) => s + l.outstanding, 0))
      const receivable = RECEIVABLE_STATUSES.has(String(o.status))
      return {
        id: o.id,
        status: o.status,
        order_date: o.order_date,
        expected_delivery_date: o.expected_delivery_date,
        is_sample: !!o.is_sample,
        from: sourceName.get(o.id) ?? null,
        invoice_number: o.metadata?.invoice_number ?? null,
        lines,
        outstanding,
        fully_received: outstanding === 0 && lines.length > 0,
        // Why a Confirm button is not offered, in the partner's terms.
        can_confirm: receivable && outstanding > 0,
        cannot_confirm_reason: !receivable
          ? "not_dispatched"
          : outstanding === 0
          ? "fully_received"
          : null,
        created_at: o.created_at,
      }
    })
    .filter((d: any) => includeAll || !d.fully_received)
    .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))

  return out
}

