import { PaymentSessionStatus } from "@medusajs/framework/utils"

/**
 * Pure helpers for the Stripe Connect payment provider — amount conversion,
 * application-fee math, and Stripe→Medusa status mapping. Kept free of any
 * Stripe/DB dependency so they are unit-testable.
 */

// https://docs.stripe.com/currencies — zero-decimal and three-decimal currencies.
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
])
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"])

export const currencyMultiplier = (currency: string): number => {
  const c = (currency || "").toUpperCase()
  if (ZERO_DECIMAL.has(c)) return 1
  if (THREE_DECIMAL.has(c)) return 1000
  return 100
}

/**
 * Convert a major-unit amount (e.g. 12.50 EUR) into Stripe's smallest unit
 * (1250). Mirrors @medusajs/payment-stripe getSmallestUnit, incl. the
 * three-decimal rounding-to-ten rule.
 */
export const toStripeMinorUnits = (
  amount: number | string,
  currency: string
): number => {
  const n = typeof amount === "number" ? amount : Number(amount)
  if (!isFinite(n)) return 0
  const m = currencyMultiplier(currency)
  let v = Math.round(n * m)
  if (m === 1000) v = Math.ceil(v / 10) * 10
  return v
}

/**
 * Parse a plan's payment_processing_fee ("2%", "2", 2, "2.5%") into a fraction
 * (0.02 / 0.025). Anything invalid or negative → 0 (no fee — the safe default).
 */
export const parseFeePercent = (input: unknown): number => {
  if (input == null) return 0
  const s = String(input).trim().replace("%", "")
  const n = Number(s)
  if (!isFinite(n) || n < 0) return 0
  return n / 100
}

/**
 * Platform application fee in minor units, given the charge amount (minor units)
 * and a fee fraction. Never exceeds the charge itself.
 */
export const computeApplicationFee = (
  minorAmount: number,
  feePercent: number
): number => {
  if (!isFinite(minorAmount) || minorAmount <= 0) return 0
  if (!isFinite(feePercent) || feePercent <= 0) return 0
  return Math.min(Math.round(minorAmount * feePercent), minorAmount)
}

/**
 * Map a Stripe PaymentIntent status onto a Medusa PaymentSessionStatus. Mirrors
 * @medusajs/payment-stripe's mapping. `hasLastPaymentError` disambiguates the
 * requires_payment_method case (a real failure vs. a fresh intent).
 */
export const mapStripeStatus = (
  status: string,
  hasLastPaymentError = false
): PaymentSessionStatus => {
  switch (status) {
    case "requires_payment_method":
      return hasLastPaymentError
        ? PaymentSessionStatus.ERROR
        : PaymentSessionStatus.PENDING
    case "requires_confirmation":
    case "processing":
      return PaymentSessionStatus.PENDING
    case "requires_action":
      return PaymentSessionStatus.REQUIRES_MORE
    case "canceled":
      return PaymentSessionStatus.CANCELED
    case "requires_capture":
      return PaymentSessionStatus.AUTHORIZED
    case "succeeded":
      return PaymentSessionStatus.CAPTURED
    default:
      return PaymentSessionStatus.PENDING
  }
}
