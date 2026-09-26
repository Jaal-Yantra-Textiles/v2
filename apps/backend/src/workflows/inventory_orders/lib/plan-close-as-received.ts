/**
 * Whether an inventory order may be CLOSED as received — status → Delivered
 * with NO stock posted and NO partner message.
 *
 * ## Why this exists
 *
 * Orders the partner completed before receipts were typed sit at `Shipped`
 * forever. Their goods are already on the books — posted by the partner's
 * Complete (typed `line_fulfillments`), or by the older code and by hand before
 * those rows existed — so the two usual doors are both wrong:
 *
 *  - admin **Deliver** (`PUT /admin/inventory-orders/:id`) posts `ordered −
 *    already` from the metadata blob, which understates, so it posts the same
 *    goods a SECOND time (`audit-inventory-receipt-drift` measures it);
 *  - **receive** posts stock and never moves the status at all.
 *
 * Meanwhile the overdue-reminder job nudges them every few days
 * (`inv_order_01K3BAM50HG32BN5C4TF76G5K5`: 24 reminders, "357 days overdue",
 * for goods delivered in September 2025).
 *
 * ## The rule
 *
 * Only from `Shipped` or `Partial` — the partner has said it left. Then ONE of:
 *
 *  - **covered**: every line's typed receipts reach its ordered quantity,
 *    within {@link RECEIPT_ROUNDING_TOLERANCE} (receipts written before
 *    2026-06-12 were rounded to an integer: 45.2 ordered, 45 stored); or
 *  - **confirmed**: an operator states the stock is on the books by other means
 *    (the level was posted before typed receipts existed, or set by hand).
 *    That is a human's claim, so it is recorded with the order as such.
 *
 * 🔴 An order carrying `metadata.reversal_note` is ALWAYS refused. Receipts on
 * it were reversed by hand and which rows are corrected re-entries is not
 * decidable from the record (same rule as `audit-inventory-receipt-drift`).
 */

export const RECEIPT_ROUNDING_TOLERANCE = 0.5

export const CLOSABLE_STATUSES = ["Shipped", "Partial"] as const

export type CloseAsReceivedLine = {
  id: string
  quantity: number | string | null | undefined
  received: number
}

export type CloseAsReceivedInput = {
  order_id: string
  status: string | null | undefined
  metadata: Record<string, any> | null | undefined
  lines: CloseAsReceivedLine[]
  /** The operator named this order as confirmed on the books. */
  confirmed_on_books: boolean
}

export type CloseAsReceivedPlan =
  | {
      ok: true
      mode: "covered" | "confirmed"
      /** Lines whose typed receipts fall short — non-empty only for `confirmed`. */
      short_lines: Array<{ line_id: string; ordered: number; received: number }>
    }
  | { ok: false; reason: string }

export const planCloseAsReceived = (
  input: CloseAsReceivedInput
): CloseAsReceivedPlan => {
  const status = input.status ?? ""
  if (!(CLOSABLE_STATUSES as readonly string[]).includes(status)) {
    return {
      ok: false,
      reason: `status is '${status || "unknown"}' — only ${CLOSABLE_STATUSES.join(
        " / "
      )} can be closed as received`,
    }
  }

  const reversal = input.metadata?.reversal_note
  if (reversal) {
    return {
      ok: false,
      reason: `receipts were reversed by hand ("${String(reversal)}") — which rows stand is not decidable from the record; needs a human`,
    }
  }

  const lines = input.lines.filter((l) => Number(l.quantity) > 0)
  if (!lines.length) {
    return { ok: false, reason: "order has no lines with a quantity — nothing was received" }
  }

  const short_lines = lines
    .map((l) => ({
      line_id: l.id,
      ordered: Number(l.quantity),
      received: Number(l.received) || 0,
    }))
    .filter((l) => l.received < l.ordered - RECEIPT_ROUNDING_TOLERANCE)

  if (!short_lines.length) {
    return { ok: true, mode: "covered", short_lines: [] }
  }

  if (input.confirmed_on_books) {
    return { ok: true, mode: "confirmed", short_lines }
  }

  return {
    ok: false,
    reason:
      `typed receipts fall short on ${short_lines.length} line(s) (` +
      short_lines
        .map((l) => `${l.line_id}: ${l.received} of ${l.ordered}`)
        .join(", ") +
      `) — name the order in confirmed_on_books only once its stock is verified on the books`,
  }
}
