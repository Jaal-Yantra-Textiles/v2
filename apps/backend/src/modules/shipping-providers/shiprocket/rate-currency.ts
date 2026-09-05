/**
 * Shiprocket quotes in RUPEES. `calculated_amount` is denominated in the CART's
 * currency. Nothing in between converted.
 *
 * ## The bug this exists to fix
 *
 * `calculatePrice` returned the carrier's number raw:
 *
 *     return { calculated_amount: Number(recommended.amount), ... }
 *
 * Measured on prod 2026-09-05 — an AU-region cart, Melbourne address:
 *
 *     POST /store/shipping-options/so_01M0J.../calculate → calculated_amount: 890
 *
 * That is ₹890 (≈ A$16) presented to the buyer as **A$890**. The same option's
 * own configured fallback for AUD is 55, so the fallback was right and the live
 * rate was ~55× wrong. The client's own live-verified notes state the unit
 * plainly — "SRX Economy Pro ₹3119", "Aramex ₹8477 → ₹57,937".
 *
 * The method's docblock already said `calculated_amount` is in the cart's
 * currency, and it threaded `currency_code` carefully into the FALLBACK path
 * while ignoring it entirely on the success path. `flat-fallback.ts` predicted
 * this exact door: "leaning on live international rates is exactly what makes
 * it reachable."
 *
 * ## Why an unconvertible rate falls back rather than shipping raw
 *
 * The honest answers to "I have a number but not in the currency I must quote"
 * are to convert it or to not use it. Returning it anyway is the bug. So when
 * the currency is unknown, or no INR→target rate exists, the caller drops to
 * the per-currency flat fallback — which is a number somebody chose, in the
 * right currency — instead of a carrier figure wearing the wrong denomination.
 *
 * 🔑 An INR cart needs no conversion and must not be given one: multiplying by
 * a rate of 1.0 that came from a cache is strictly worse than not asking.
 */

/** The currency Shiprocket's rate endpoints answer in, domestic and international. */
export const SHIPROCKET_RATE_CURRENCY = "INR"

/**
 * Whether a quote in `SHIPROCKET_RATE_CURRENCY` has to be converted before it
 * can be returned as `calculated_amount` for a cart in `target`.
 *
 * Returns false for an INR cart (already right) and true for everything else
 * INCLUDING an unknown target — the caller must then decide, and its decision
 * is to fall back rather than guess.
 */
export const needsRateConversion = (target?: string | null): boolean =>
  String(target ?? "").trim().toUpperCase() !== SHIPROCKET_RATE_CURRENCY

/** True when we know what currency the cart is in at all. */
export const hasKnownCurrency = (target?: string | null): boolean =>
  String(target ?? "").trim().length > 0

/**
 * Apply an FX rate to a carrier amount.
 *
 * `rate` is target units per 1 INR, matching `FxRatesService.getRate(from, to)`.
 * Rounds to 2dp — this is a money value that goes on an invoice.
 *
 * Returns null for a rate that is not a usable positive number. A zero or NaN
 * rate would silently produce free shipping, which is the failure mode the flat
 * fallback was introduced to end; it must not come back in through here.
 */
export const applyRateToCarrierAmount = (
  amount: number,
  rate: number
): number | null => {
  const a = Number(amount)
  const r = Number(rate)
  if (!Number.isFinite(a) || a < 0) return null
  if (!Number.isFinite(r) || r <= 0) return null
  return Math.round(a * r * 100) / 100
}
