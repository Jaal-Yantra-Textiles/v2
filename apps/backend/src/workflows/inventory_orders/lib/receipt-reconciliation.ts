/**
 * Reconcile the TWO records of what a partner delivered against an inventory
 * order (#1613).
 *
 * `partner-complete-inventory-order` writes the same fact twice:
 *
 *  1. **Typed** — `line_fulfillments` rows (`quantity_delta`), linked to the
 *     order line. These GOVERN: the workflow's own over-delivery guard computes
 *     `remaining = requested − Σ quantity_delta` from them and refuses a
 *     delivery that would exceed it.
 *  2. **Metadata** — two keys on the order, with DIFFERENT write semantics:
 *     - `partner_delivered_lines` is **overwritten** on every partner
 *       submission (`:326`), so it holds only the most recent one;
 *     - `partner_delivery_history` is **appended** (`:327`).
 *     …and the ADMIN deliver path appends to `partner_delivered_lines`
 *     (`update-inventory-orders.ts:398`) rather than overwriting it. One key,
 *     two writers, two meanings.
 *
 * On `inv_order_01K36TE2WB5BQR1MS6KESXP7Q3` the two disagree by **₹4,050**: the
 * typed rows total 69.5 units against the blob's 59.3, including a whole
 * 10-unit receipt (₹4,000) the blob never recorded.
 *
 * 🔴 **This is not only a reporting problem.** Two live readers compute stock
 * movements from the overwritten key:
 *
 *  - `computeAdminDeliveryPosting` posts `ordered − already`, where `already`
 *    comes from `partner_delivered_lines`. Where the blob understates, an admin
 *    pressing Deliver posts stock that was already received — phantom
 *    inventory, in the warehouse's real numbers.
 *  - `cancel-inventory-order` reverses stock from the same key, so a cancel
 *    un-posts the wrong quantity in whichever direction the blob is wrong.
 *
 * ⚠️ And why the obvious fix is not simply "read the typed rows everywhere":
 * the two sources disagree in BOTH directions. Where the typed side is the one
 * missing an entry, switching a reader to it makes `already` smaller and the
 * over-posting WORSE. That is why this file only measures, and why the job
 * built on it writes nothing.
 */

export type DeliveredLineRecord = {
  order_line_id?: string | null
  quantity?: number | string | null
}

export type DeliveryHistoryEntry = {
  lines?: DeliveredLineRecord[] | null
  submitted_at?: string | null
}

export type FulfillmentRow = {
  quantity_delta?: number | string | null
}

export type OrderLineForReconciliation = {
  id: string
  /** Ordered quantity. */
  quantity?: number | string | null
  /** 🔴 PER UNIT, never a line total. */
  price?: number | string | null
  material_name?: string | null
  line_fulfillments?: FulfillmentRow[] | null
}

export type LineReconciliation = {
  line_id: string
  material_name: string | null
  ordered: number
  /** Σ of the typed `quantity_delta` rows — the operative record. */
  typed: number
  /** Aggregate of `metadata.partner_delivered_lines` (the overwritten key). */
  blob: number
  /** Aggregate of every entry in `metadata.partner_delivery_history`. */
  history: number
  unit_price: number
  /** typed − blob, in units. Positive ⇒ the blob understates. */
  drift: number
  /** The drift priced at the line's per-unit price. */
  drift_value: number
  /**
   * What an admin "Deliver" would post today (`ordered − blob`) minus what it
   * should post (`ordered − typed`). Positive ⇒ that much phantom stock.
   */
  admin_would_overpost: number
}

