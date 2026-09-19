import { pickCheckoutCountry } from "../resolve-cart-link"

/**
 * #2177 — the checkout link's country segment was `region.countries[0]`.
 *
 * That read is unambiguous only by accident. On prod:
 *
 *   India     [inr]  countries[0] = in   (n=1)
 *   Australia [aud]  countries[0] = au   (n=1)
 *   Europe    [eur]  countries[0] = al   (n=31)   ← Albania
 *
 * So the day a EUR design order could be created, every European buyer's link
 * would have carried `/al/`. Same family as `stores[0]` on a 14-tenant table.
 */
const EUROPE = ["al", "ad", "at", "be", "de", "fr", "it", "nl", "es"]

describe("pickCheckoutCountry", () => {
  it("uses the buyer's own country when the region contains it", () => {
    expect(
      pickCheckoutCountry({ buyerCountry: "de", regionCountries: EUROPE })
    ).toEqual({ country: "de", reason: "buyer" })
  })

  it("🔴 never returns row 0 of a multi-country region", () => {
    const picked = pickCheckoutCountry({
      buyerCountry: null,
      regionCountries: EUROPE,
    })
    expect(picked.country).not.toBe("al")
    expect(picked).toEqual({ country: null, reason: "ambiguous_region" })
  })

  it("a Dutch buyer in the EUR region gets /nl/, not /al/", () => {
    expect(
      pickCheckoutCountry({ buyerCountry: "nl", regionCountries: EUROPE }).country
    ).toBe("nl")
  })

  /**
   * The INR and AUD carts that exist today: one country, no ambiguity, and the
   * behaviour must not change for them.
   */
  it("a single-country region answers itself — no regression for INR or AUD", () => {
    expect(pickCheckoutCountry({ regionCountries: ["in"] })).toEqual({
      country: "in",
      reason: "sole_region_country",
    })
    expect(pickCheckoutCountry({ regionCountries: ["au"] })).toEqual({
      country: "au",
      reason: "sole_region_country",
    })
  })

  /**
   * 🔴 A buyer whose country is not in the cart's region means the cart is in
   * the WRONG REGION. Sending them to a prefix their cart cannot serve turns a
   * pricing mistake into a checkout that re-regions itself.
   */
  it("refuses a buyer country the region does not contain", () => {
    expect(
      pickCheckoutCountry({ buyerCountry: "de", regionCountries: ["in"] })
    ).toEqual({ country: null, reason: "buyer_outside_region" })
  })

  it("the live case: an Australian buyer on an INR cart is not sent to /in/", () => {
    // Kunal's cart shape — an EU/AU buyer on the India region.
    expect(
      pickCheckoutCountry({ buyerCountry: "au", regionCountries: ["in"] }).country
    ).toBeNull()
  })

  it("normalises case and whitespace on both sides", () => {
    expect(
      pickCheckoutCountry({ buyerCountry: " DE ", regionCountries: ["AT", "De"] })
    ).toEqual({ country: "de", reason: "buyer" })
  })

  it("a region naming no country is reported, not guessed at", () => {
    expect(pickCheckoutCountry({ regionCountries: [] })).toEqual({
      country: null,
      reason: "region_names_no_country",
    })
    expect(pickCheckoutCountry({ regionCountries: null })).toEqual({
      country: null,
      reason: "region_names_no_country",
    })
  })

  it("drops empty and non-string entries rather than treating them as countries", () => {
    expect(
      pickCheckoutCountry({ regionCountries: ["", "  ", null, undefined, "in"] })
    ).toEqual({ country: "in", reason: "sole_region_country" })
    expect(pickCheckoutCountry({ buyerCountry: "", regionCountries: ["in"] })).toEqual(
      { country: "in", reason: "sole_region_country" }
    )
  })
})
