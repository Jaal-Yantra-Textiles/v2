/**
 * PURE helpers for a partner's proposed inventory-order revision (#1752).
 *
 * The staging model (`inventory_order_change`) holds a partner's DESIRED line
 * set and `tax` charges as a DRAFT. Nothing here touches the ledger — that is
 * the whole point: these functions describe what a proposal MEANS, so the
 * partner stage routes and the admin approve route can agree on the arithmetic
 * without a second copy of it drifting (the defect `runPayableOffer` was
 * extracted to prevent, one entity over).
 */

/** A staged line op, mirroring the admin order-lines update shape. */
export type ProposedLine = {
  id: string
  inventory_item_id?: string
  quantity?: number
  price?: number
  extra_cost?: number | null
  remove?: boolean
}

export type ProposedCharge = {
  type: "tax"
  amount: number
  note?: string | null
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/**
 * The order totals the APPROVED line set implies.
 *
 * 🔴 The partner's own `data.quantity` / `data.total_price` are NOT trusted —
 * they are re-derived here from the final line set, so a partner cannot inflate
 * the goods total by typing a bigger number into a header field. A kept line
 * contributes `(price + extra_cost) × quantity`; a removal marker contributes
 * nothing.
 */
export const computeTotalsFromLines = (
  lines: ProposedLine[] | null | undefined
): { quantity: number; total_price: number } => {
  let quantity = 0
  let total = 0
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line || line.remove) continue
    const qty = num(line.quantity)
    const price = num(line.price)
    const extra = num(line.extra_cost)
    quantity += qty
    total += (price + extra) * qty
  }
  return { quantity: round2(quantity), total_price: round2(total) }
}

/**
 * Which of the requested line ids are NOT on this order.
 *
 * 🔴 The removal/edit markers name a line by id, and the approve step
 * soft-deletes by id without checking ownership — so a partner could stage a
 * marker for ANOTHER order's line. Returning the missing ids lets both the
 * stage route and the approve route refuse rather than reach a stranger's line.
 */
export const missingLineIds = (
  requestedIds: Array<string | null | undefined>,
  orderLineIds: Array<string | null | undefined>
): string[] => {
  const owned = new Set(orderLineIds.filter(Boolean) as string[])
  const missing = new Set<string>()
  for (const id of requestedIds) {
    if (id && !owned.has(id)) missing.add(id)
  }
  return [...missing]
}

/** Is this order in a state a partner may still propose edits against? */
export const ORDER_EDITABLE_STATUSES = new Set(["Pending", "Processing"])

/**
 * The response shape for a change row, so the partner stage routes and the
 * admin approve/reject routes agree on what a proposal looks like.
 */
export const serializeChange = (c: {
  id: string
  status: string
  proposed_lines?: unknown
  proposed_charges?: unknown
  submitted_by?: string | null
  submitted_at?: string | null
  decided_by?: string | null
  decided_at?: string | null
  rejection_reason?: string | null
} | null | undefined) => {
  if (!c) return null
  return {
    id: c.id,
    status: c.status,
    proposed_lines: c.proposed_lines ?? null,
    proposed_charges: c.proposed_charges ?? null,
    submitted_by: c.submitted_by ?? null,
    submitted_at: c.submitted_at ?? null,
    decided_by: c.decided_by ?? null,
    decided_at: c.decided_at ?? null,
    rejection_reason: c.rejection_reason ?? null,
  }
}
/**
 * A proposal must not contradict goods that have already ARRIVED.
 *
 * Staging is locked to `Pending`/`Processing`, but approval is deliberately
 * post-ship and `updateInventoryOrderWorkflow` carries no status lock of its
 * own — `expectedCurrentStatus` is optional and this caller omits it. So a
 * change staged while an order was `Processing` can be approved once it is
 * `Delivered`, and since #2118 that is no longer hypothetical: receipts are
 * recorded as `line_fulfillments` and a real receipt ran on prod the same day.
 *
 * What is NOT a hazard, checked rather than assumed:
 *
 *   RAISING a received line's quantity is fine. Outstanding is
 *   `max(0, ordered − received)` and `planInventoryOrderReceipt` refuses a
 *   claim above it, so 2-received-of-2 raised to 5 opens capacity for 3 NEW
 *   units. It does not make the original 2 receivable again.
 *
 * What is:
 *
 *   - REMOVING a line that has receipts leaves `line_fulfillments` rows and
 *     posted stock pointing at a line that no longer exists — goods on the
 *     shelf that no order line accounts for.
 *   - LOWERING below what was received makes `ordered < received`. Nothing
 *     crashes (`outstandingOn` floors at 0), and that is exactly the problem:
 *     the payable ceiling drops while the goods are physically ours and
 *     already on the books, and no error is raised to say so.
 *
 * Deliberately narrow. Lowering to at-or-above what arrived is a legitimate
 * short-close, and refusing it would block a real workflow to prevent nothing.
 */
