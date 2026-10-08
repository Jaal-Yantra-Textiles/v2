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
  /**
   * #2289 S3 — recorded as short by a receiver's count (open shortfalls).
   * Short goods are no longer awaiting a count: someone counted, and they
   * were not there.
   */
  short: number
  /** Dispatched minus received minus short: sent, not yet counted. */
  awaiting_count: number
}

export type ShortfallRow = {
  inventory_order_line_id?: string | null
  quantity?: number | string | null
  status?: string | null
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

/**
 * Shortfalls per order line. `openOnly` gives what is still SHORT (shown to
 * the supplier); without it, every shortfall, including ones resolved with a
 * note (written off, credited). Those are still not awaiting a count, and must
 * not be recorded again on the next receipt.
 */
export function sumShortByLine(
  rows: ShortfallRow[] | null | undefined,
  options: { openOnly?: boolean } = {}
): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows || []) {
    if (options.openOnly && r?.status && r.status !== "open") continue
    const id = r?.inventory_order_line_id ? String(r.inventory_order_line_id) : ""
    if (!id) continue
    out.set(id, (out.get(id) ?? 0) + num(r.quantity))
  }
  return out
}

export function lineLedger(
  line: { id: string; quantity?: number | string | null; line_fulfillments?: ReceiptRow[] | ReceiptRow | null },
  dispatchedByLine: Map<string, number>,
  shortfalls: ShortfallRow[] | null | undefined = []
): LineLedger {
  const ordered = num(line.quantity)
  const received = sumReceived(line.line_fulfillments)
  const dispatched = Math.max(dispatchedByLine.get(String(line.id)) ?? 0, received)
  const gap = Math.max(0, dispatched - received)
  const allShort = Math.min(sumShortByLine(shortfalls).get(String(line.id)) ?? 0, gap)
  const short = Math.min(sumOpenShortByLine(shortfalls).get(String(line.id)) ?? 0, gap)
  return {
    line_id: String(line.id),
    ordered: round(ordered),
    dispatched: round(dispatched),
    received: round(received),
    to_dispatch: round(Math.max(0, ordered - dispatched)),
    short: round(short),
    awaiting_count: round(Math.max(0, gap - allShort)),
  }
}

/**
 * #2289 S3 — after a receipt, what to record or resolve per COUNTED line.
 *
 *  - `record`: the line was counted and is still below what was dispatched,
 *    beyond what is already recorded short. The receiver counted what
 *    arrived, so the rest is missing.
 *  - `resolve`: received plus open short now exceeds dispatched, i.e. goods
 *    recorded as missing turned up after all. That much of the open
 *    shortfall is resolved.
 *
 * Lines the receiver did not count are left alone: not counted is not short.
 */
export function planShortfalls(
  lines: Array<{ id: string; quantity?: number | string | null; line_fulfillments?: ReceiptRow[] | ReceiptRow | null }>,
  dispatchedByLine: Map<string, number>,
  shortfalls: ShortfallRow[] | null | undefined,
  countedLineIds: Set<string>
): {
  record: Array<{ line_id: string; quantity: number; dispatched: number; received: number }>
  resolve: Array<{ line_id: string; quantity: number }>
} {
  const record: Array<{ line_id: string; quantity: number; dispatched: number; received: number }> = []
  const resolve: Array<{ line_id: string; quantity: number }> = []
  for (const line of lines || []) {
    const id = String(line.id)
    const received = sumReceived(line.line_fulfillments)
    const dispatched = Math.max(dispatchedByLine.get(id) ?? 0, received)
    const openShort = sumOpenShortByLine(shortfalls).get(id) ?? 0
    const allShort = sumShortByLine(shortfalls).get(id) ?? 0
    const excess = received + openShort - dispatched
    if (openShort > 0 && excess > TOLERANCE) {
      resolve.push({ line_id: id, quantity: round(Math.min(openShort, excess)) })
      continue
    }
    if (!countedLineIds.has(id)) continue
    // Every recorded shortfall, resolved or not: a written-off gap is not
    // missing all over again on the next receipt.
    const missing = dispatched - received - allShort
    if (missing > TOLERANCE) {
      record.push({ line_id: id, quantity: round(missing), dispatched: round(dispatched), received: round(received) })
    }
  }
  return { record, resolve }
}

/** True when `qty` more would push a line past what was ordered. */
export function exceedsOrdered(ledger: LineLedger, qty: number): boolean {
  return qty > ledger.to_dispatch + TOLERANCE
}

/** True when a line has been dispatched in full (within tolerance). */
export function fullyDispatched(ledger: LineLedger): boolean {
  return ledger.dispatched >= ledger.ordered - TOLERANCE
}

/** Open shortfalls per order line. */
export const sumOpenShortByLine = (rows: ShortfallRow[] | null | undefined) =>
  sumShortByLine(rows, { openOnly: true })
