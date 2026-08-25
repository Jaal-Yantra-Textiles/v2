/**
 * Weight-tiered freight for QUOTES, kept off the storefront.
 *
 * ## Why a separate option at all
 *
 * The flat tiers a store already carries are RETAIL offers. They exist to be
 * shown in a cart, they carry `enabled_in_store: "true"` — which is precisely
 * what core's `list-shipping-options-for-cart` matches on — and they are priced
 * for a shopper buying one or two pieces. A B2B quote is a different question
 * asked of the same lane: 40 pieces, 22 kg, a courier we may not have a live
 * rate for.
 *
 * Using the retail row for both is what produced the ₹99 quote on a 2.2 kg
 * consignment. Raising it to suit B2B would raise it for every shopper too.
 * They are two prices because they are two offers.
 *
 * ## Why the tiers live in `data` and not in price rules
 *
 * Medusa price rules are evaluated against a pricing CONTEXT — `item_total`,
 * `region_id`, and so on. There is no `weight` in that context, and the
 * estimate has no cart to build one from. It does, however, already compute
 * `total_weight_grams` for the carrier call, so the consignment weight is
 * known here and nowhere else.
 *
 * So the tiers are declared on the option's own `data`, the same lever
 * `flat_fallback_amount` already uses, and resolved by this pure function.
 * One table, editable per store beside the option it prices.
 *
 * ## 🔴 Why it must not be reachable from a storefront cart
 *
 * It is priced for a pallet. Offered to a retail cart it would be an absurd
 * postage quote on a single stole, and — because a cart shows the buyer every
 * option — it would sit there looking like a mistake. It carries
 * `enabled_in_store: "false"` so core's rule engine hides it, and a positive
 * `quote_only` marker so the quote estimate can tell "deliberately not for the
 * shop" apart from "the store switched this off", which the estimate must
 * still refuse.
 */

/** The option-level rule marking an option as quote-only. */
export const QUOTE_ONLY_RULE_ATTRIBUTE = "quote_only"

export type QuoteFreightTier = {
  /**
   * Upper bound INCLUSIVE, in grams. `null` is the open-ended top tier.
   *
   * 🔑 Inclusive, and the boundary is asserted: "below 5 kg" and "5 kg and
   * under" differ by exactly one parcel, and a consignment landing on the
   * boundary is the commonest case in a catalogue with repeated unit weights.
   */
  max_weight_grams: number | null
  /** Amount per currency, ISO-4217 lower-case, in store price units. */
  amounts: Record<string, number>
}

/**
 * PURE: what this option charges for a consignment of this weight, in this
 * currency.
 *
 * Returns null rather than a number whenever it cannot answer — an unknown
 * currency, a weightless basket, a malformed table. 🔑 Null means the option is
 * simply not offered on this lane, which lets `needsManualFreightRate` do its
 * job. Every previous defect in this area came from returning a plausible
 * number instead of nothing.
 */
export function resolveQuoteTierAmount(
  tiers: unknown,
  weightGrams: number | null | undefined,
  currencyCode: string | null | undefined
): number | null {
  if (!Array.isArray(tiers) || !tiers.length) return null

  const currency = String(currencyCode || "").trim().toLowerCase()
  if (!currency) return null

  /**
   * A weightless basket cannot be tiered.
   *
   * 🔴 `weight < 0` was not enough, and a test caught it: `Number(null)` is
   * **0**, which is finite and non-negative, so an unknown weight resolved to
   * the LIGHTEST tier. A consignment whose weight we could not read would have
   * been quoted as if it were a featherweight parcel — a plausible number
   * standing in for an unknown one, which is the exact failure this file's
   * header is about.
   *
   * Zero is rejected outright rather than treated as a real weight: nothing
   * ships weighing nothing, so a 0 here always means "not known".
   * `buildShippingEstimate` refuses a weightless basket before this is
   * reached, but this is the function that decides a buyer's number and must
   * not depend on a caller having checked.
   */
  if (weightGrams === null || weightGrams === undefined) return null
  const weight = Number(weightGrams)
  if (!Number.isFinite(weight) || weight <= 0) return null

  /**
   * Sorted by bound, open-ended last, so the table can be written in any order
   * and still resolve the same way. A table whose rows were relied upon to be
   * in order would misprice silently the first time someone inserted a tier in
   * the middle.
   */
  const sorted = [...tiers]
    .filter((t: any) => t && typeof t === "object")
    .sort((a: any, b: any) => {
      const av = a.max_weight_grams
      const bv = b.max_weight_grams
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return Number(av) - Number(bv)
    })

  for (const tier of sorted as QuoteFreightTier[]) {
    const bound = tier.max_weight_grams
    const isOpenEnded = bound === null || bound === undefined
    // INCLUSIVE upper bound — see the type.
    if (!isOpenEnded && weight > Number(bound)) continue

    const amounts = tier.amounts
    if (!amounts || typeof amounts !== "object") return null

    for (const [key, value] of Object.entries(amounts)) {
      if (String(key).trim().toLowerCase() !== currency) continue
      // A configured 0 is a real answer — "we absorb freight at this weight".
      // Only ABSENCE falls through, hence validity rather than truthiness.
      if (Number.isFinite(Number(value))) return Number(value)
    }

    // The tier matched but does not price this currency. Falling through to a
    // heavier tier would charge a pallet rate for a parcel, so stop.
    return null
  }

  return null
}

/**
 * PURE: is this option a quote-only tiered one?
 *
 * Read from the option's RULES rather than inferred from the presence of
 * `data.quote_weight_tiers`, so a half-configured option — marked quote-only
 * but with no table — is refused loudly by the resolver above rather than
 * quietly treated as an ordinary retail row and priced from its retail prices.
 */
export function isQuoteOnlyOption(shippingOption: any): boolean {
  const rules = (shippingOption?.rules ?? []) as Array<{
    attribute?: string
    value?: unknown
  }>
  return rules.some(
    (r) =>
      String(r?.attribute || "").trim() === QUOTE_ONLY_RULE_ATTRIBUTE &&
      String(r?.value ?? "").trim().toLowerCase() === "true"
  )
}
