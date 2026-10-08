import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { FULLFILLED_ORDERS_MODULE } from "../../../modules/fullfilled_orders"
import InventoryOrdersStockLocationsLink from "../../../links/inventory-orders-stock-locations"
import { lineLedger, sumDispatchedByLine, type LineLedger } from "./dispatch-ledger"
import { pickInventoryOrderDestinations } from "./order-destination"

/**
 * #2289 S2 — inventory orders whose goods a supplier DISPATCHED that nobody has
 * COUNTED yet.
 *
 * Since S1 a supplier's Complete posts no stock; only a receiver's count does.
 * So a dispatch nobody counts never reaches the books. This is the list that
 * makes that visible: for our own warehouse it is the admin's to-do list, for a
 * partner's warehouse it is who to remind.
 *
 * Reads the dispatch table, not order status: `Shipped` alone says nothing
 * about whether a count happened, and a pre-#2289 order has no dispatch rows
 * because its supplier's Complete already posted (and so is not awaiting).
 */

export type AwaitingCountLine = LineLedger & { title: string | null }

export type AwaitingCountOrder = {
  id: string
  status: string
  partner_id: string | null
  partner_name: string | null
  destination_location_id: string | null
  destination_name: string | null
  first_dispatched_at: string | null
  last_dispatched_at: string | null
  /** Days since the most recent dispatch, rounded down. */
  days_since_dispatch: number | null
  /** A carrier shipment on the order reports delivered. */
  carrier_delivered: boolean
  awaiting_quantity: number
  lines: AwaitingCountLine[]
}

const AWAITING_TOLERANCE = 0.01

const asArray = <T>(v: T | T[] | null | undefined): T[] =>
  !v ? [] : Array.isArray(v) ? v : [v]

export async function listOrdersAwaitingCount(
  container: any,
  options: { orderIds?: string[]; now?: Date } = {}
): Promise<AwaitingCountOrder[]> {
  const fulfilled: any = container.resolve(FULLFILLED_ORDERS_MODULE)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const dispatches: any[] = await fulfilled.listInventoryDispatches(
    options.orderIds?.length ? { inventory_order_id: options.orderIds } : {},
    { take: null }
  )
  const orderIds = [...new Set(dispatches.map((d) => String(d.inventory_order_id)).filter(Boolean))]
  if (!orderIds.length) return []
  // #2289 S3 — counted-short goods are not awaiting a count.
  const shortfalls: any[] = await fulfilled.listInventoryShortfalls(
    { inventory_order_id: orderIds },
    { take: null }
  )

  const { data: orders } = await query.graph({
    entity: "inventory_orders",
    fields: [
      "id",
      "status",
      "orderlines.id",
      "orderlines.quantity",
      "orderlines.line_fulfillments.quantity_delta",
      "orderlines.inventory_items.title",
      "orderlines.inventory_items.sku",
      "partner.id",
      "partner.name",
      "inventory_shipments.status",
    ],
    filters: { id: orderIds },
  })

  const { data: linkRows } = await query.graph({
    entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
    fields: ["inventory_orders_id", "stock_location_id", "to_location", "from_location"],
    filters: { inventory_orders_id: orderIds },
  })
  const destinations = pickInventoryOrderDestinations(linkRows ?? [])
  const locationIds = [...new Set([...destinations.values()].filter(Boolean))] as string[]
  const locationNames = new Map<string, string>()
  if (locationIds.length) {
    const { data: locations } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name"],
      filters: { id: locationIds },
    })
    for (const l of locations ?? []) locationNames.set(String(l.id), String(l.name ?? ""))
  }

  const byOrder = new Map<string, any[]>()
  for (const d of dispatches) {
    const id = String(d.inventory_order_id)
    byOrder.set(id, [...(byOrder.get(id) ?? []), d])
  }

  const now = options.now ?? new Date()
  const out: AwaitingCountOrder[] = []
  for (const order of orders ?? []) {
    if (!order || order.status === "Cancelled") continue
    const rows = byOrder.get(String(order.id)) ?? []
    const dispatched = sumDispatchedByLine(rows)
    const orderShortfalls = shortfalls.filter((r) => String(r.inventory_order_id) === String(order.id))
    const lines: AwaitingCountLine[] = asArray(order.orderlines)
      .filter(Boolean)
      .map((ol: any) => {
        const item = asArray(ol.inventory_items)[0] as any
        return { ...lineLedger(ol, dispatched, orderShortfalls), title: item?.title ?? item?.sku ?? null }
      })
    const awaiting = lines.reduce((s, l) => s + l.awaiting_count, 0)
    if (awaiting <= AWAITING_TOLERANCE) continue

    const times = rows
      .map((r) => (r.dispatched_at ? new Date(r.dispatched_at).getTime() : NaN))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)
    const first = times.length ? new Date(times[0]).toISOString() : null
    const last = times.length ? new Date(times[times.length - 1]).toISOString() : null
    const destination = destinations.get(String(order.id)) ?? null
    const partner = asArray(order.partner)[0] as any

    out.push({
      id: String(order.id),
      status: String(order.status),
      partner_id: partner?.id ?? null,
      partner_name: partner?.name ?? null,
      destination_location_id: destination,
      destination_name: destination ? locationNames.get(destination) ?? null : null,
      first_dispatched_at: first,
      last_dispatched_at: last,
      days_since_dispatch: last
        ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000)
        : null,
      carrier_delivered: asArray(order.inventory_shipments).some(
        (s: any) => String(s?.status ?? "").toLowerCase() === "delivered"
      ),
      awaiting_quantity: Math.round(awaiting * 1000) / 1000,
      lines: lines.filter((l) => l.awaiting_count > AWAITING_TOLERANCE),
    })
  }

  // Oldest first: the longest-uncounted delivery is the most urgent.
  return out.sort((a, b) =>
    String(a.first_dispatched_at ?? "").localeCompare(String(b.first_dispatched_at ?? ""))
  )
}