export type OrderReconciliation = {
  lines: LineReconciliation[]
  typed_total_units: number
  blob_total_units: number
  /** Σ drift_value. Positive ⇒ the blob understates what was received. */
  drift_value: number
  /** True when any line disagrees at all. */
  disagrees: boolean
  /** Σ of the positive per-line over-posting exposure. */
  admin_would_overpost: number
  /**
   * ⚠️ Set when the order carries a `reversal_note`. On the one order examined
   * by hand it reads "Reversed 9 incorrect fulfillments on 2026-02-28 — lines
   * were auto-filled by UI bug", and rows sit on BOTH sides of that reversal —
   * so which are corrected re-entries is not decidable from the record. These
   * need a human, not a job that guesses.
   */
  undecidable: boolean
  reversal_note: string | null
}

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Sum `{order_line_id, quantity}` records into `line id → units`. */
export const aggregateRecords = (
  records: DeliveredLineRecord[] | null | undefined
): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const record of records || []) {
    const lineId = record?.order_line_id
    if (!lineId) continue
    totals[String(lineId)] = (totals[String(lineId)] || 0) + num(record.quantity)
  }
  return totals
}

/** Every entry of the appended history, flattened and summed per line. */
export const aggregateHistory = (
  history: DeliveryHistoryEntry[] | null | undefined
): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const entry of history || []) {
    for (const [lineId, qty] of Object.entries(aggregateRecords(entry?.lines))) {
      totals[lineId] = (totals[lineId] || 0) + qty
    }
  }
  return totals
}

/**
 * PURE. Compare the typed receipts against both metadata keys, per line.
 *
 * Reports every line the order has, not only the disagreeing ones — a line
 * present in one record and absent from the other is the whole point, and a
 * function that only returned mismatches could not tell "agrees at 0" from
 * "never looked at".
 */
export function reconcileOrderReceipts(input: {
  orderlines: OrderLineForReconciliation[] | null | undefined
  metadata: Record<string, unknown> | null | undefined
}): OrderReconciliation {
  const metadata = input.metadata || {}
  const blobByLine = aggregateRecords(
    metadata.partner_delivered_lines as DeliveredLineRecord[] | undefined
  )
  const historyByLine = aggregateHistory(
    metadata.partner_delivery_history as DeliveryHistoryEntry[] | undefined
  )

  const lines: LineReconciliation[] = []
  let typedTotal = 0
  let blobTotal = 0
  let driftValue = 0
  let overpost = 0

  for (const line of (input.orderlines || []).filter(Boolean)) {
    const lineId = String(line.id)
    /**
     * ⚠️ A SUM of deltas, never the latest row and never the row count: the
     * event types include `adjust` and `correction`, and a negative delta
     * legitimately reduces what was received.
     */
    const typed = (line.line_fulfillments || []).reduce(
      (sum, row) => sum + num(row?.quantity_delta),
      0
    )
    const blob = blobByLine[lineId] || 0
    const history = historyByLine[lineId] || 0
    const ordered = num(line.quantity)
    const unitPrice = num(line.price)
    const drift = typed - blob

    // What the admin path would post today vs what it should. Clamped at 0 per
    // line: a line where the blob OVERstates does not offset one where it
    // understates — they are two separate wrong stock movements.
    const wouldPost = Math.max(0, ordered - blob)
    const shouldPost = Math.max(0, ordered - typed)
    const lineOverpost = Math.max(0, wouldPost - shouldPost)

    typedTotal += typed
    blobTotal += blob
    driftValue += drift * unitPrice
    overpost += lineOverpost

    lines.push({
      line_id: lineId,
      material_name: line.material_name ?? null,
      ordered,
      typed,
      blob,
      history,
      unit_price: unitPrice,
      drift,
      drift_value: drift * unitPrice,
      admin_would_overpost: lineOverpost,
    })
  }

  const reversalNote =
    typeof metadata.reversal_note === "string" ? metadata.reversal_note : null

  return {
    lines,
    typed_total_units: typedTotal,
    blob_total_units: blobTotal,
    drift_value: driftValue,
    disagrees: lines.some((l) => l.drift !== 0),
    admin_would_overpost: overpost,
    undecidable: reversalNote !== null,
    reversal_note: reversalNote,
  }
}

