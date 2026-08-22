import { MedusaError } from "@medusajs/framework/utils"

import { applyRate } from "../../../lib/fx/exchange-rate"

/**
 * PURE: the trade price for one quoted line (#1439 S7).
 *
 * ## Why an override exists at all
 *
 * Until this, a quote's `quoted_unit_amount` WAS the live catalog price at that
 * quantity — `planQuotePrices` copied whatever the builder produced. There was
 * no discount concept anywhere in the quote path, so a partner could not
 * actually quote a trade price. A B2B buyer does not pay retail.
 *
 * ## The override is entered in the STORE's default currency
 *
 * Founder's call, and it is the honest one: a partner negotiating in Mumbai
 * thinks in rupees whatever currency the buyer is being quoted in. So the
 * number they type is authoritative, and the conversion happens here, ONCE, at
 * mint — never on read. The rate used is persisted alongside, because a quoted
 * number that cannot be reproduced later is not evidence, and an FX rate is
 * exactly the input that will have moved by the time anyone asks.
 *
 * ## What this is NOT
 *
 * Not a promotion. It belongs in the frozen quote, not in a discount rule the
 * cart re-evaluates: the cart would then apply it to whatever the catalog price
 * has become, and two numbers that were supposed to agree would drift.
 */

export type LineOverrideInput = {
  /** The live catalog price at this line's quantity, in the QUOTE currency. */
  live_unit_amount: number | null
  /** 0-100. Applied to the live amount; no currency involved. */
  discount_percent?: number | null
  /** A flat unit price, in the STORE's default currency. */
  override_unit_amount?: number | null
  /** store default currency → quote currency. 1 when they are the same. */
  fx_rate: number
  store_currency_code: string
  quote_currency_code: string
}

export type LineOverride = {
  kind: "discount_percent" | "override_unit_amount"
  /** Exactly what the partner typed, before any conversion. */
  input_amount: number
  /** Null for a percentage — a percentage has no currency. */
  input_currency_code: string | null
  /** The rate applied. 1 for a percentage, and for a same-currency override. */
  fx_rate: number
}

export type ResolvedLine = {
  /** The ONE number that reaches both the price list and the frozen row. */
  unit_amount: number | null
  override: LineOverride | null
}

/**
 * Resolve one line.
 *
 * 🔴 Never returns a zero or negative amount — it throws instead.
 *
 * `planQuotePrices` drops a null rather than defaulting, and that is the
 * safeguard that keeps an unpriceable line out of the price list. A ZERO is
 * different and far worse: it is a perfectly valid number, so nothing drops it,
 * and it becomes an ACTIVE price of zero that the cart cheerfully charges. The
 * fastest route to one is arithmetic — `discount_percent: 100`, or an override
 * of 0 typed into a form — so the refusal lives here, at the only place that
 * can tell the difference between "no price" and "free".
 *
 * A partner who genuinely means free has to say so somewhere that states it,
 * not arrive at it through a percentage field.
 */
export function resolveLineOverride(input: LineOverrideInput): ResolvedLine {
  const live =
    input.live_unit_amount === null || input.live_unit_amount === undefined
      ? null
      : Number(input.live_unit_amount)

  const hasPercent =
    input.discount_percent !== null &&
    input.discount_percent !== undefined &&
    Number.isFinite(Number(input.discount_percent))
  const hasFlat =
    input.override_unit_amount !== null &&
    input.override_unit_amount !== undefined &&
    Number.isFinite(Number(input.override_unit_amount))

  if (hasPercent && hasFlat) {
    // The validator refuses this too. Refusing it HERE as well is deliberate:
    // the pure function is reachable from the admin twin and from any future
    // caller, and "which one wins" is not a question that should have an
    // answer.
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A line takes either a discount_percent or an override_unit_amount, never both."
    )
  }

  if (!hasPercent && !hasFlat) {
    return { unit_amount: live, override: null }
  }

  const rate = Number(input.fx_rate)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `No usable exchange rate for ${input.store_currency_code} → ${input.quote_currency_code}. ` +
        "Nothing is quoted rather than quoting a converted number we cannot stand behind."
    )
  }

  let amount: number
  let override: LineOverride

  if (hasFlat) {
    const typed = Number(input.override_unit_amount)
    // The rate is 1 when the two currencies match, so this is the same code
    // path either way — no branch that only the cross-currency case exercises.
    amount = applyRate(typed, rate)
    override = {
      kind: "override_unit_amount",
      input_amount: typed,
      input_currency_code: input.store_currency_code,
      fx_rate: rate,
    }
  } else {
    const percent = Number(input.discount_percent)
    if (percent < 0 || percent > 100) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `discount_percent must be between 0 and 100 (got ${percent}).`
      )
    }
    if (live === null) {
      // A percentage OFF nothing is not a price. The line has no live amount,
      // so there is nothing to discount and the mint must say so rather than
      // quietly quoting the line at zero.
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A discount_percent needs a live price to apply to, and this line has none."
      )
    }
    amount = Math.round(live * (1 - percent / 100) * 100) / 100
    override = {
      kind: "discount_percent",
      input_amount: percent,
      // A percentage has no currency, and recording one would invite a reader
      // to convert it.
      input_currency_code: null,
      fx_rate: 1,
    }
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `A line override resolved to ${amount}, which would mint an ACTIVE price of zero or less. ` +
        "Quote a real price, or leave the line at its catalog price."
    )
  }

  return { unit_amount: amount, override }
}

/**
 * PURE: does this basket need an FX rate at all?
 *
 * Asked before the network call so a same-currency mint — the overwhelming
 * majority — never touches Frankfurter, and so a quote with no overrides can
 * never be blocked by an FX outage.
 */
export function needsExchangeRate(
  lines: Array<{ override_unit_amount?: number | null }>,
  storeCurrency: string,
  quoteCurrency: string
): boolean {
  if (String(storeCurrency).toUpperCase() === String(quoteCurrency).toUpperCase()) {
    return false
  }
  return (lines || []).some(
    (l) =>
      l?.override_unit_amount !== null &&
      l?.override_unit_amount !== undefined &&
      Number.isFinite(Number(l.override_unit_amount))
  )
}
