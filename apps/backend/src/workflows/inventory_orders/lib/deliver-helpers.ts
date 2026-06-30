import { MedusaError } from "@medusajs/framework/utils"
import {
  aggregateDeliveredByLine,
  type DeliveredLine,
  type OrderLineForReversal,
} from "./cancel-helpers"

/**
 * #778 C2 (admin half) + state-machine enforcement on the admin update path.
 *
 * The generic admin PUT (`update-inventory-orders` workflow) historically only
 * checked the *current* status (must be Pending/Processing) and never the
 * *target* — so an admin could write `status: "Delivered"` straight onto the
 * column, jumping past the stock-posting that the partner-complete path does.
 * These pure helpers make the transition rules explicit + unit-testable and
 * compute the stock to post when an admin actually delivers an order.
 */

/** An order line shaped for delivery stock posting (mirrors the reversal shape). */
export type OrderLineForDelivery = OrderLineForReversal & {
  /** Ordered quantity for the line (what a full delivery posts, minus prior deliveries). */
  quantity: number
}

/** A computed (item, location, qty) level to post on delivery. */
export type DeliveryLevelInput = {
  location_id: string
  inventory_item_id: string
  stocked_quantity: number
}

/** Outcome of evaluating a requested admin status transition. */
export type AdminTransitionDecision = {
  /** True when the transition is into "Delivered" and stock must be posted. */
  postStock: boolean
}

const FIELD_EDIT_STATUSES = new Set(["Pending", "Processing"])

/**
 * Enforce the admin-editor status rule and decide whether the update must post
 * stock. Pure (no container) so it can be unit-tested directly.
 *
 * The generic admin PUT only mutates orders that are still Pending or Processing
 * — the long-standing lock (orders with prior deliveries are Partial/Shipped/
 * Delivered and must go through their dedicated flows: partner-complete, the
 * cancel workflow #778 C4, the shipment flow). That lock already prevents the
 * dangerous "cancel/edit an order that posted stock" cases, so it is preserved
 * verbatim (including its error message, which other flows assert on).
 *
 * The one correctness fix (#778 M / C2 admin-half): a transition *to Delivered*
 * must POST stock (mirroring the partner-complete posting) rather than silently
 * writing the status column and bypassing inventory movement. Throws
 * `INVALID_DATA` when the order is no longer editable.
 */
export const evaluateAdminStatusTransition = (
  current: string | null | undefined,
  target: string | null | undefined
): AdminTransitionDecision => {
  if (!FIELD_EDIT_STATUSES.has(String(current ?? ""))) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order can only be updated if status is 'Pending' or 'Processing'."
    )
  }
  const isChange = target !== undefined && target !== null && target !== current
  return { postStock: isChange && target === "Delivered" }
}

/**
 * Compute the stock to post when an admin delivers an order, plus the
 * delivered-line records to append to `metadata.partner_delivered_lines`.
 *
 * Posts only the *remaining* quantity per line (ordered − already delivered, so
 * delivering a Partial order never double-posts what the partner already
 * posted), resolved to the same (item, location) the partner-complete path uses:
 * the line's first linked inventory item at the order's destination location, or
 * the item's own first linked location as a fallback. Lines with nothing
 * remaining, or no resolvable item/location, are skipped for posting (but a
 * resolvable remainder is still recorded so a later cancel reverses it).
 */
export const computeAdminDeliveryPosting = (
  orderlines: OrderLineForDelivery[] | undefined | null,
  alreadyDelivered: DeliveredLine[] | undefined | null,
  destLocationId: string | null | undefined
): { levels: DeliveryLevelInput[]; deliveredRecords: DeliveredLine[] } => {
  const deliveredByLine = aggregateDeliveredByLine(alreadyDelivered)
  const levels: DeliveryLevelInput[] = []
  const deliveredRecords: DeliveredLine[] = []

  for (const ol of (orderlines || []).filter(Boolean)) {
    const ordered = Number(ol.quantity) || 0
    const already = deliveredByLine[ol.id] || 0
    const remaining = ordered - already
    if (remaining <= 0) continue

    deliveredRecords.push({ order_line_id: ol.id, quantity: remaining })

    const firstItem = ol.inventory_items?.[0]
    const itemId = firstItem?.id || ol.inventory_item_id
    const locId = destLocationId || firstItem?.stock_locations?.[0]?.id
    if (itemId && locId) {
      levels.push({
        location_id: String(locId),
        inventory_item_id: String(itemId),
        stocked_quantity: remaining,
      })
    }
  }

  return { levels, deliveredRecords }
}
