/**
 * Receiving goods that have already arrived — the pure planning rule (#2115).
 *
 * The gap this closes, stated plainly: a carrier can say "delivered to the
 * consignee, OTP verified, GPS at the door" and our books still read zero, with
 * nothing anywhere having failed.
 *
 * Two different triggers write those two facts, and only one of them fires:
 *
 *   - `Delivered` comes from the SHIPROCKET WEBHOOK. It is a carrier event. It
 *     proves a parcel reached a door. It does not mean anyone counted what was
 *     in it, and it moves no stock.
 *   - Stock posting lives in `partner-complete-inventory-order`, keyed off
 *     `metadata.partner_delivered_lines`. No delivered lines, nothing written —
 *     and that workflow completes successfully either way.
 *
 * 🔴 And the receipt door is closed by the very status the carrier sets:
 * `partner-complete-inventory-order` refuses anything but `Processing`/`Partial`.
 * So an order the carrier marked `Delivered` could never be received at all. The
 * 2 Mill Spun Pashminas at Kiyo Designs — ₹14,000, physically in her hands since
 * 2026-09-17 — sat at `stocked_quantity: 0` for exactly this reason.
 *
 * This module is the ADMIN receipt: someone at our end asserting what actually
 * turned up. It is pure so the rule can be tested without a container, and it
 * is deliberately the same arithmetic the partner path uses — cumulative
 * against `line_fulfillments`, refusing over-receipt — so the two doors cannot
 * drift into double-posting the same goods.
 */

/** Line-level record of what has already been received against an order line. */
export type ReceiptOrderLine = {
  id: string
  /** What was ordered on this line. */
  quantity: number | string | null
  /** Cumulative quantity already received, as `line_fulfillments` records it. */
  received: number
  /** The inventory item this line resolves to, or null when it names none. */
  inventory_item_id: string | null
  /** Locations linked to the item itself — the last-resort destination. */
  item_location_ids?: string[]
}

export type PlanReceiptInput = {
  order_id: string
  status: string | null | undefined
  /** `to_stock_location_id`, from the order↔stock-location link. */
  destination_location_id?: string | null
  /** Operator override; wins over the order's own destination. */
  location_id?: string | null
  lines: ReceiptOrderLine[]
  /**
   * What the operator says arrived. Omit entirely to receive EVERYTHING still
   * outstanding — the common case for an order the carrier already delivered
   * in full, and the one that stops a receipt being a typing exercise.
   */
  requested?: Array<{ order_line_id: string; quantity: number }> | null
}

export type PlannedReceiptLine = {
  order_line_id: string
  quantity: number
  inventory_item_id: string
  location_id: string
}

export type PlanReceiptResult =
  | { ok: true; lines: PlannedReceiptLine[]; destination_location_id: string }
  | { ok: false; error: string }

/**
 * Statuses a receipt may be recorded from.
 *
 * Goods can only be received once they have left the supplier, so `Pending`
 * is out — nothing has shipped. `Delivered` is IN, and is the whole point:
 * it is the status the carrier sets, and the one the old door refused.
 * `Processing` stays in because a partner may hand goods over before any
 * shipment exists at all.
 */
export const RECEIVABLE_STATUSES = new Set([
  "Processing",
  "Ready for Delivery",
  "Shipped",
  "Partial",
  "Delivered",
])

/**
 * Matches the partner path exactly. Fabric is measured in decimal metres and
 * an operator typing 4.5 against a 4.5 line must not trip an over-receipt.
 */
const OVER_RECEIPT_TOLERANCE = 0.01

const round = (n: number): number => Number(n.toFixed(6))

/** What is still outstanding on a line — ordered minus already received. */
export const outstandingOn = (line: ReceiptOrderLine): number =>
  round(Math.max(0, (Number(line.quantity ?? 0) || 0) - (line.received || 0)))

