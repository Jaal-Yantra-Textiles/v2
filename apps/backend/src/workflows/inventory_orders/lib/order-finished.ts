import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * #2324 — is this inventory order FINISHED, judged by what actually happened
 * to it rather than by where the partner workflow got to?
 *
 * The send-to-partner workflow waits on two async steps (`await-order-start`,
 * `await-order-completion`) with a 23-day timeout. Admin receive and the
 * `close-received-inventory-orders` job finish an order through doors that never
 * signalled those steps, so 23 days later the workflow timed out and its
 * compensation dismissed the order↔partner link. Unique Pashmina's portal lost
 * an order they had already been paid ₹14,000 for.
 *
 * The compensation now asks this question first. An order that is finished
 * keeps its partner: un-linking it rewrites history (who made the goods, who
 * was paid) and hides the order from the partner's portal.
 *
 * 🔴 Evidence, not a status name. `Shipped` alone is NOT finished — the parcel
 * may still be on a truck, and a genuinely stalled order should still roll
 * back. What counts:
 *
 *  - `Delivered` — the terminal status; nothing after it re-opens the order.
 *  - Any stock received (`line_fulfillments` with a positive `quantity_delta`)
 *    — goods are on the books, whatever the status says (Shipped, Partial…).
 *  - `metadata.closed_as_received` — the close job verified the stock.
 *  - A paid payout naming this order — the partner has been paid for it.
 */
export type InventoryOrderFinishEvidence = {
  status: string | null | undefined
  metadata?: Record<string, any> | null
  /** Sum of positive received `quantity_delta` across the order's lines. */
  received_quantity: number
  /** Payment submissions (Approved / Paid / paid_at set) naming this order. */
  paid_payout_ids: string[]
}

export type InventoryOrderFinishAssessment = {
  finished: boolean
  /** Why, in operator terms — empty when not finished. */
  reasons: string[]
}

export function assessInventoryOrderFinished(
  evidence: InventoryOrderFinishEvidence
): InventoryOrderFinishAssessment {
  const reasons: string[] = []
  const status = String(evidence.status ?? "")

  if (status === "Delivered") {
    reasons.push("status is Delivered")
  }
  const received = Number(evidence.received_quantity) || 0
  if (received > 0) {
    reasons.push(`stock received on the books (${received}) while ${status || "unknown"}`)
  }
  if (evidence.metadata?.closed_as_received) {
    reasons.push("closed as received (metadata.closed_as_received)")
  }
  const paid = (evidence.paid_payout_ids ?? []).filter(Boolean)
  if (paid.length > 0) {
    reasons.push(`paid payout(s): ${paid.join(", ")}`)
  }

  return { finished: reasons.length > 0, reasons }
}

/**
 * Stricter than `assessInventoryOrderFinished`: did the GOODS finish — is it
 * safe to end the partner's tracking workflow? A paid payout keeps a partner's
 * link (we paid them; the order must not vanish from their portal) but is no
 * evidence the goods arrived: a 100%-advance order is "paid" before it ships.
 * Nor is a partial receipt. Delivered, closed-as-received, or every line fully
 * received.
 */
export function areGoodsFinished(
  evidence: Pick<LoadedFinishEvidence, "status" | "metadata" | "lines">
): boolean {
  if (String(evidence.status ?? "") === "Delivered") return true
  if (evidence.metadata?.closed_as_received) return true
  return isFullyReceived(evidence.lines ?? [])
}

/** Ordered vs received per line: true only when every line is fully received. */
export function isFullyReceived(
  lines: Array<{ quantity: number | string | null | undefined; received: number }>
): boolean {
  const real = lines.filter((l) => (Number(l.quantity) || 0) > 0)
  if (real.length === 0) {
    return false
  }
  // Same tolerance the receipt planner uses for decimal metres.
  return real.every((l) => (Number(l.quantity) || 0) - (l.received || 0) <= 0.01)
}

export type LoadedFinishEvidence = InventoryOrderFinishEvidence & {
  id: string
  lines: Array<{ id: string; quantity: number; received: number }>
}

const receivedOn = (fulfillments: any[]): number =>
  (fulfillments ?? []).reduce((sum, f) => {
    if (!f) return sum
    if (f.event_type && f.event_type !== "received") return sum
    const q = Number(f.quantity_delta) || 0
    return q > 0 ? sum + q : sum
  }, 0)

/**
 * Read the evidence for one order. Returns null when the order does not exist.
 * Pure reads — safe to call from a compensation.
 */
export async function loadInventoryOrderFinishEvidence(
  container: any,
  orderId: string
): Promise<LoadedFinishEvidence | null> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const { data: orders } = await query.graph({
    entity: "inventory_orders",
    fields: [
      "id",
      "status",
      "metadata",
      "orderlines.id",
      "orderlines.quantity",
      "orderlines.line_fulfillments.quantity_delta",
      "orderlines.line_fulfillments.event_type",
    ],
    filters: { id: orderId },
  })
  const order = orders?.[0]
  if (!order) {
    return null
  }

  const lines = ((order.orderlines ?? []) as any[]).filter(Boolean).map((ol) => ({
    id: String(ol.id),
    quantity: Number(ol.quantity) || 0,
    received: receivedOn(ol.line_fulfillments ?? []),
  }))

  const paidResult = await pg.raw(
    `select distinct s.id
       from payment_submission_item i
       join payment_submission s on s.id = i.submission_id
      where i.inventory_order_id = ?
        and i.deleted_at is null
        and s.deleted_at is null
        and (s.status in ('Approved', 'Paid') or s.paid_at is not null)`,
    [orderId]
  )
  const paidRows = paidResult?.rows ?? []

  return {
    id: String(order.id),
    status: order.status ?? null,
    metadata: order.metadata ?? null,
    lines,
    received_quantity: lines.reduce((s, l) => s + l.received, 0),
    paid_payout_ids: paidRows.map((r: any) => String(r.id)),
  }
}
