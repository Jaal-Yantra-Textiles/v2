import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import InventoryOrdersStockLocationsLink from "../../../../links/inventory-orders-stock-locations"
import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import { pickInventoryOrderDestinations } from "../../../../workflows/inventory_orders/lib/order-destination"
import { classifyPostingLine } from "../../../../workflows/inventory_orders/lib/postings-at-source"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Where did two-ended inventory orders' goods ACTUALLY land? (#2286 follow-up)
 *
 * Until #2287, receive, the supplier's portal Complete and cancel took the
 * destination as `stock_locations[0]` — on an order with a source AND a
 * destination, possibly the supplier's own warehouse. Proven in a test: a
 * portal Complete of 10 m left 0 at the destination and 10 at the supplier.
 *
 * 🔴 REPORTS ONLY, ALWAYS. `dry_run: false` changes nothing. A `likely` verdict
 * is inference (the Complete path never recorded a location) and stock at a
 * supplier's warehouse can be their own genuine inventory. Moving stock is a
 * separate, deliberate act per order once a human has looked.
 */

const MAX_SCAN = 1000
const paramsSchema = z.object({
  order_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_SCAN).optional(),
})

const money = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

export const auditPostingsAtSourceJob: MaintenanceJob = {
  id: "audit-postings-at-source",
  label: "Find inventory orders whose goods may have been stocked at the SUPPLIER's warehouse",
  description:
    "For inventory orders with both a source and a destination, compare what was received per line against the stock at each end. 'confirmed' = a receipt row posted at the source; 'likely' = received, the destination is short, and the source holds the item (inference — the supplier's Complete never recorded a location, and the stock can be the supplier's own). Cause: before #2287 the destination was read as stock_locations[0], which can be the source. REPORTS ONLY — dry_run=false changes nothing.",
  params: [
    { name: "order_id", type: "string", required: false, description: "Restrict to one inventory order" },
    { name: "limit", type: "number", required: false, description: `Max two-ended orders to examine (default 500, max ${MAX_SCAN})` },
  ],
  run: async (container, { params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params ?? {})
    if (!parsed.success) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => i.message).join("; "))
    }
    const { order_id, limit } = parsed.data
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: any = container.resolve(ORDER_INVENTORY_MODULE)

    // 1. Orders with BOTH ends — only they can have posted at the wrong one.
    const { data: linkRows } = await query.graph({
      entity: (InventoryOrdersStockLocationsLink as any).entryPoint,
      fields: ["inventory_orders_id", "stock_location_id", "from_location", "to_location", "stock_location.name"],
      ...(order_id ? { filters: { inventory_orders_id: order_id } } : {}),
    })
    const sourceOf = new Map<string, string>()
    const nameOf = new Map<string, string>()
    for (const r of linkRows ?? []) {
      if (r?.stock_location_id && r?.stock_location?.name) nameOf.set(r.stock_location_id, r.stock_location.name)
      if (r?.from_location && r?.inventory_orders_id) sourceOf.set(r.inventory_orders_id, r.stock_location_id)
    }
    const destOf = pickInventoryOrderDestinations(linkRows ?? [])
    const orderIds = Array.from(sourceOf.keys())
      .filter((id) => destOf.get(id) && destOf.get(id) !== sourceOf.get(id))
      .slice(0, limit ?? 500)

    if (order_id && !orderIds.length) {
      return {
        job_id: "audit-postings-at-source",
        dry_run: true,
        applied: false,
        summary: `${order_id} has no source + destination pair, so it cannot have posted at the wrong end.`,
        changes: [],
      }
    }
    if (!orderIds.length) {
      return { job_id: "audit-postings-at-source", dry_run: true, applied: false, summary: "No two-ended inventory orders.", changes: [] }
    }

    // 2. Their lines and what was received.
    const { data: orders } = await query.graph({
      entity: "inventory_orders",
      fields: [
        "id",
        "status",
        "orderlines.id",
        "orderlines.price",
        "orderlines.material_name",
        "orderlines.inventory_items.id",
        "orderlines.inventory_items.title",
        "orderlines.line_fulfillments.quantity_delta",
      ],
      filters: { id: orderIds },
    })

    // 3. Stock at each end, per item.
    const itemIds = new Set<string>()
    for (const o of orders ?? []) for (const l of o.orderlines ?? []) {
      const id = (l?.inventory_items ?? [])[0]?.id
      if (id) itemIds.add(id)
    }
    const levelAt = new Map<string, number>()
    if (itemIds.size) {
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["inventory_item_id", "location_id", "stocked_quantity"],
        filters: { inventory_item_id: Array.from(itemIds) },
      })
      for (const lv of levels ?? []) {
        levelAt.set(`${lv.inventory_item_id}@${lv.location_id}`, Number(lv.stocked_quantity) || 0)
      }
    }

    // 4. Receipt rows that name a location — the only DIRECT evidence.
    const receiptAtSource = new Map<string, number>()
    const acts: any[] = await service
      .listInventoryOrderActivities({ inventory_order_id: orderIds, kind: "goods_received" }, { take: 5000 })
      .catch(() => [])
    for (const a of acts) {
      const src = sourceOf.get(a.inventory_order_id)
      for (const p of (a?.payload?.postings ?? []) as any[]) {
        if (p?.location_id && p.location_id === src) {
          const k = `${a.inventory_order_id}:${p.inventory_item_id}`
          receiptAtSource.set(k, (receiptAtSource.get(k) ?? 0) + (Number(p.quantity) || 0))
        }
      }
    }

    // 5. Classify.
    const changes: MaintenanceChange[] = []
    let confirmed = 0
    let likely = 0
    let value = 0
    const affectedOrders = new Set<string>()
    for (const o of orders ?? []) {
      const src = sourceOf.get(o.id)!
      const dst = destOf.get(o.id)!
      for (const l of o.orderlines ?? []) {
        const item = (l?.inventory_items ?? [])[0]
        const r = classifyPostingLine({
          line_id: l.id,
          item_id: item?.id ?? null,
          name: l.material_name || item?.title || null,
          price: Number(l.price) || 0,
          received: ((l.line_fulfillments ?? []) as any[]).reduce((s, f) => s + (Number(f?.quantity_delta) || 0), 0),
          stocked_at_source: levelAt.get(`${item?.id}@${src}`) ?? 0,
          stocked_at_destination: levelAt.get(`${item?.id}@${dst}`) ?? 0,
          receipt_posted_at_source: receiptAtSource.get(`${o.id}:${item?.id}`) ?? 0,
        })
        if (r.verdict !== "confirmed" && r.verdict !== "likely") continue
        r.verdict === "confirmed" ? confirmed++ : likely++
        value += r.value
        affectedOrders.add(o.id)
        changes.push({
          entity: "inventory_order_line",
          id: `${o.id}:${l.id}`,
          field: "stock_location",
          before: `${nameOf.get(src) ?? src} holds ${r.stocked_at_source}`,
          after: `${nameOf.get(dst) ?? dst} holds ${r.stocked_at_destination} of ${r.received} received`,
          reason: `${r.verdict.toUpperCase()}: ${r.name ?? r.item_id} — ${r.misplaced} unit(s) (${money(r.value)}) appear to sit at the source. Order status ${o.status}.`,
        } as MaintenanceChange)
      }
    }

    return {
      job_id: "audit-postings-at-source",
      dry_run: true,
      applied: false,
      summary:
        `${orderIds.length} two-ended order(s) examined: ${confirmed} line(s) CONFIRMED and ${likely} LIKELY posted at the source, ` +
        `across ${affectedOrders.size} order(s), about ${money(value)} of goods. Reports only — nothing was changed.`,
      changes,
    }
  },
}
