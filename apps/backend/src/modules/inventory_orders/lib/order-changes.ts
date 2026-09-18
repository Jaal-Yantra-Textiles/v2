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