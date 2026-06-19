/**
 * Pure roll-up math for the #336 partner-fee read API (Slice 4).
 *
 * Kept dependency-free so it is trivially unit-testable and shared by both the
 * admin route (`GET /admin/partners/[id]/fees`) and the partner-side mirror
 * (`GET /partners/[id]/fees`). Never throws — a reporting endpoint must not 500
 * on a malformed row.
 *
 * Money fields are Medusa `bigNumber` so they arrive as numbers or numeric
 * strings; everything is coerced with `Number(...)` and non-finite values count
 * as 0.
 *
 * "net" = the commission the platform actually collects: only `accrued` and
 * `invoiced` fees count. `reversed` / `waived` fees are excluded from net (they
 * were undone) but still tracked in `total` and per-status breakdowns.
 */

export type PartnerFeeStatus = "accrued" | "invoiced" | "waived" | "reversed"

export type PartnerFeeLike = {
  status?: string | null
  fee_amount?: number | string | null
  currency_code?: string | null
}

export type FeeStatusBucket = { count: number; fee_amount: number }
export type FeeCurrencyBucket = {
  count: number
  total_amount: number
  net_amount: number
}

export type PartnerFeeSummary = {
  count: number
  /** Sum of every fee_amount regardless of status. */
  total_fee_amount: number
  /** Sum of fee_amount for billable (accrued | invoiced) fees only. */
  net_fee_amount: number
  by_status: Record<string, FeeStatusBucket>
  by_currency: Record<string, FeeCurrencyBucket>
}

const BILLABLE: ReadonlySet<string> = new Set(["accrued", "invoiced"])

function toAmount(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Roll up a partner's fee rows into a reporting envelope. Order-independent and
 * idempotent; safe on an empty array (returns zeroed totals).
 */
export function summarizePartnerFees(
  fees: ReadonlyArray<PartnerFeeLike> | null | undefined
): PartnerFeeSummary {
  const rows = Array.isArray(fees) ? fees : []

  let total = 0
  let net = 0
  const by_status: Record<string, FeeStatusBucket> = {}
  const by_currency: Record<string, FeeCurrencyBucket> = {}

  for (const row of rows) {
    const status = (row?.status ?? "accrued") as string
    const currency = (row?.currency_code ?? "unknown").toLowerCase()
    const amount = toAmount(row?.fee_amount)
    const billable = BILLABLE.has(status)

    total += amount
    if (billable) {
      net += amount
    }

    const sb = (by_status[status] ??= { count: 0, fee_amount: 0 })
    sb.count += 1
    sb.fee_amount = round2(sb.fee_amount + amount)

    const cb = (by_currency[currency] ??= {
      count: 0,
      total_amount: 0,
      net_amount: 0,
    })
    cb.count += 1
    cb.total_amount = round2(cb.total_amount + amount)
    if (billable) {
      cb.net_amount = round2(cb.net_amount + amount)
    }
  }

  return {
    count: rows.length,
    total_fee_amount: round2(total),
    net_fee_amount: round2(net),
    by_status,
    by_currency,
  }
}
