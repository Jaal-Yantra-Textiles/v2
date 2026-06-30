import { MedusaError } from "@medusajs/framework/utils"

/**
 * Pure helpers for creating an inventory order together with its lines (#778 C3).
 *
 * Kept free of any container / service dependency so they're unit-testable, and
 * shared between the module service (`createInvWithLines`) and the create
 * workflow's linking step.
 */

export type CreateOrderLineInput = {
  inventory_id: string
  quantity: number
  price: number
  metadata?: Record<string, unknown>
}

export type OrderLinePayload = {
  quantity: number
  price: number
  metadata: Record<string, unknown> | null
  inventory_orders: string
}

/** The line ↔ inventory-item pairing used to create the module links. */
export type LineItemPair = {
  order_line_id: string
  inventory_item_id: string
}

/**
 * Sum the per-unit line prices into an order total (#778 H9).
 *
 * `price` is the PER-UNIT price (matches the admin UI, validators, and registry
 * cost reads), so each line contributes `price × quantity`. Used as the fallback
 * order total when a caller (e.g. a visual flow) omits `total_price`.
 */
export const sumLineTotals = (
  order_lines: Pick<CreateOrderLineInput, "price" | "quantity">[]
): number =>
  order_lines.reduce(
    (sum, l) => sum + (Number(l.price) || 0) * (Number(l.quantity) || 0),
    0
  )

/** Build the persistence payloads for the order lines of one inventory order. */
export const buildOrderLinePayloads = (
  order_lines: CreateOrderLineInput[],
  orderId: string
): OrderLinePayload[] =>
  order_lines.map((line) => ({
    quantity: line.quantity,
    price: line.price,
    metadata: line.metadata ?? null,
    inventory_orders: orderId,
  }))

/**
 * Pair each created order line to the inventory item it was created from, by
 * position. Safe only because the order and its lines are now created
 * atomically in one transaction (#778 C3) — the created lines come back 1:1 and
 * in input order, so position `i` always corresponds to `order_lines[i]`.
 *
 * The OrderLine model has no column for the inventory item id (the relationship
 * lives entirely in the module link), so the pairing is computed here, at
 * creation time, while the correspondence is still known — rather than being
 * re-derived downstream by zipping two independently-built arrays by index
 * (the original bug: a dropped line shifted every later pairing onto the wrong
 * item). Guards the length invariant and throws rather than silently
 * mis-pairing if the counts ever diverge.
 */
export const buildInventoryLineLinkPairs = (
  createdLines: { id: string }[],
  order_lines: CreateOrderLineInput[]
): LineItemPair[] => {
  if (createdLines.length !== order_lines.length) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Inventory order line count mismatch: created ${createdLines.length} lines for ${order_lines.length} inputs`
    )
  }
  return createdLines.map((line, i) => ({
    order_line_id: line.id,
    inventory_item_id: order_lines[i].inventory_id,
  }))
}
