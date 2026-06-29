import { MedusaError } from "@medusajs/framework/utils"

/**
 * Pure helpers for cancelling an inventory order and reversing any stock that
 * prior (partial or full) deliveries posted (#778 C2/C4). Kept free of the
 * container so the stock-reversal arithmetic — the risky part — is unit
 * testable in isolation.
 */

export type DeliveredLine = { order_line_id: string; quantity: number }

export type OrderLineForReversal = {
  id: string
  inventory_items?: Array<{ id?: string; stock_locations?: Array<{ id?: string }> }>
  inventory_item_id?: string
}

export type ReversalLevel = {
  location_id: string
  inventory_item_id: string
  quantity: number
}

export type ExistingLevel = {
  id: string
  location_id: string
  inventory_item_id: string
  stocked_quantity: number
}

export type LevelUpdate = {
  id: string
  inventory_item_id: string
  location_id: string
  stocked_quantity: number
}

/** Terminal statuses that cannot be cancelled again. */
const NON_CANCELLABLE = new Set(["Cancelled"])

/**
 * Guard the cancel transition. An order that's already Cancelled is a no-op
 * error (NOT_ALLOWED) rather than a silent re-cancel; everything else
 * (Pending → Partial → Delivered) may be cancelled, reversing whatever stock
 * it posted.
 */
export const assertCancellable = (status: string | null | undefined): void => {
  if (!status || NON_CANCELLABLE.has(status)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Inventory order cannot be cancelled from status "${status ?? "unknown"}"`
    )
  }
}

/** Sum delivered quantities per order line (cumulative across partial deliveries). */
export const aggregateDeliveredByLine = (
  deliveredLines: DeliveredLine[] | undefined | null
): Record<string, number> => {
  const byLine: Record<string, number> = {}
  for (const l of deliveredLines || []) {
    if (l?.order_line_id && typeof l.quantity === "number" && l.quantity > 0) {
      byLine[l.order_line_id] = (byLine[l.order_line_id] || 0) + l.quantity
    }
  }
  return byLine
}

/**
 * Resolve which (item, location, qty) levels a cancel must reverse, mirroring
 * exactly how `partner-complete` posted them: per delivered order line, the
 * line's first linked inventory item at the order's destination location (or
 * the item's own first linked location as a fallback). Lines with no delivered
 * quantity, no resolvable item, or no resolvable location are skipped.
 */
export const buildReversalLevels = (
  orderlines: OrderLineForReversal[] | undefined | null,
  deliveredLines: DeliveredLine[] | undefined | null,
  destLocationId: string | null | undefined
): ReversalLevel[] => {
  const deliveredByLine = aggregateDeliveredByLine(deliveredLines)
  const levels: ReversalLevel[] = []
  for (const ol of (orderlines || []).filter(Boolean)) {
    const qty = deliveredByLine[ol.id]
    if (!qty) continue
    const firstItem = ol.inventory_items?.[0]
    const itemId = firstItem?.id || ol.inventory_item_id
    const locId = destLocationId || firstItem?.stock_locations?.[0]?.id
    if (itemId && locId) {
      levels.push({
        location_id: String(locId),
        inventory_item_id: String(itemId),
        quantity: Number(qty),
      })
    }
  }
  return levels
}

/**
 * Compute the inventory-level updates that reverse the posted stock: subtract
 * the reversal quantity from each matching existing level, floored at 0 (never
 * drive stock negative). Reversal levels with no matching existing level are
 * skipped — there's nothing posted to take back. Quantities for the same
 * (item, location) pair are summed first so duplicate lines reverse correctly.
 */
export const computeStockReversalUpdates = (
  reversalLevels: ReversalLevel[],
  existingLevels: ExistingLevel[]
): LevelUpdate[] => {
  const key = (item: string, loc: string) => `${item}::${loc}`
  const reverseByKey: Record<string, number> = {}
  for (const r of reversalLevels) {
    reverseByKey[key(r.inventory_item_id, r.location_id)] =
      (reverseByKey[key(r.inventory_item_id, r.location_id)] || 0) + Number(r.quantity || 0)
  }
  const updates: LevelUpdate[] = []
  for (const ex of existingLevels) {
    const take = reverseByKey[key(ex.inventory_item_id, ex.location_id)]
    if (!take) continue
    updates.push({
      id: String(ex.id),
      inventory_item_id: String(ex.inventory_item_id),
      location_id: String(ex.location_id),
      stocked_quantity: Math.max(0, Number(ex.stocked_quantity || 0) - take),
    })
  }
  return updates
}

/** Task statuses that are still open and should be cancelled along with the order. */
const OPEN_TASK_STATUSES = new Set(["pending", "in_progress", "assigned", "accepted"])

/** Pick the ids of still-open tasks to cancel (leaves completed/cancelled alone). */
export const selectOpenTaskIds = (
  tasks: Array<{ id?: string; status?: string } | null | undefined> | undefined | null
): string[] =>
  (tasks || [])
    .filter((t): t is { id: string; status?: string } => Boolean(t?.id))
    .filter((t) => OPEN_TASK_STATUSES.has(String(t.status)))
    .map((t) => t.id)
