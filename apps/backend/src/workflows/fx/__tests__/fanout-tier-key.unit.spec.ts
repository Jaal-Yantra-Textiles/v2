import { tierKey } from "../fanout-prices"

/**
 * `tierKey` is the identity of a price WITHIN a price set. The FX fanout uses
 * it three times — to decide which (currency, tier) pairs already exist, to
 * pick the rows `addPrices` just created, and to zip each converted row to its
 * `fx_price_meta`. All three were keyed on currency ALONE before tiered
 * pricing existed, which is why bulk breaks survived only in the base currency:
 * the 50+ tier saw `usd` already present from the 1-49 tier and skipped, and
 * when the per-price fanouts raced instead, a currency ended up with several
 * unbounded rows and no boundaries at all (observed on prod: 3 AUD rows, each
 * min_quantity/max_quantity null).
 */
describe("tierKey", () => {
  it("separates tiers of the same currency", () => {
    expect(tierKey("usd", 1, 49)).not.toBe(tierKey("usd", 50, 199))
    expect(tierKey("usd", 50, 199)).not.toBe(tierKey("usd", 200, null))
  })

  it("separates currencies at the same tier", () => {
    expect(tierKey("usd", 50, 199)).not.toBe(tierKey("aud", 50, 199))
  })

  // The bug this guards: bounds are BigNumberValue. `query.graph` returns them
  // as strings, we set them as numbers. If those two don't collapse, every
  // fanout believes the tier is missing and re-creates it.
  it("collapses string and number bounds to the same key", () => {
    expect(tierKey("usd", "50", "199")).toBe(tierKey("usd", 50, 199))
    expect(tierKey("usd", "200", null)).toBe(tierKey("usd", 200, null))
  })

  it("is case-insensitive on the currency", () => {
    expect(tierKey("USD", 1, 49)).toBe(tierKey("usd", 1, 49))
  })

  it("treats null, undefined and empty string as unbounded alike", () => {
    const unbounded = tierKey("usd", null, null)
    expect(tierKey("usd", undefined, undefined)).toBe(unbounded)
    expect(tierKey("usd", "", "")).toBe(unbounded)
  })

  // An unbounded price is a DIFFERENT offer from one that starts at 1 — the
  // legacy untiered rows are unbounded, so this must not collapse or the
  // fanout would treat an existing plain price as covering the 1-49 tier.
  it("keeps an unbounded price distinct from a bounded one", () => {
    expect(tierKey("usd", null, null)).not.toBe(tierKey("usd", 1, 49))
    expect(tierKey("usd", null, null)).not.toBe(tierKey("usd", 1, null))
  })

  it("distinguishes a min-only tier from a min+max tier", () => {
    expect(tierKey("usd", 200, null)).not.toBe(tierKey("usd", 200, 999))
  })
})
