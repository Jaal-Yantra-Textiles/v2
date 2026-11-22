/**
 * Which payment collections ask for more than they will ever collect (#2583).
 *
 * ## How it happens
 *
 * The buyer opens the balance page while A$220.34 is owed; an order edit then
 * moves the open collection to A$347.36; the buyer pays the A$220.34 the page
 * still shows; the remaining A$127.02 is raised as a NEW collection and paid.
 * Every cent landed, yet the first collection stays `partially_captured`
 * forever and drags the order's payment status with it (order #101).
 *
 * The code path is fixed (`ensureStripeSessionForCollection` replaces a stale
 * unpaid session). This judges the rows it left behind.
 *
 * ## 🔴 The guard is the ORDER, not the collection
 *
 * A part-captured collection on its own is a real debt more often than not —
 * a buyer who paid half and still owes the rest. It is only overstated when
 * the order's net captures across EVERY collection already cover its total.
 * Judged from the captures and refunds themselves, never from the collection's
 * stored `captured_amount` or the order summary, which are the figures that
 * went stale.
 */

export type CollectionPayment = {
  captures?: Array<{ amount: unknown }> | null
  refunds?: Array<{ amount: unknown }> | null
}

export type CollectionUnderTest = {
  id: string
  status: string | null
  amount: unknown
  currency_code?: string | null
  payments?: CollectionPayment[] | null
}

export type OverstatedVerdict = {
  collection_id: string
  /** The collection's amount today. */
  amount: number
  /** What it actually captured, net of refunds — the amount it is set to. */
  captured: number
  reason: string
}

const cents = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

const sumCents = (rows: Array<{ amount: unknown }> | null | undefined): number =>
  (rows || []).reduce((acc, r) => acc + (cents(r?.amount) || 0), 0)

/** Net captured on one collection, in cents. */
export const netCapturedCents = (c: CollectionUnderTest): number =>
  (c.payments || []).reduce(
    (acc, p) => acc + sumCents(p?.captures) - sumCents(p?.refunds),
    0
  )

/** Statuses that are finished either way — never reopened or rewritten. */
const SETTLED = new Set(["completed", "canceled"])

export const findOverstatedCollections = (input: {
  order_total: unknown
  collections: CollectionUnderTest[]
}): { verdicts: OverstatedVerdict[]; skipped_reason: string | null } => {
  const totalCents = cents(input.order_total)
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    return { verdicts: [], skipped_reason: "order total is not a positive number" }
  }

  const orderNetCents = (input.collections || [])
    .filter((c) => String(c?.status || "").toLowerCase() !== "canceled")
    .reduce((acc, c) => acc + netCapturedCents(c), 0)

  if (orderNetCents < totalCents) {
    return {
      verdicts: [],
      skipped_reason: `order still owes ${((totalCents - orderNetCents) / 100).toFixed(2)} — a part-captured collection here is a real debt`,
    }
  }

  const verdicts: OverstatedVerdict[] = []
  for (const c of input.collections || []) {
    if (SETTLED.has(String(c?.status || "").toLowerCase())) continue
    const amountCents = cents(c.amount)
    const capturedCents = netCapturedCents(c)
    if (!Number.isFinite(amountCents)) continue
    // Nothing captured = an abandoned request, not an overstated one. Leave it.
    if (capturedCents <= 0) continue
    if (capturedCents >= amountCents) continue
    verdicts.push({
      collection_id: c.id,
      amount: amountCents / 100,
      captured: capturedCents / 100,
      reason: `asks ${(amountCents / 100).toFixed(2)}, captured ${(capturedCents / 100).toFixed(2)}; the order's captures (${(orderNetCents / 100).toFixed(2)}) already cover its total (${(totalCents / 100).toFixed(2)})`,
    })
  }
  return { verdicts, skipped_reason: null }
}
