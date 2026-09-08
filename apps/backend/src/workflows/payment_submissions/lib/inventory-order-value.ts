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
 * ⚠️ That Σ check is only an identity because **every `extra_cost` on that
 * order was null**. The real invariant is Σ((price + extra_cost) × quantity) =
 * `total_price`; the shorter form matched because the sample could not tell the
 * two apart. It read as proof for months while the money was wrong — if you
 * re-verify against a live order, pick one with a colour job on it.
 *
 * 🔴 **`extra_cost` is owed too.** The per-unit colour/dye/finishing charge is
 * part of the agreed unit value, so the unit price here is
 * `price + extra_cost`. Callers must SELECT `orderlines.extra_cost`: this
 * function cannot add a field the query never fetched, which is why the fix
 * for this had to land in three places at once.
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
  /**
   * 🔴 ALSO PER UNIT, and it is part of what the partner is owed.
   *
   * The per-unit colour/dye/finishing charge (`inventory_order_line.extra_cost`).
   * A line's agreed value is `(price + extra_cost) × quantity` — that is how
   * `total_price` is folded at write time, and how the admin create/edit forms
   * and `dual-write-unified-order` price it. Valuing a receipt from `price`
   * alone silently underpays every order that carries a colour job.
   */
  extra_cost?: number | null
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

    // The unit the partner is owed is the AGREED unit: goods + the per-unit
    // colour/finishing charge. `price` alone is only the goods half, and every
    // other pricer in the codebase folds both (`create-inventory-order`,
    // `order-lines-payload`, `dual-write-unified-order:313`). This was the
    // outlier, and both the offer (`list_payable_inventory_orders`) and the
    // bill (`create-payment-submission`) read it — so they agreed with each
    // other and understated together.
    const unitPrice = num(line.price) + num(line.extra_cost)

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