export function planInventoryOrderReceipt(
  input: PlanReceiptInput
): PlanReceiptResult {
  const status = String(input.status ?? "")
  if (!RECEIVABLE_STATUSES.has(status)) {
    return {
      ok: false,
      error: `Inventory order ${input.order_id} cannot be received from status '${
        status || "unknown"
      }' — goods have to have left the supplier first (receivable from: ${Array.from(
        RECEIVABLE_STATUSES
      ).join(", ")})`,
    }
  }

  const byId = new Map(input.lines.map((l) => [String(l.id), l]))

  // No explicit payload means "everything still outstanding". A line already
  // fully received contributes 0 and drops out below, which is what makes a
  // second call a no-op rather than a double-posting.
  const requested = input.requested?.length
    ? input.requested
    : input.lines.map((l) => ({
        order_line_id: String(l.id),
        quantity: outstandingOn(l),
      }))

  const planned: PlannedReceiptLine[] = []
  const overReceipts: string[] = []

  for (const r of requested) {
    const line = byId.get(String(r?.order_line_id ?? ""))
    if (!line) {
      return {
        ok: false,
        error: `Order line ${r?.order_line_id} does not belong to order ${input.order_id}`,
      }
    }
    const qty = Number(r?.quantity ?? 0)
    if (!Number.isFinite(qty) || qty < 0) {
      return {
        ok: false,
        error: `Invalid quantity ${r?.quantity} for order line ${line.id}`,
      }
    }
    if (qty === 0) {
      continue
    }

    const remaining = outstandingOn(line)
    if (qty > remaining + OVER_RECEIPT_TOLERANCE) {
      overReceipts.push(
        `line ${line.id}: ${remaining} outstanding but ${qty} claimed`
      )
      continue
    }

    // A line naming no inventory item has nothing to stock. It is not an error
    // — an order can carry a line for something untracked — but it must be said
    // out loud rather than silently dropped, so it is reported as a refusal
    // only when the operator asked for that line by name.
    if (!line.inventory_item_id) {
      if (input.requested?.length) {
        return {
          ok: false,
          error: `Order line ${line.id} names no inventory item, so there is nothing to stock against it`,
        }
      }
      continue
    }

    // 🔴 Destination resolution, in order. The order's own `to_stock_location`
    // is the answer for a consignment order — for the Kiyo pashminas it IS the
    // partner's location, which is exactly the point: the stocking side already
    // intends to post our material at a partner's bench.
    const locationId =
      input.location_id ||
      input.destination_location_id ||
      line.item_location_ids?.[0]
    if (!locationId) {
      return {
        ok: false,
        error: `No destination stock location could be resolved for order ${input.order_id} — pass location_id explicitly`,
      }
    }

    planned.push({
      order_line_id: String(line.id),
      quantity: round(qty),
      inventory_item_id: String(line.inventory_item_id),
      location_id: String(locationId),
    })
  }

  if (overReceipts.length) {
    return {
      ok: false,
      error: `Over-receipt on ${overReceipts.length} line(s): ${overReceipts.join(
        "; "
      )}`,
    }
  }

  if (!planned.length) {
    return {
      ok: false,
      error: `Nothing outstanding to receive on inventory order ${input.order_id} — every line is already fully received`,
    }
  }

  return {
    ok: true,
    lines: planned,
    destination_location_id: planned[0].location_id,
  }
}

/**
 * Collapse planned lines into one posting per `item@location`.
 *
 * Two lines of the same material (the batch-number case: one group ordered as
 * N separately-priced lines) must add up into ONE level change, not overwrite
 * each other. The level write is absolute, so two postings against one level
 * would silently keep only the last.
 */
export function postingsFromPlannedLines(
  lines: PlannedReceiptLine[]
): Array<{ inventory_item_id: string; location_id: string; quantity: number }> {
  const byKey = new Map<
    string,
    { inventory_item_id: string; location_id: string; quantity: number }
  >()
  for (const l of lines) {
    const key = `${l.inventory_item_id}@${l.location_id}`
    const existing = byKey.get(key)
    if (existing) {
      existing.quantity = round(existing.quantity + l.quantity)
    } else {
      byKey.set(key, {
        inventory_item_id: l.inventory_item_id,
        location_id: l.location_id,
        quantity: l.quantity,
      })
    }
  }
  return Array.from(byKey.values())
}
