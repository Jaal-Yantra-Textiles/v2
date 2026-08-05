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
  shipping_amount?: number | string | null
  shipping_currency_code?: string | null
  shipping_carrier?: string | null
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
  /**
   * What shipping on the PLATFORM's carrier account cost on this order, or null
   * when the partner shipped on their own. A second deduction from the payout,
   * separate from the commission in `fee_amount`.
   */
  shipping: ShippingCharge | null
  /**
   * What the partner actually receives: `order_total − fee_amount − shipping`.
   *
   * A non-collectible fee (waived / reversed) deducts nothing, so it drops out
   * of the arithmetic rather than being subtracted anyway.
   */
  net_payout: number
}

/** Platform-shipping deduction, when the partner used our carrier account. */
export type ShippingCharge = {
  amount: number
  currency_code: string
  carrier: string | null
  /**
   * True when the carrier quoted in a currency other than the order's. The
   * amount is then NOT directly comparable with the order totals and must be
   * labelled with its own currency in the UI.
   */
  is_foreign_currency: boolean
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

  const is_collectible = status === "accrued" || status === "invoiced"
  const fee_amount = toNum(fee.fee_amount)
  const order_total = toNum(fee.order_total)

  // `null`/absent means the partner didn't use our shipping. A recorded 0 is a
  // real free-shipping rate and must survive as a shipping row, so test for
  // presence rather than truthiness.
  const shipping: ShippingCharge | null =
    fee.shipping_amount === null || fee.shipping_amount === undefined
      ? null
      : {
          amount: toNum(fee.shipping_amount),
          currency_code: (fee.shipping_currency_code || currency_code).toUpperCase(),
          carrier: fee.shipping_carrier || null,
          is_foreign_currency:
            !!fee.shipping_currency_code &&
            fee.shipping_currency_code.toUpperCase() !== currency_code,
        }

  // Only deduct what is actually collected. A foreign-currency carrier charge
  // is deliberately NOT subtracted — converting it here would invent an FX rate
  // this pure function has no business choosing; the UI shows it as its own
  // line in its own currency instead.
  const deductions =
    (is_collectible ? fee_amount : 0) +
    (shipping && !shipping.is_foreign_currency ? shipping.amount : 0)

  return {
    order_id: String(fee.order_id),
    status,
    fee_basis,
    fee_type,
    rate_label: formatFeeRate(fee_basis, fee.fee_rate, currency_code),
    fee_amount,
    order_total,
    currency_code,
    is_collectible,
    breakdown,
    shipping,
    net_payout: order_total - deductions,
  }
}
