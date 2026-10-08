import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPartnerNotification } from "../lib/notifications/create-partner-notification"
import { ORDER_INVENTORY_MODULE } from "../modules/inventory_orders"
import { listOrdersAwaitingCount } from "../workflows/inventory_orders/lib/awaiting-count"
import { selectCountReminders } from "../workflows/inventory_orders/lib/count-reminders"

/**
 * #2289 S4 — remind a RECEIVING partner to count goods sent to their warehouse
 * (founder decision 2026-10-08: 3 days after the carrier marks it delivered).
 *
 * Since #2289 S1 a supplier's dispatch posts no stock; the receiver's count
 * does. A partner who never opens Incoming deliveries would leave the goods
 * off the books forever. This nudges them: a bell row and a push that opens
 * the receive screen. Our own warehouse is not reminded: it is the admin's
 * "Awaiting count" list.
 *
 * Idempotency: a `count_reminder` activity per order; an order reminded within
 * the cooldown is skipped, and the notification's idempotency key is per order
 * per day. Best-effort per order. Kill switch: UNCOUNTED_DELIVERY_REMINDERS=false.
 */
const AFTER_DAYS = Number(process.env.UNCOUNTED_DELIVERY_REMINDER_AFTER_DAYS || 3)
const COOLDOWN_DAYS = Number(process.env.UNCOUNTED_DELIVERY_REMINDER_COOLDOWN_DAYS || 3)
const MS_PER_DAY = 86_400_000

const asArray = <T>(v: T | T[] | null | undefined): T[] =>
  !v ? [] : Array.isArray(v) ? v : [v]

/**
 * Stock location → partner, the way the partner portal decides "their"
 * warehouse (resolvePartnerHomeLocation): the store's default location, else
 * a single linked stock location, else a single location on the store's sales
 * channel. A location claimed by two partners maps to nobody.
 */
async function partnerByLocation(container: MedusaContainer): Promise<Map<string, string>> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "stock_locations.id", "stores.default_location_id", "stores.default_sales_channel_id"],
  })
  const channelIds = new Set<string>()
  for (const p of partners ?? []) {
    for (const s of asArray<any>(p.stores)) if (s?.default_sales_channel_id) channelIds.add(String(s.default_sales_channel_id))
  }
  const channelLocation = new Map<string, string>()
  if (channelIds.size) {
    const { data: channels } = await query.graph({
      entity: "sales_channels",
      fields: ["id", "stock_locations.id"],
      filters: { id: [...channelIds] },
    })
    for (const c of channels ?? []) {
      const locs = asArray<any>(c.stock_locations).filter((l) => l?.id)
      if (locs.length === 1) channelLocation.set(String(c.id), String(locs[0].id))
    }
  }

  const claims = new Map<string, Set<string>>()
  for (const p of partners ?? []) {
    const store = asArray<any>(p.stores)[0]
    const linked = asArray<any>(p.stock_locations).filter((l) => l?.id)
    const location =
      (store?.default_location_id ? String(store.default_location_id) : null) ??
      (linked.length === 1 ? String(linked[0].id) : null) ??
      (store?.default_sales_channel_id ? channelLocation.get(String(store.default_sales_channel_id)) ?? null : null)
    if (!location) continue
    claims.set(location, (claims.get(location) ?? new Set()).add(String(p.id)))
  }
  const out = new Map<string, string>()
  for (const [location, ids] of claims) if (ids.size === 1) out.set(location, [...ids][0])
  return out
}

export default async function sendUncountedDeliveryReminders(container: MedusaContainer) {
  if (process.env.UNCOUNTED_DELIVERY_REMINDERS === "false") return
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(ORDER_INVENTORY_MODULE)
  const now = new Date()

  try {
    const awaiting = await listOrdersAwaitingCount(container, { now })
    if (!awaiting.length) return

    const cutoff = new Date(now.getTime() - COOLDOWN_DAYS * MS_PER_DAY)
    const recent = await service.listInventoryOrderActivities(
      { kind: "count_reminder", occurred_at: { $gte: cutoff } },
      { take: 5000 }
    )
    const recentIds = new Set<string>((recent || []).map((a: any) => String(a.inventory_order_id)))

    const due = selectCountReminders(awaiting, await partnerByLocation(container), recentIds, now, AFTER_DAYS)
    let reminded = 0
    for (const d of due) {
      try {
        await createPartnerNotification(container, {
          partner_id: d.partner_id,
          title: "Please count a delivery",
          description:
            d.basis === "carrier_delivered"
              ? `Delivered ${d.days_waiting} day(s) ago and not counted yet. Count what arrived so it goes into your stock.`
              : `Sent to you ${d.days_waiting} day(s) ago and not counted yet. Count what arrived so it goes into your stock.`,
          url: `/orders/incoming/${d.order_id}/receive`,
          resource_type: "inventory_order",
          resource_id: d.order_id,
          trigger_type: "inventory_order.count_reminder",
          idempotency_key: `count-reminder:${d.order_id}:${now.toISOString().slice(0, 10)}`,
          data: { incoming_delivery_id: d.order_id, inventory_order_id: d.order_id },
        })
        await service.createInventoryOrderActivities({
          inventory_order_id: d.order_id,
          activity_type: "reminder_sent",
          kind: "count_reminder",
          actor_type: "scheduled_flow",
          actor_id: null,
          partner_id: d.partner_id,
          channel: "push",
          message_id: null,
          template_name: null,
          recipient: null,
          summary: `Count reminder: ${d.awaiting_quantity} waiting ${d.days_waiting} day(s) (${d.basis === "carrier_delivered" ? "since carrier delivery" : "since dispatch"})`,
          payload: { awaiting_quantity: d.awaiting_quantity, days_waiting: d.days_waiting, basis: d.basis },
          occurred_at: now,
        })
        reminded++
      } catch (e: any) {
        logger.error(`[uncounted-delivery-reminders] failed for ${d.order_id}: ${e?.message}`)
      }
    }
    logger.info(`[uncounted-delivery-reminders] reminded ${reminded}/${due.length} of ${awaiting.length} awaiting`)
  } catch (e: any) {
    logger.error(`[uncounted-delivery-reminders] batch failed: ${e?.message}`)
  }
}

export const config = {
  name: "uncounted-delivery-reminders",
  // Daily at 09:30, after the overdue reminders.
  schedule: "30 9 * * *",
}