export type ReceiptConflict = {
  line_id: string
  received: number
  reason: "removed" | "below_received"
  proposed_quantity?: number
}

export const receiptConflicts = (
  lines: ProposedLine[] | null | undefined,
  /** Cumulative received quantity per order line id, from `line_fulfillments`. */
  receivedByLine: Record<string, number>
): ReceiptConflict[] => {
  const out: ReceiptConflict[] = []
  for (const line of lines ?? []) {
    if (!line?.id) {
      continue
    }
    const received = num(receivedByLine[line.id])
    if (received <= 0) {
      continue
    }
    if (line.remove) {
      out.push({ line_id: line.id, received, reason: "removed" })
      continue
    }
    // An omitted quantity leaves the line as it is, so it cannot contradict a
    // receipt. Only a stated one can.
    if (line.quantity == null) {
      continue
    }
    if (num(line.quantity) < received) {
      out.push({
        line_id: line.id,
        received,
        reason: "below_received",
        proposed_quantity: num(line.quantity),
      })
    }
  }
  return out
}

/** Readable refusal — this is read by an operator deciding whether to approve. */
export const describeReceiptConflicts = (conflicts: ReceiptConflict[]): string =>
  conflicts
    .map((c) =>
      c.reason === "removed"
        ? `line ${c.line_id} has already received ${c.received} and cannot be removed`
        : `line ${c.line_id} has already received ${c.received}, so it cannot be reduced to ${c.proposed_quantity}`
    )
    .join("; ")

/**
 * Would this proposal leave the order with NO lines at all?
 *
 * 🔴 `order_lines.min(1)` counts MARKERS, not survivors. A partner who ticks
 * every row sends three entries and passes it, and approval then soft-deletes
 * all three: an inventory order with no goods on it, a derived `total_price` of
 * 0, and a payable ceiling of 0 — while the partner's screen said only "changes
 * proposed". Nothing in the chain errors, because every individual step is
 * doing exactly what it was asked.
 *
 * Checked against the order's OWN line ids rather than the proposal alone. A
 * proposal is a set of ops, not necessarily the whole order: removing 1 of 3
 * lines is fine and must stay fine, and "every entry in the payload is a
 * removal" would wrongly refuse it. The question is only ever whether anything
 * survives.
 *
 * Removing a line is a legitimate thing for a partner to ask for — a bolt that
 * never arrived, a colour that was cancelled. Emptying the order is not an edit
 * to it; it is a cancellation, and cancellation is a different decision with a
 * different owner.
 */
export const removesEveryLine = (
  lines: ProposedLine[] | null | undefined,
  orderLineIds: Array<string | null | undefined>
): boolean => {
  const owned = (orderLineIds ?? []).filter(Boolean).map((id) => String(id))
  if (owned.length === 0) {
    return false
  }
  const removed = new Set(
    (lines ?? [])
      .filter((l) => l?.remove && l?.id)
      .map((l) => String(l.id))
  )
  return owned.every((id) => removed.has(id))
}
