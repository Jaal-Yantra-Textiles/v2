/**
 * What a partner is owed for an inventory order, derived from what they
 * actually delivered (#1612).
 *
 * ## Why this is derived rather than typed in
 *
 * `inventory_orders.total_price` is what was ORDERED. On a `Partial` order that
 * is not what is owed: `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` was ordered at
 * ₹88,885 and has ₹28,670 of goods actually received. Billing `total_price`
 * would overpay by ₹60,215; asking an operator to type the right number invites
 * the arithmetic below to be done by hand, per order, every time.
 *
 * ## Two traps this exists to avoid
 *
 * 🔴 **`price` is PER UNIT, not a line total.** Verified on the order above:
 * Σ(quantity × price) over its ten lines = 88,885 = `total_price`, and Σquantity
 * = 244.5 = `quantity`. A reader that treats `price` as the line's value
 * underpays by orders of magnitude. Cf. the `quantity`-is-a-rate-or-a-total
 * confusion that made a report tell operators to corrupt correct data (#1559).
 *
 * 🔴 **Receipts come from the typed `line_fulfillments` rows, NEVER from
 * `metadata.partner_delivery_history`.** `partner-complete-inventory-order`
 * dual-writes both, and on the one order examined by hand they DISAGREE: the
 * typed rows total 69.5 units where the blob has 59.3, a ₹4,050 understatement,
 * including a whole 10-unit receipt the blob never recorded. The typed rows are
 * what the workflow's own concurrency guard reads to compute `remaining`, so
 * they are the operative record. See #1613, which tracks reconciling the two.
 *
 * ⚠️ `quantity_delta` is a DELTA and the event types include `adjust` and
 * `correction`, so a line's received quantity is the SUM of its deltas — not
 * the latest one, and not the count of rows. A negative delta legitimately
 * reduces what is owed.
 */

export type FulfillmentEvent = {
  quantity_delta?: number | null
}

export type InventoryOrderLineForValue = {
  id: string
  /** Ordered quantity. Present for the shortfall report, not for the money. */
  quantity?: number | null
  /** 🔴 PER UNIT. */
  price?: number | null
  material_name?: string | null
  line_fulfillments?: FulfillmentEvent[] | null
}

export type ValuedLine = {
  line_id: string
  material_name: string | null
  received: number
  ordered: number
  unit_price: number
  amount: number
}

export type InventoryOrderValue = {
  lines: ValuedLine[]
  /** Total owed — the sum of `amount` over lines with a non-zero receipt. */
  total: number
  /** Units received across the order, for the human-readable breakdown. */
  received_quantity: number
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * PURE: value an inventory order by its receipts.
 *
 * Lines with no receipt are dropped rather than billed at zero — a line nobody
 * delivered against is not a zero-value line, it is not part of this payout at
 * all, and keeping it would pad the breakdown a partner reads with rows that
 * say nothing.
 */
export function valueInventoryOrderByReceipts(
  lines: InventoryOrderLineForValue[]
): InventoryOrderValue {
  const valued: ValuedLine[] = []

  for (const line of lines || []) {
    const received = (line.line_fulfillments || []).reduce(
      (sum, event) => sum + num(event?.quantity_delta),
      0
    )

    if (received === 0) continue

    const unitPrice = num(line.price)

    valued.push({
      line_id: String(line.id),
      material_name: line.material_name ?? null,
      received,
      ordered: num(line.quantity),
      unit_price: unitPrice,
      // Rounded to paise so a float delta (10.4 + 10.5) cannot leave a
      // fraction-of-a-paisa tail on the money.
      amount: Math.round(received * unitPrice * 100) / 100,
    })
  }

  const total =
    Math.round(valued.reduce((sum, line) => sum + line.amount, 0) * 100) / 100

  return {
    lines: valued,
    total,
    received_quantity:
      Math.round(valued.reduce((sum, line) => sum + line.received, 0) * 100) /
      100,
  }
}

/** A breakdown a partner can check against their own delivery notes. */
export function describeInventoryOrderValue(value: InventoryOrderValue): string {
  return value.lines
    .map(
      (line) =>
        `${line.material_name ?? line.line_id}: ${line.received} x ${line.unit_price} = ${line.amount}`
    )
    .join("; ")
}
