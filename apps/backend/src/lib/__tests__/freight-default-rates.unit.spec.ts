import {
  DEFAULT_QUOTE_FREIGHT_TIERS,
  INTL_FLAT_RATES,
  buildIntlFallbackByCurrency,
  intlFlatRateFor,
  quoteTierPriceRows,
} from "../freight-default-rates"
import { resolveQuoteTierAmount } from "../quote-freight-tiers"

/**
 * These are the numbers a buyer is charged when no carrier will quote the lane.
 * The table is shared by `create-store-with-defaults` and the #1538 backfill
 * precisely so a store provisioned tomorrow and a store repaired today cannot
 * quote the same lane differently.
 */

describe("intlFlatRateFor", () => {
  it("returns the currency's own rate", () => {
    expect(intlFlatRateFor("eur").base).toBe(35)
    expect(intlFlatRateFor("inr").base).toBe(3200)
  })

  it("is case- and whitespace-insensitive", () => {
    expect(intlFlatRateFor(" EUR ")).toEqual(INTL_FLAT_RATES.eur)
  })

  it("falls back to USD for an unlisted currency rather than to nothing", () => {
    // The alternative used to be DEFAULT_FLAT_FALLBACK (200) — an INR-shaped
    // number charged as €200 on a EUR cart.
    expect(intlFlatRateFor("sek")).toEqual(INTL_FLAT_RATES.usd)
  })
})

describe("buildIntlFallbackByCurrency", () => {
  it("keys by currency, lower-cased, from any iterable", () => {
    expect(buildIntlFallbackByCurrency(new Set(["EUR", "inr"]))).toEqual({
      eur: 35,
      inr: 3200,
    })
  })

  it("drops empty entries instead of writing an empty key", () => {
    expect(buildIntlFallbackByCurrency(["", "  ", "eur"])).toEqual({ eur: 35 })
  })
})

describe("quoteTierPriceRows", () => {
  it("prices from the LIGHT tier, so a misconfiguration fails toward the smaller number", () => {
    expect(quoteTierPriceRows(["eur"])).toEqual([{ currency_code: "eur", amount: 59 }])
  })

  it("accepts a Set — the shape create-store-with-defaults actually holds", () => {
    // ⚠️ `intlCurrencies` is a Set; `.map()` on it compiled fine under jest and
    // was caught only by check:prod-build.
    expect(quoteTierPriceRows(new Set(["inr"]))).toEqual([
      { currency_code: "inr", amount: 5400 },
    ])
  })
})

describe("DEFAULT_QUOTE_FREIGHT_TIERS", () => {
  it("resolves a 5 kg consignment to the LIGHT tier — the bound is inclusive", () => {
    expect(resolveQuoteTierAmount(DEFAULT_QUOTE_FREIGHT_TIERS, 5000, "eur")).toBe(59)
  })

  it("resolves one gram above the bound to the heavy tier", () => {
    expect(resolveQuoteTierAmount(DEFAULT_QUOTE_FREIGHT_TIERS, 5001, "eur")).toBe(100)
  })

  it("prices EVERY currency the intl rate table covers, in every tier", () => {
    // A tier that matches but does not price the cart's currency returns null —
    // the option is simply not offered — so a gap here silently removes the
    // middle rung of the freight ladder rather than mispricing it.
    //
    // 🔴 This assertion used to read "…except idr", pinning the gap as correct
    // (#1538). A test that names the hole is not a test, it is a comment that
    // fails when somebody fills it in. It is now the invariant: add a currency
    // to `INTL_FLAT_RATES` and this fails until the tiers price it too.
    const expected = Object.keys(INTL_FLAT_RATES).sort()
    for (const tier of DEFAULT_QUOTE_FREIGHT_TIERS) {
      expect(Object.keys(tier.amounts).sort()).toEqual(expected)
    }
  })

  it("prices ils — the currency that would have taken the USD figure verbatim", () => {
    // ₪39 (the usd row, verbatim) is about $13 against an intended $39.
    expect(intlFlatRateFor("ils").base).toBe(120)
    expect(resolveQuoteTierAmount(DEFAULT_QUOTE_FREIGHT_TIERS, 2200, "ils")).toBe(195)
    expect(resolveQuoteTierAmount(DEFAULT_QUOTE_FREIGHT_TIERS, 22000, "ils")).toBe(330)
  })
})
