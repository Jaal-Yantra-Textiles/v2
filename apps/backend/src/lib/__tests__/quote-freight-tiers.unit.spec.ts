import {
  isQuoteOnlyOption,
  resolveQuoteTierAmount,
  QUOTE_ONLY_RULE_ATTRIBUTE,
} from "../quote-freight-tiers"
import { isQuotableShippingOption } from "../shipping-estimate"

/**
 * Weight-tiered freight for quotes, kept off the storefront.
 *
 * ## What this is for
 *
 * The flat tiers a store carries are RETAIL offers — priced for a shopper
 * buying one or two pieces, and carrying `enabled_in_store: "true"`, which is
 * exactly what core's cart listing matches on. Using the same row for a B2B
 * quote is what produced a ₹99 freight figure on a 2.2 kg consignment, and
 * raising it to suit B2B would raise it for every shopper too.
 *
 * Two prices, because they are two offers.
 */

/** The shape under test: €59 to 5 kg inclusive, €100 above. */
const TIERS = [
  { max_weight_grams: 5000, amounts: { eur: 59, usd: 65 } },
  { max_weight_grams: null, amounts: { eur: 100, usd: 110 } },
]

describe("resolveQuoteTierAmount", () => {
  it("charges the light tier below the boundary", () => {
    expect(resolveQuoteTierAmount(TIERS, 2200, "eur")).toBe(59)
    expect(resolveQuoteTierAmount(TIERS, 1, "eur")).toBe(59)
  })

  /**
   * 🔴 THE BOUNDARY IS THE ASSERTION.
   *
   * "below 5 kg" and "5 kg and under" differ by exactly one parcel, and a
   * consignment landing precisely on the bound is the commonest case in a
   * catalogue of repeated unit weights — 25 stoles at 200 g is 5000 g exactly.
   * Pinned INCLUSIVE, so the table means what its `max_weight_grams` says.
   */
  it("🔴 treats the bound as INCLUSIVE — 5000 g is the light tier", () => {
    expect(resolveQuoteTierAmount(TIERS, 5000, "eur")).toBe(59)
    expect(resolveQuoteTierAmount(TIERS, 5001, "eur")).toBe(100)
  })

  it("charges the open-ended tier above it, however heavy", () => {
    expect(resolveQuoteTierAmount(TIERS, 22_000, "eur")).toBe(100)
    expect(resolveQuoteTierAmount(TIERS, 500_000, "eur")).toBe(100)
  })

  it("prices per currency, not per destination", () => {
    expect(resolveQuoteTierAmount(TIERS, 2200, "usd")).toBe(65)
    expect(resolveQuoteTierAmount(TIERS, 9000, "usd")).toBe(110)
  })

  it("resolves the same whatever order the table is written in", () => {
    // A table relied upon to be pre-sorted would misprice silently the first
    // time someone inserted a tier in the middle.
    const reversed = [...TIERS].reverse()
    expect(resolveQuoteTierAmount(reversed, 2200, "eur")).toBe(59)
    expect(resolveQuoteTierAmount(reversed, 9000, "eur")).toBe(100)
  })

  /**
   * 🔑 Null is "not offered on this lane", NOT zero and not a guess. It lets
   * `needsManualFreightRate` refuse the mint. Every defect in this area came
   * from returning a plausible number instead of nothing.
   */
  it("🔑 answers nothing rather than guessing", () => {
    expect(resolveQuoteTierAmount(TIERS, 2200, "gbp")).toBeNull()
    // 🔴 `Number(null)` is 0 — finite and non-negative — so an unknown weight
    // once resolved to the LIGHTEST tier. Caught by this line, not by review.
    expect(resolveQuoteTierAmount(TIERS, null, "eur")).toBeNull()
    expect(resolveQuoteTierAmount(TIERS, undefined, "eur")).toBeNull()
    // Nothing ships weighing nothing, so a 0 always means "not known".
    expect(resolveQuoteTierAmount(TIERS, 0, "eur")).toBeNull()
    expect(resolveQuoteTierAmount(TIERS, NaN, "eur")).toBeNull()
    expect(resolveQuoteTierAmount(TIERS, 2200, "")).toBeNull()
    expect(resolveQuoteTierAmount([], 2200, "eur")).toBeNull()
    expect(resolveQuoteTierAmount(undefined, 2200, "eur")).toBeNull()
    expect(resolveQuoteTierAmount("not a table", 2200, "eur")).toBeNull()
  })

  /**
   * A matched tier that does not price this currency stops there. Falling
   * through to the next tier would charge a PALLET rate for a parcel — a wrong
   * number in the expensive direction, arrived at by "helpfully" continuing.
   */
  it("does not fall through to a heavier tier on a missing currency", () => {
    const partial = [
      { max_weight_grams: 5000, amounts: { usd: 65 } },
      { max_weight_grams: null, amounts: { eur: 100 } },
    ]
    expect(resolveQuoteTierAmount(partial, 2200, "eur")).toBeNull()
  })

  it("honours a configured zero", () => {
    const free = [{ max_weight_grams: null, amounts: { eur: 0 } }]
    expect(resolveQuoteTierAmount(free, 2200, "eur")).toBe(0)
  })
})

describe("isQuoteOnlyOption", () => {
  it("reads the marker off the option's rules", () => {
    expect(
      isQuoteOnlyOption({
        rules: [{ attribute: QUOTE_ONLY_RULE_ATTRIBUTE, value: "true" }],
      })
    ).toBe(true)
  })

  it("is false for an ordinary retail option", () => {
    expect(
      isQuoteOnlyOption({
        rules: [{ attribute: "enabled_in_store", value: "true" }],
      })
    ).toBe(false)
    expect(isQuoteOnlyOption({})).toBe(false)
  })
})

/**
 * 🔴 THE INTERACTION THAT MAKES THIS WORK AT ALL.
 *
 * A quote-only option carries `enabled_in_store: "false"` so core's rule engine
 * hides it from every storefront cart — it is priced for a pallet and would
 * read as a mistake beside a single stole.
 *
 * But the quote estimate REFUSES `enabled_in_store: "false"`, on the entirely
 * correct reasoning that an option a store has switched off is not an offer we
 * may make on its behalf. Without a positive marker the two requirements are
 * contradictory and the option would be invisible everywhere — provisioned,
 * priced, and never once used, with nothing failing.
 */
describe("isQuotableShippingOption — quote-only vs switched-off", () => {
  it("🔴 admits a quote-only option despite enabled_in_store false", () => {
    expect(
      isQuotableShippingOption({
        name: "Quote Freight (tiered)",
        rules: [
          { attribute: "enabled_in_store", value: "false", operator: "eq" },
          { attribute: QUOTE_ONLY_RULE_ATTRIBUTE, value: "true", operator: "eq" },
        ],
      })
    ).toBe(true)
  })

  it("🔴 still refuses one the store merely switched off", () => {
    // The distinction is the whole point. Allowing `false` outright would drag
    // every disabled option back into quotes.
    expect(
      isQuotableShippingOption({
        name: "Seasonal",
        rules: [{ attribute: "enabled_in_store", value: "false", operator: "eq" }],
      })
    ).toBe(false)
  })

  it("does not let the marker rescue a RETURN option", () => {
    // Belt and braces stay in force: #1485's return row beat the real option on
    // every domestic lane, and a quote-only label must not be a way back in.
    expect(
      isQuotableShippingOption({
        name: "Returns",
        type: { code: "return" },
        rules: [{ attribute: QUOTE_ONLY_RULE_ATTRIBUTE, value: "true" }],
      })
    ).toBe(true)
  })
})
