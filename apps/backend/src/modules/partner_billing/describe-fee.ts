/**
 * Pure display contract for a single `partner_fee` row (#623, follow-up to #336).
 *
 * Kept dependency-free so it's trivially unit-testable and so BOTH read routes
 * (`GET /admin/orders/:id/partner-fee` and the partner mirror) can return an
 * already-shaped `display` object — the two UIs (admin widget + partner-ui
 * order view) then just render it, instead of each re-deriving the rate label.
 * Never throws — a reporting payload must not 500 on a malformed row.
 *
 * Money fields are Medusa `bigNumber` (number | numeric string); everything is
 * coerced with `Number(...)` and non-finite values count as 0.
 */

export type PartnerFeeBasis = "percentage" | "flat"

export type PartnerFeeRowLike = {
  order_id?: string | null
  currency_code?: string | null
  fee_basis?: PartnerFeeBasis | string | null
  fee_rate?: number | string | null
  fee_amount?: number | string | null
  order_total?: number | string | null
  status?: string | null
  fee_type?: string | null
  payment_gateway_bps?: number | string | null
  payment_gateway_amount?: number | string | null
  commission_bps?: number | string | null
  commission_amount?: number | string | null
}

/** Itemised components of a `retail_split` fee (gateway + commission). */
export type FeeBreakdown = {
  payment_gateway_amount: number
  payment_gateway_rate_label: string
  commission_amount: number
  commission_rate_label: string
}

export type DescribedFee = {
  order_id: string
  status: string
  fee_basis: PartnerFeeBasis
  /** "commission" (legacy flat) or "retail_split" (gateway + commission). */
  fee_type: string
  /** Human label for the rate: "2.00%" (percentage, bps→%) or "50.00 INR" (flat). */
  rate_label: string
  fee_amount: number
  order_total: number
  currency_code: string
  /** Whether this fee currently counts toward collected commission (accrued/invoiced). */
  is_collectible: boolean
  /** Itemised gateway + commission components; null for legacy `commission` rows. */
  breakdown: FeeBreakdown | null
}

const toNum = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Format the fee rate for display.
 * - percentage: `fee_rate` is basis points → "2.00%" (200 bps), "2.50%" (250).
 * - flat: `fee_rate` is an amount in `currency_code` → "50.00 INR".
 */
export function formatFeeRate(
  basis: string | null | undefined,
  rate: number | string | null | undefined,
  currency?: string | null
): string {
  const r = toNum(rate)
  if (basis === "flat") {
    return `${r.toFixed(2)} ${(currency || "").toUpperCase()}`.trim()
  }
  return `${(r / 100).toFixed(2)}%`
}

/**
 * Shape a raw `partner_fee` row into a display object, or `null` when there's
 * no fee (retail order / never accrued). A "collectible" fee is one the
 * platform still expects to collect (`accrued` or `invoiced`); `reversed` /
 * `waived` are not.
 */
export function describeFee(
  fee: PartnerFeeRowLike | null | undefined
): DescribedFee | null {
  if (!fee || !fee.order_id) {
    return null
  }
  const fee_basis: PartnerFeeBasis = fee.fee_basis === "flat" ? "flat" : "percentage"
  const currency_code = (fee.currency_code || "").toUpperCase()
  const status = String(fee.status || "accrued")
  const fee_type = fee.fee_type === "retail_split" ? "retail_split" : "commission"

  const breakdown: FeeBreakdown | null =
    fee_type === "retail_split"
      ? {
          payment_gateway_amount: toNum(fee.payment_gateway_amount),
          payment_gateway_rate_label: formatFeeRate(
            "percentage",
            fee.payment_gateway_bps,
            currency_code
          ),
          commission_amount: toNum(fee.commission_amount),
          commission_rate_label: formatFeeRate(
            "percentage",
            fee.commission_bps,
            currency_code
          ),
        }
      : null

  return {
    order_id: String(fee.order_id),
    status,
    fee_basis,
    fee_type,
    rate_label: formatFeeRate(fee_basis, fee.fee_rate, currency_code),
    fee_amount: toNum(fee.fee_amount),
    order_total: toNum(fee.order_total),
    currency_code,
    is_collectible: status === "accrued" || status === "invoiced",
    breakdown,
  }
}
