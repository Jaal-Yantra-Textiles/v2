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

// `shipping-ledger` is itself pure and dependency-free, so importing it here
// keeps this file's "trivially unit-testable" contract intact.
import {
  readShippingCharges,
  readShippingReversals,
  type ShippingFxRecord,
} from "./shipping-ledger"

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
  metadata?: Record<string, any> | null
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
   * The live freight charges, one per fulfillment. Freight is booked per BOX
   * while the fee row is per ORDER, so a multi-box order carries several.
   *
   * `shipping` above is their rollup and remains the right thing to render for
   * the single-box case that covers almost every order; this is what a UI shows
   * when there is more than one, since "platform shipping" as a single number
   * can't say which box, which carrier, or which waybill.
   */
  shipping_charges: ShippingChargeLine[]
  /**
   * Platform-shipping charges that WERE deducted and have since been given back
   * because their waybill was cancelled. Empty for the overwhelming majority of
   * orders.
   *
   * These deduct nothing — they are already out of `net_payout`. They are
   * carried into the display precisely so the payout doesn't appear to change
   * value on its own between two views: the partner sees the charge arrive, sees
   * it reversed, and sees the replacement carrier's charge as its own line.
   */
  shipping_reversals: ReversedShippingCharge[]
  /**
   * What the partner actually receives: `order_total − fee_amount − shipping`.
   *
   * A non-collectible fee (waived / reversed) deducts nothing, so it drops out
   * of the arithmetic rather than being subtracted anyway. Reversed shipping is
   * likewise absent — reversing is what removed it.
   */
  net_payout: number
}

/** One box's freight charge, attributed to the fulfillment that booked it. */
export type ShippingChargeLine = {
  fulfillment_id: string | null
  amount: number
  currency_code: string
  carrier: string | null
  awb: string | null
  /**
   * True when quoted outside the order currency — shown, never deducted.
   *
   * A CONVERTED line is false here: it was quoted in the carrier's currency but
   * is stored in the order's, and is deducted like any other. `fx` is what says
   * a conversion happened, so a UI can render "₹11,767 @ 0.01048 = $123.32"
   * rather than a bare converted number nobody can tie to an invoice.
   */
  is_foreign_currency: boolean
  /** The conversion, when this line was converted. Null when it was not. */
  fx: ShippingFxRecord | null
}

/** A retired platform-shipping charge, shown for continuity, never deducted. */
export type ReversedShippingCharge = {
  amount: number
  currency_code: string
  carrier: string | null
  /** The cancelled waybill — the handle for the carrier's credit note. */
  awb: string | null
  reversed_at: string | null
  reason: string | null
  /** The conversion behind `amount`, so a credit note can still be matched. */
  fx: ShippingFxRecord | null
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
  // Freight is booked per fulfillment; the ledger keeps one line per box and
  // synthesises a single line from the legacy scalar for rows written before it
  // existed, so this reads the same either way.
  const ledger = readShippingCharges(fee)
  // With no order currency recorded there is no way to tell "same currency" from
  // "foreign", so the first line sets the reference rather than everything being
  // classed foreign and silently dropping out of the payout.
  const reference = currency_code || ledger[0]?.currency_code || ""
  const shipping_charges: ShippingChargeLine[] = ledger.map((c) => ({
    fulfillment_id: c.fulfillment_id,
    amount: c.amount,
    currency_code: c.currency_code,
    carrier: c.carrier,
    awb: c.awb,
    is_foreign_currency: c.currency_code !== reference,
    fx: c.fx,
  }))
  const deductibleLines = shipping_charges.filter((c) => !c.is_foreign_currency)

  // The rollup. A single charge passes through untouched — that is the shape
  // every existing client reads and the case that covers almost every order.
  // Several collapse to the deductible total, with the carrier dropped when more
  // than one is involved (no single name is true) and the detail left in
  // `shipping_charges`.
  const shipping: ShippingCharge | null =
    shipping_charges.length === 0
      ? null
      : shipping_charges.length === 1
        ? {
            amount: shipping_charges[0].amount,
            currency_code: shipping_charges[0].currency_code,
            carrier: shipping_charges[0].carrier,
            is_foreign_currency: shipping_charges[0].is_foreign_currency,
          }
        : deductibleLines.length === 0
          ? null
          : {
              amount: deductibleLines.reduce((s, c) => s + c.amount, 0),
              currency_code: reference,
              carrier:
                new Set(deductibleLines.map((c) => c.carrier).filter(Boolean))
                  .size === 1
                  ? deductibleLines.find((c) => c.carrier)!.carrier
                  : null,
              is_foreign_currency: false,
            }

  // Reversed charges are display-only — they were removed from the row when the
  // waybill was cancelled, so they must never re-enter the arithmetic below.
  // Coerced defensively: `metadata` is free-form jsonb and this must not throw.
  const shipping_reversals: ReversedShippingCharge[] = readShippingReversals(
    fee.metadata
  ).map((r: any) => ({
    amount: toNum(r?.amount),
    currency_code: String(r?.currency_code || currency_code).toUpperCase(),
    carrier: r?.carrier || null,
    awb: r?.awb || null,
    reversed_at: r?.reversed_at || null,
    reason: r?.reason || null,
    fx: (r?.fx as ShippingFxRecord) || null,
  }))

  // Only deduct what is actually collected. A foreign-currency carrier charge
  // is deliberately NOT subtracted — converting it here would invent an FX rate
  // this pure function has no business choosing; the UI shows it as its own
  // line in its own currency instead.
  // Every box's freight comes off, not just the last one recorded. Summed from
  // the lines rather than the rollup so a multi-carrier order deducts each
  // order-currency charge even where no single carrier name applies.
  const deductions =
    (is_collectible ? fee_amount : 0) +
    deductibleLines.reduce((s, c) => s + c.amount, 0)

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
    shipping_charges,
    shipping_reversals,
    net_payout: order_total - deductions,
  }
}
