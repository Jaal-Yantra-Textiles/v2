/**
 * #2289 — per-line arithmetic for "the supplier says they sent X, the receiver
 * counted Y". PURE: no container, so every reader (the supplier's Complete
 * guard, the partner order view, the shortfall record) computes it one way.
 *
 * Two ledgers:
 *  - `inventory_dispatch` rows: the supplier's claim. Post no stock.
 *  - `line_fulfillment` rows: receipts. Each `quantity_delta` is a delta, and
 *    `adjust`/`correction` rows are deltas too, so received is their SUM.
 *
 * 🔑 dispatched = max(sum of dispatches, received). Before #2289 a supplier's
 * Complete wrote `received` rows and no dispatch, so on those orders the
 * receipt IS the only record of what was sent. And our own team can receive
 * goods nobody dispatched in the app. Either way, what arrived was sent.
 */

export type DispatchRow = {
  inventory_order_line_id?: string | null
  quantity?: number | string | null
}

export type ReceiptRow = {
  quantity_delta?: number | string | null
}

export type LineLedger = {
  line_id: string
  ordered: number
  dispatched: number
  received: number
  /** Ordered minus dispatched: what the supplier may still send. */
  to_dispatch: number
  /** Dispatched minus received: in transit, or short once counted. */
  awaiting_count: number
}

const TOLERANCE = 0.01

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const round = (n: number): number => Math.round(n * 1000) / 1000

export function sumDispatchedByLine(rows: DispatchRow[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows || []) {
    const id = r?.inventory_order_line_id ? String(r.inventory_order_line_id) : ""
    if (!id) continue
    out.set(id, (out.get(id) ?? 0) + num(r.quantity))
  }
  return out
}

export function sumReceived(rows: ReceiptRow[] | ReceiptRow | null | undefined): number {
  const arr = !rows ? [] : Array.isArray(rows) ? rows : [rows]
  return arr.reduce((s, r) => s + num(r?.quantity_delta), 0)
}

export function lineLedger(
  line: { id: string; quantity?: number | string | null; line_fulfillments?: ReceiptRow[] | ReceiptRow | null },
  dispatchedByLine: Map<string, number>
): LineLedger {
  const ordered = num(line.quantity)
  const received = sumReceived(line.line_fulfillments)
  const dispatched = Math.max(dispatchedByLine.get(String(line.id)) ?? 0, received)
  return {
    line_id: String(line.id),
    ordered: round(ordered),
    dispatched: round(dispatched),
    received: round(received),
    to_dispatch: round(Math.max(0, ordered - dispatched)),
    awaiting_count: round(Math.max(0, dispatched - received)),
  }
}

/** True when `qty` more would push a line past what was ordered. */
export function exceedsOrdered(ledger: LineLedger, qty: number): boolean {
  return qty > ledger.to_dispatch + TOLERANCE
}

/** True when a line has been dispatched in full (within tolerance). */
export function fullyDispatched(ledger: LineLedger): boolean {
  return ledger.dispatched >= ledger.ordered - TOLERANCE
}