/**
 * The date `line_fulfillment.quantity_delta` stopped being an INTEGER column.
 *
 * Migration20260612202252 (#342): "quantity_delta was integer, silently
 * rounding decimal partial deliveries (1.5 kg → 2)". Before it, Postgres
 * rounded every fractional receipt on the way in — the partner submitted 11.8
 * and the row stored 12, one second after the same figure went into
 * `metadata.partner_delivery_history` as 11.8, which is a jsonb blob and kept
 * it. The forward fix shipped; the rows already written were never corrected.
 */
export const QUANTITY_DELTA_WAS_INTEGER_UNTIL = new Date("2026-06-12T20:22:52Z")

export type ReceiptRow = {
  id: string
  quantity_delta?: number | string | null
  created_at?: string | Date | null
}

export type RoundedReceipt = {
  fulfillment_id: string
  line_id: string
  stored: number
  /** The unrounded figure the metadata kept. */
  actual: number
  created_at: string | null
}

/**
 * PURE: receipts whose stored quantity is an integer-rounding artefact of the
 * pre-#342 column, and what the true figure was.
 *
 * 🔴 Deliberately narrow, because this is the one part of #1613 that is
 * DECIDABLE. It fires only when every one of these holds:
 *
 *  - the row was written BEFORE the column became `real`;
 *  - the line has exactly ONE receipt and exactly ONE history entry, so the two
 *    can be paired without guessing which delivery is which;
 *  - the history figure is fractional, and rounds to exactly what is stored.
 *
 * Anything else — several receipts on a line, a whole-number history value, a
 * gap of a unit or more — is NOT rounding and is left alone. A gap of 10 units
 * is a missing receipt, not a rounding error, and repairing it as one would
 * invent a delivery.
 */
export function detectRoundedReceipts(input: {
  orderlines: Array<
    OrderLineForReconciliation & { line_fulfillments?: ReceiptRow[] | null }
  > | null | undefined
  metadata: Record<string, unknown> | null | undefined
}): RoundedReceipt[] {
  const history = (input.metadata?.partner_delivery_history ||
    []) as DeliveryHistoryEntry[]

  const found: RoundedReceipt[] = []

  for (const line of (input.orderlines || []).filter(Boolean)) {
    /**
     * 🔴 Drop the all-null placeholder rows first. `query.graph` returns one
     * row of nulls for a line with NO receipts, so `line_fulfillments.length`
     * is 1 for an empty relation — seen on
     * `inv_order_01K3BAM50HG32BN5C4TF76G5K5`, which has zero real receipts and
     * two such placeholders. Without this, a line with no receipts and a single
     * fractional history entry below 0.5 would round to the placeholder's
     * `0` and be "repaired" — issuing an update against the id `"null"`.
     * The `created_at` guard below happens to catch it today; that is luck,
     * not a design, and a write path should not rest on it.
     */
    const receipts = ((line.line_fulfillments || []) as ReceiptRow[]).filter(
      (r) => r && r.id != null
    )
    if (receipts.length !== 1) continue

    // Every history entry naming this line, across all submissions.
    const entries = history.flatMap((entry) =>
      (entry?.lines || []).filter(
        (l) => String(l?.order_line_id ?? "") === String(line.id)
      )
    )
    if (entries.length !== 1) continue

    const receipt = receipts[0]
    const stored = num(receipt.quantity_delta)
    const actual = num(entries[0].quantity)

    // Fractional on the metadata side, whole on the stored side, and the one
    // rounds to the other. `Math.round` matches Postgres' integer cast.
    if (Number.isInteger(actual)) continue
    if (!Number.isInteger(stored)) continue
    if (Math.round(actual) !== stored) continue

    const createdAt = receipt.created_at ? new Date(receipt.created_at) : null
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue
    if (createdAt >= QUANTITY_DELTA_WAS_INTEGER_UNTIL) continue

    found.push({
      fulfillment_id: String(receipt.id),
      line_id: String(line.id),
      stored,
      actual,
      created_at: createdAt.toISOString(),
    })
  }

  return found
}
