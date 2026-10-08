import type { AwaitingCountOrder } from "./awaiting-count"

/**
 * #2289 S4 — which receiving partners to remind to count a delivery
 * (founder decision 2026-10-08: 3 days after the carrier marks it delivered).
 *
 * PURE, so the rule is tested without a container:
 *  - Only orders whose destination is a PARTNER's warehouse. Our own warehouse
 *    is the admin's "Awaiting count" list, not a reminder.
 *  - Due 3 days after the carrier said delivered. With no carrier shipment on
 *    the platform (goods sent outside it), 3 days after the supplier's last
 *    dispatch, or the partner would never hear.
 *  - Not twice within the cooldown: a partner reminded recently is skipped.
 */
export type CountReminder = {
  order_id: string
  partner_id: string
  awaiting_quantity: number
  days_waiting: number
  basis: "carrier_delivered" | "dispatched"
}

const MS_PER_DAY = 86_400_000

export function selectCountReminders(
  orders: AwaitingCountOrder[],
  partnerByLocation: Map<string, string>,
  recentlyReminded: Set<string>,
  now: Date,
  afterDays = 3
): CountReminder[] {
  const out: CountReminder[] = []
  for (const o of orders || []) {
    if (!o?.destination_location_id) continue
    const partnerId = partnerByLocation.get(o.destination_location_id)
    if (!partnerId) continue
    if (recentlyReminded.has(o.id)) continue
    const basis = o.carrier_delivered_at ? "carrier_delivered" : "dispatched"
    const since = o.carrier_delivered_at ?? o.last_dispatched_at
    if (!since) continue
    const days = (now.getTime() - new Date(since).getTime()) / MS_PER_DAY
    if (!Number.isFinite(days) || days < afterDays) continue
    out.push({
      order_id: o.id,
      partner_id: partnerId,
      awaiting_quantity: o.awaiting_quantity,
      days_waiting: Math.floor(days),
      basis,
    })
  }
  return out
}
