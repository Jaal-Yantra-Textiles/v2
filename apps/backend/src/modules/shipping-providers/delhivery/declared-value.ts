/**
 * The declared value (`total_amount`) to send Delhivery for a shipment.
 *
 * We never sent one, so every manifest was created with a value of 0 — visible
 * on the Delhivery dashboard as a ₹0 order (found on the first real prepaid
 * shipment, order #83). That is not cosmetic: the declared value is what a
 * damage/loss claim pays out against, and it is what appears on the shipping
 * label and in reconciliation.
 *
 * Deliberately computed from the FULFILLMENT's items rather than the order
 * total: a partial fulfillment must declare only what is actually in this box.
 * `cod_amount` stays a separate concern — for a prepaid shipment it is 0 while
 * the declared value is the goods' worth, and conflating the two is what makes
 * a prepaid order look free.
 *
 * Kept dependency-free so it can be unit-tested without the fulfillment module.
 */

/** Medusa money fields can arrive as numbers, numeric strings, or BigNumber-ish objects. */
function toAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  if (value && typeof value === "object") {
    const raw = (value as any).value ?? (value as any).numeric
    if (raw !== undefined) return toAmount(raw)
  }
  return 0
}

export type DeclaredValueInput = {
  /** The fulfillment's items (line_item_id + quantity). */
  items: Array<{ line_item_id?: string; quantity?: number }>
  /** Order line items keyed by id, carrying unit_price / totals. */
  orderItemById: Map<string, any>
  /** The order, used only as a last-resort fallback. */
  order?: { total?: unknown; item_total?: unknown } | null
}

/**
 * Value of the goods in this shipment, in major currency units.
 *
 * Falls back to the order total only when no line price can be resolved at all —
 * an over-declaration on a partial shipment is still far better than declaring
 * nothing, because 0 is the one value that is certainly wrong.
 */
export function declaredValueForShipment({
  items,
  orderItemById,
  order,
}: DeclaredValueInput): number {
  let total = 0
  let resolvedAny = false

  for (const item of items || []) {
    const qty = Number(item?.quantity) || 1
    const orderItem = item?.line_item_id ? orderItemById.get(item.line_item_id) : undefined
    if (!orderItem) continue

    // Prefer the line's own total (it already accounts for quantity and
    // discounts); fall back to unit price × the quantity actually shipped.
    const lineTotal = toAmount(orderItem.total ?? orderItem.subtotal)
    if (lineTotal > 0) {
      const orderedQty = Number(orderItem.quantity) || qty
      // A partial shipment carries its share of the line total.
      total += orderedQty > 0 ? (lineTotal / orderedQty) * qty : lineTotal
      resolvedAny = true
      continue
    }

    const unitPrice = toAmount(orderItem.unit_price)
    if (unitPrice > 0) {
      total += unitPrice * qty
      resolvedAny = true
    }
  }

  if (!resolvedAny) {
    const fallback = toAmount(order?.item_total) || toAmount(order?.total)
    if (fallback > 0) return Math.round(fallback * 100) / 100
  }

  return Math.round(total * 100) / 100
}
