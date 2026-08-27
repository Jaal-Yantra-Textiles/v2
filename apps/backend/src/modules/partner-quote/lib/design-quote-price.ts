/**
 * Turning an estimated COST into a quoted PRICE (#1486 follow-up).
 *
 * ## Why this file exists at all
 *
 * `design-lines.ts` says it plainly: a design's `estimated_cost` is not a
 * price. It is what the work costs us, in `cost_currency`, with no margin, no
 * tier and no FX — and quoting off it directly would be a second, parallel way
 * to arrive at a number the buyer pays.
 *
 * That reasoning still holds, and this does not break it. The estimate never
 * becomes a quote line's price directly: it becomes the PRICE OF A VARIANT that
 * is then quoted through exactly the machinery every other line uses — tiers,
 * the minted price list, freight weight, the accepted cart. This file is the
 * one place that converts, so the conversion is auditable in one diff rather
 * than re-derived at each call site.
 *
 * ## The three things a cost is missing
 *
 * 1. **Margin.** A cost quoted as a price is a zero-margin sale. Custom work
 *    is small-batch and the estimate itself is a guess, so the uplift also
 *    absorbs the error — see `DEFAULT_CUSTOM_DESIGN_MARKUP_PERCENT`.
 * 2. **Currency.** The estimate is denominated in the design's `cost_currency`;
 *    the quote is denominated in the buyer's. Converting is not optional and
 *    not something a caller should be trusted to remember.
 * 3. **An answer at all.** `total_estimated` is nullable for "we could not
 *    price this" (#1564), and the recalculation path writes `0` for the same
 *    thing (#1563). Both must refuse, and they must refuse in the same way.
 */

/**
 * The uplift on a custom design's estimated cost.
 *
 * 20%, and deliberately not tuned per design. These are small quotes on
 * one-off work: the estimate behind them is a `guesstimate` far more often
 * than it is `exact`, so the uplift is carrying estimation error as much as
 * margin. A partner who knows better dials the line in the wizard, which is
 * why this is a STARTING figure and not a final one.
 */
export const DEFAULT_CUSTOM_DESIGN_MARKUP_PERCENT = 20

export type DesignQuotePriceInput = {
  /** `total_estimated` from the estimator. Per finished unit (#1554). */
  total_estimated: number | null | undefined
  /** The estimator's confidence. `none` is not an estimate at all. */
  confidence?: string | null
  /**
   * Multiplier from the design's cost currency to the quote's. 1 when they
   * match. Null means the conversion was ASKED FOR and failed, which is not
   * the same as "no conversion needed" and must not price anything.
   */
  fx_rate?: number | null
  markup_percent?: number
}

export type DesignQuotePrice = {
  /** The quoted unit price, or null when the design cannot be priced. */
  unit_price: number | null
  /** Why not, in words for a partner. Null when priced. */
  reason: string | null
  /** What the uplift was applied to, in the quote's currency. For the UI. */
  basis: number | null
  markup_percent: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * PURE: cost → quoted unit price, or a refusal with a reason.
 *
 * 🔴 Every refusal returns `unit_price: null`, never 0. A zero here would not
 * fail loudly — it would be minted as an ACTIVE price row that the cart
 * happily charges, which is the exact failure `planQuotePrices` refuses to
 * make and the one that reached a real storefront checkout in #1564.
 */
export function designQuoteUnitPrice(
  input: DesignQuotePriceInput
): DesignQuotePrice {
  const markup = input.markup_percent ?? DEFAULT_CUSTOM_DESIGN_MARKUP_PERCENT
  const refuse = (reason: string): DesignQuotePrice => ({
    unit_price: null,
    reason,
    basis: null,
    markup_percent: markup,
  })

  const estimated = Number(input.total_estimated)

  if (input.total_estimated == null) {
    return refuse(
      "There is nothing to price this design from yet — no bill of materials, no completed run and no comparable work."
    )
  }

  if (!Number.isFinite(estimated)) {
    return refuse("The cost estimate for this design is not a number.")
  }

  /**
   * 🔴 `> 0`, not `!= null`. The recalculation route stores 0 to mean "the
   * estimator found nothing" (#1563), so a design carrying a stored 0 arrives
   * here looking like a priced design that is free. Asking the question this
   * way is the only form that both spellings answer correctly.
   */
  if (estimated <= 0) {
    return refuse(
      "This design's cost estimate is zero, which means the estimator found nothing to price rather than that the work is free."
    )
  }

  // "none" is the ABSENCE of an estimate, not a weak one (#1564).
  if (input.confidence === "none") {
    return refuse(
      "The cost estimate for this design has no basis, so it cannot be quoted."
    )
  }

  /**
   * ⚠️ `undefined` means no conversion was needed; `null` means one was
   * attempted and failed. Collapsing them with `?? 1` would quietly quote a
   * rupee figure as dollars — which is #1538's remembered-rate error with the
   * arithmetic removed.
   */
  if (input.fx_rate === null) {
    return refuse(
      "The exchange rate needed to quote this design in the buyer's currency could not be fetched."
    )
  }

  const rate = input.fx_rate === undefined ? 1 : Number(input.fx_rate)
  if (!Number.isFinite(rate) || rate <= 0) {
    return refuse("The exchange rate for this quote is not usable.")
  }

  const basis = round2(estimated * rate)
  return {
    unit_price: round2(basis * (1 + markup / 100)),
    reason: null,
    basis,
    markup_percent: markup,
  }
}
